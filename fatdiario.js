'use strict';
// Financeiro · Faturamento diário: um JSON por empresa e competência (AAAA-MM) com os valores de cada dia por setor/loja.
// Permissão "fatdiario": ver = consultar · editar = importar e digitar valores.
module.exports = function montarFatDiario(app, { pool, permMin, logAudit }) {
  const EMPRESAS = ['azul', 'sonho', 'arranjos'];
  const NOMES = { azul: 'Azul Viagens', sonho: 'Sonho Azul', arranjos: 'Arranjos Express' };
  async function bootstrap() {
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.fat_diario (
      empresa TEXT NOT NULL, competencia TEXT NOT NULL, dados JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_por TEXT, PRIMARY KEY (empresa, competencia))`);
  }
  const ok = (emp, comp) => EMPRESAS.includes(emp) && /^\d{4}-\d{2}$/.test(String(comp || ''));

  app.get('/api/fatdiario/:emp', permMin('fatdiario', 'ver'), async (req, res) => {
    if (!EMPRESAS.includes(req.params.emp)) return res.status(400).json({ erro: 'Empresa inválida.' });
    const { rows } = await pool.query('SELECT competencia FROM dre.fat_diario WHERE empresa=$1 ORDER BY competencia DESC', [req.params.emp]);
    res.json({ competencias: rows.map(r => r.competencia) });
  });

  app.get('/api/fatdiario/:emp/:comp', permMin('fatdiario', 'ver'), async (req, res) => {
    const { emp, comp } = req.params;
    if (!ok(emp, comp)) return res.status(400).json({ erro: 'Parâmetros inválidos.' });
    const { rows } = await pool.query('SELECT dados, atualizado_por, atualizado_em FROM dre.fat_diario WHERE empresa=$1 AND competencia=$2', [emp, comp]);
    res.json({ dados: rows[0] ? rows[0].dados : null, por: rows[0] ? rows[0].atualizado_por : null, em: rows[0] ? rows[0].atualizado_em : null });
  });

  app.put('/api/fatdiario/:emp/:comp', permMin('fatdiario', 'editar'), async (req, res) => {
    const { emp, comp } = req.params;
    if (!ok(emp, comp)) return res.status(400).json({ erro: 'Parâmetros inválidos.' });
    const dados = req.body && req.body.dados;
    if (!dados || typeof dados !== 'object' || typeof dados.dias !== 'object') return res.status(400).json({ erro: 'Dados inválidos.' });
    if (JSON.stringify(dados).length > 400000) return res.status(413).json({ erro: 'Dados grandes demais.' });
    await pool.query(`INSERT INTO dre.fat_diario (empresa, competencia, dados, atualizado_por) VALUES ($1,$2,$3,$4)
      ON CONFLICT (empresa, competencia) DO UPDATE SET dados=EXCLUDED.dados, atualizado_em=now(), atualizado_por=EXCLUDED.atualizado_por`,
      [emp, comp, dados, req.user.email]);
    if (req.body.log) await logAudit(req.user.id, 'Faturamento diário: ' + String(req.body.log).slice(0, 80), `${NOMES[emp]} · ${comp}`);
    res.json({ ok: true });
  });

  return { bootstrap };
};
