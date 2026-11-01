'use strict';
// Comercial: relatórios de vendas importados (planilha do sistema de vendas) e métricas por vendedor.
// Permissão "comercial": ver = painel · editar = importar e excluir importações.
module.exports = function montarComercial(app, { pool, permMin, logAudit }) {
  async function bootstrap() {
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.com_lotes (
      id SERIAL PRIMARY KEY, arquivo TEXT NOT NULL, importado_por TEXT, importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      linhas INT NOT NULL DEFAULT 0, total NUMERIC(16,2) NOT NULL DEFAULT 0, periodo_ini DATE, periodo_fim DATE)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.com_vendas (
      id BIGSERIAL PRIMARY KEY, lote_id INT NOT NULL REFERENCES dre.com_lotes(id) ON DELETE CASCADE,
      data DATE NOT NULL, vendedor TEXT NOT NULL, fornecedor TEXT, destino TEXT, cliente TEXT, loja TEXT, documento TEXT,
      valor NUMERIC(14,2) NOT NULL DEFAULT 0)`);
    // Relatório de faturamento líquido: produto, Liq. Agência e tarifa (opcionais em relatórios antigos).
    await pool.query('ALTER TABLE dre.com_vendas ADD COLUMN IF NOT EXISTS produto TEXT, ADD COLUMN IF NOT EXISTS liquido NUMERIC(14,2), ADD COLUMN IF NOT EXISTS tarifa NUMERIC(14,2)');
    await pool.query('CREATE INDEX IF NOT EXISTS ix_com_vendas_data ON dre.com_vendas (data)');
    await pool.query('CREATE INDEX IF NOT EXISTS ix_com_vendas_lote ON dre.com_vendas (lote_id)');
    // Comissão dos consultores: uma linha JSON por competência (AAAA-MM) com parâmetros e números do mês.
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.com_comissao (
      competencia TEXT PRIMARY KEY, dados JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_por TEXT)`);
  }
  const compOk = v => /^\d{4}-\d{2}$/.test(String(v || ''));

  const txt = (v, n = 160) => { const s = String(v == null ? '' : v).trim().slice(0, n); return s || null; };
  const dataOk = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  // Recebe em partes (até 3.000 linhas por chamada). A primeira cria o lote; as seguintes mandam loteId.
  app.post('/api/comercial/importar', permMin('comercial', 'editar'), async (req, res) => {
    const b = req.body || {};
    const linhas = Array.isArray(b.linhas) ? b.linhas.slice(0, 3000) : [];
    const ok = linhas.filter(l => l && dataOk(l.data) && txt(l.vendedor) && Number.isFinite(Number(l.valor)));
    if (!ok.length) return res.status(400).json({ erro: 'Nenhuma linha válida (data, vendedor e valor são obrigatórios).' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let loteId = Number(b.loteId) || null;
      if (loteId) {
        const { rowCount } = await client.query('SELECT 1 FROM dre.com_lotes WHERE id=$1', [loteId]);
        if (!rowCount) throw Object.assign(new Error('Importação não encontrada.'), { status: 404 });
      } else {
        const { rows } = await client.query('INSERT INTO dre.com_lotes (arquivo, importado_por) VALUES ($1,$2) RETURNING id', [txt(b.arquivo, 200) || 'relatório', req.user.email]);
        loteId = rows[0].id;
      }
      const dec = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
      const col = k => ok.map(l => (k === 'valor' ? Math.round(Number(l.valor) * 100) / 100 : k === 'liquido' || k === 'tarifa' ? dec(l[k]) : k === 'data' ? l.data : txt(l[k])));
      await client.query(
        `INSERT INTO dre.com_vendas (lote_id, data, vendedor, fornecedor, destino, cliente, loja, documento, valor, produto, liquido, tarifa)
         SELECT $1, * FROM unnest($2::date[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::text[], $11::numeric[], $12::numeric[])`,
        [loteId, col('data'), col('vendedor'), col('fornecedor'), col('destino'), col('cliente'), col('loja'), col('documento'), col('valor'), col('produto'), col('liquido'), col('tarifa')]);
      await client.query(`UPDATE dre.com_lotes l SET linhas=x.n, total=x.t, periodo_ini=x.a, periodo_fim=x.b
        FROM (SELECT COUNT(*)::int n, COALESCE(SUM(valor),0) t, MIN(data) a, MAX(data) b FROM dre.com_vendas WHERE lote_id=$1) x WHERE l.id=$1`, [loteId]);
      await client.query('COMMIT');
      if (b.final) {
        const { rows } = await pool.query('SELECT arquivo, linhas, total FROM dre.com_lotes WHERE id=$1', [loteId]);
        await logAudit(req.user.id, 'Comercial: importou relatório', `${rows[0].arquivo} · ${rows[0].linhas} venda(s) · R$ ${Number(rows[0].total).toFixed(2)}`);
      }
      res.json({ ok: true, loteId, recebidas: ok.length, ignoradas: linhas.length - ok.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro ao gravar as vendas.' });
      if (!e.status) console.error('[comercial]', e);
    } finally { client.release(); }
  });

  app.get('/api/comercial/vendas', permMin('comercial', 'ver'), async (req, res) => {
    const de = dataOk(req.query.de) ? req.query.de : '1900-01-01';
    const ate = dataOk(req.query.ate) ? req.query.ate : '2999-12-31';
    const { rows } = await pool.query(
      `SELECT to_char(data,'YYYY-MM-DD') d, vendedor, fornecedor, destino, valor::float8 v, loja, cliente, documento, lote_id, produto, liquido::float8 liq, tarifa::float8 tar
       FROM dre.com_vendas WHERE data BETWEEN $1 AND $2 ORDER BY data`, [de, ate]);
    res.json({ vendas: rows.map(r => [r.d, r.vendedor, r.fornecedor || '', r.destino || '', r.v, r.loja || '', r.cliente || '', r.documento || '', r.lote_id, r.produto || '', r.liq, r.tar]) });
  });

  app.get('/api/comercial/lotes', permMin('comercial', 'ver'), async (req, res) => {
    const { rows } = await pool.query(`SELECT id, arquivo, importado_por, importado_em, linhas, total::float8 total,
      to_char(periodo_ini,'YYYY-MM-DD') ini, to_char(periodo_fim,'YYYY-MM-DD') fim FROM dre.com_lotes ORDER BY importado_em DESC LIMIT 200`);
    res.json(rows);
  });

  app.delete('/api/comercial/lotes/:id', permMin('comercial', 'editar'), async (req, res) => {
    const { rows } = await pool.query('DELETE FROM dre.com_lotes WHERE id=$1 RETURNING arquivo, linhas', [Number(req.params.id) || 0]);
    if (!rows[0]) return res.status(404).json({ erro: 'Importação não encontrada.' });
    await logAudit(req.user.id, 'Comercial: excluiu importação', `${rows[0].arquivo} · ${rows[0].linhas} venda(s)`);
    res.json({ ok: true });
  });

  // Todas as competências salvas (para o painel calcular o % de comissão sobre o faturamento líquido).
  app.get('/api/comercial/comissoes', permMin('comercial', 'ver'), async (req, res) => {
    const { rows } = await pool.query('SELECT competencia, dados FROM dre.com_comissao ORDER BY competencia');
    res.json(rows);
  });

  // Devolve a competência pedida e a última salva antes dela (para herdar parâmetros e nomes).
  app.get('/api/comercial/comissao/:comp', permMin('comercial', 'ver'), async (req, res) => {
    const comp = req.params.comp;
    if (!compOk(comp)) return res.status(400).json({ erro: 'Competência inválida.' });
    const { rows } = await pool.query(`SELECT competencia, dados, atualizado_por, atualizado_em FROM dre.com_comissao WHERE competencia=$1`, [comp]);
    const { rows: ant } = await pool.query(`SELECT dados FROM dre.com_comissao WHERE competencia<$1 ORDER BY competencia DESC LIMIT 1`, [comp]);
    res.json({ dados: rows[0] ? rows[0].dados : null, por: rows[0] ? rows[0].atualizado_por : null, em: rows[0] ? rows[0].atualizado_em : null, anterior: ant[0] ? ant[0].dados : null });
  });

  app.put('/api/comercial/comissao/:comp', permMin('comercial', 'editar'), async (req, res) => {
    const comp = req.params.comp, d = req.body && req.body.dados;
    if (!compOk(comp)) return res.status(400).json({ erro: 'Competência inválida.' });
    if (!d || typeof d !== 'object' || !Array.isArray(d.consultores)) return res.status(400).json({ erro: 'Dados inválidos.' });
    await pool.query(`INSERT INTO dre.com_comissao (competencia, dados, atualizado_por) VALUES ($1,$2::jsonb,$3)
      ON CONFLICT (competencia) DO UPDATE SET dados=$2::jsonb, atualizado_em=now(), atualizado_por=$3`, [comp, JSON.stringify(d), req.user.email]);
    await logAudit(req.user.id, 'Comercial: salvou comissão', comp);
    res.json({ ok: true });
  });

  return { bootstrap };
};
