// DRE Grupo Azul — backend skeleton (Node + Express + PostgreSQL)
// Implements the API the frontend needs. Fill in TODOs; wire to schema.sql.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Handler async que rejeita não pode pendurar a requisição: sem isto uma falha
// de banco (ou da auditoria) deixava o cliente esperando para sempre.
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (path, ...handlers) => orig(path, ...handlers.map(h =>
    h.length >= 3 ? h : function (req, res, next) {
      try { const r = h(req, res, next); if (r && r.then) r.catch(next); }
      catch (e) { next(e); }
    }
  ));
}

// Migrações idempotentes aplicadas no boot. Sem isso a coluna `grupo` pode não
// existir e todo item manual volta do banco sem grupo, caindo no Passivo.
async function bootstrapSchema() {
  try {
    await pool.query(`ALTER TABLE dre.credores_manuais
      ADD COLUMN IF NOT EXISTS grupo TEXT NOT NULL DEFAULT 'passivo'`);
    // A coluna de grupo em dre.categorias chama-se tipo_categoria. Usar `grupo`
    // aqui fazia o INSERT falhar em silêncio e as três linhas nunca existirem.
    const novas = [
      ['ocupacao', 'ocu_internet', 'Internet', null, 58],
      ['outras_despesas', 'out_publicidade', 'Publicidade', 'arranjos', 150],
      ['outras_despesas', 'out_royalties', 'Royalties', 'arranjos', 151],
    ];
    for (const c of novas) {
      // Sem ON CONFLICT: não há garantia de índice único em codigo.
      await pool.query(
        `INSERT INTO dre.categorias (tipo_categoria, codigo, nome, aplica_tipo, ordem)
         SELECT $1,$2,$3,$4,$5
         WHERE NOT EXISTS (SELECT 1 FROM dre.categorias WHERE codigo=$2)`, c);
    }
    const { rows } = await pool.query(
      `SELECT codigo FROM dre.categorias WHERE codigo IN ('ocu_internet','out_publicidade','out_royalties')`);
    console.log('schema ok · categorias novas presentes:', rows.map(r => r.codigo).join(', ') || 'nenhuma');
  } catch (e) {
    console.error('bootstrapSchema falhou:', e.message);
  }
  // Controle de faturas: tabelas próprias, sem tocar em nada do DRE.
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.fatura_tipos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ativo BOOLEAN NOT NULL DEFAULT true,
      ordem INT NOT NULL DEFAULT 100
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.faturas (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      tipo_nome TEXT NOT NULL DEFAULT '',
      competencia DATE NOT NULL,
      vencimento DATE,
      valor NUMERIC(14,2) NOT NULL DEFAULT 0,
      movimento TEXT NOT NULL DEFAULT 'pagar' CHECK (movimento IN ('pagar','receber')),
      conferida BOOLEAN NOT NULL DEFAULT false,
      conferida_por INT REFERENCES dre.usuarios(id),
      conferida_email TEXT,
      conferida_em TIMESTAMPTZ,
      criado_por INT REFERENCES dre.usuarios(id),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await pool.query('ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS responsavel TEXT');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_faturas_comp
      ON dre.faturas (competencia, tipo_nome, movimento)`);
    const tiposPadrao = [['Cartão', 10], ['Azul', 20], ['Azul Viagens', 30], ['Gol', 40], ['Latam', 50], ['Consolidadora', 60]];
    for (const t of tiposPadrao) {
      await pool.query(
        `INSERT INTO dre.fatura_tipos (nome, ordem) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING`, t);
    }
    const { rows: fr } = await pool.query('SELECT count(*)::int AS n FROM dre.faturas');
    console.log('schema faturas ok · faturas no banco:', fr[0].n);
  } catch (e) {
    console.error('bootstrapSchema faturas falhou:', e.message);
  }
  // Responsáveis e checklist de cartões: também isolados do DRE.
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.responsaveis (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ativo BOOLEAN NOT NULL DEFAULT true
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.cartoes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      dia_venc INT NOT NULL CHECK (dia_venc BETWEEN 1 AND 31),
      valor_previsto NUMERIC(14,2) NOT NULL DEFAULT 0,
      inicio DATE NOT NULL,
      fim DATE,
      criado_por INT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.cartao_checks (
      id SERIAL PRIMARY KEY,
      cartao_id INT NOT NULL REFERENCES dre.cartoes(id) ON DELETE CASCADE,
      competencia DATE NOT NULL,
      vencimento DATE,
      valor NUMERIC(14,2) NOT NULL DEFAULT 0,
      conferido BOOLEAN NOT NULL DEFAULT false,
      conferido_email TEXT,
      conferido_em TIMESTAMPTZ,
      removido BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (cartao_id, competencia)
    )`);
    console.log('schema cartoes/responsaveis ok');
  } catch (e) {
    console.error('bootstrapSchema cartoes falhou:', e.message);
  }
}
bootstrapSchema();

app.get('/api/health', (req, res) => res.json({ ok: true, versao: 'cartoes-2026-09-23' }));
app.use(express.static(require('path').join(__dirname, 'public')));

// ---------- auth middleware ----------
function auth(requiredRoles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload; // {id, email, role}
      if (requiredRoles && !requiredRoles.includes(payload.role)) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch (e) { res.status(401).json({ error: 'unauthorized' }); }
  };
}
// A auditoria é secundária: se falhar, registra no log mas não derruba a escrita.
async function logAudit(userId, acao, detalhe) {
  try {
    await pool.query('INSERT INTO dre.auditoria (usuario_id, acao, detalhe) VALUES ($1,$2,$3)', [userId, acao, detalhe]);
  } catch (e) { console.error('auditoria falhou:', e.message); }
}

// ---------- auth ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const { rows } = await pool.query('SELECT * FROM dre.usuarios WHERE email=$1', [email]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(senha, u.senha_hash))) return res.status(401).json({ error: 'credenciais inválidas' });
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { email: u.email, role: u.role } });
  } catch (e) {
    console.error('login error:', e && (e.stack || e.code || JSON.stringify(e)));
    res.status(500).json({ error: (e && e.message) || 'erro desconhecido' });
  }
});
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      'INSERT INTO dre.usuarios (email, senha_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, hash, 'usuario']
    );
    const token = jwt.sign(rows[0], JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: rows[0] });
  } catch (e) {
    console.error('register error:', e && (e.stack || e.code || JSON.stringify(e)));
    res.status(500).json({ error: (e && e.message) || 'erro desconhecido' });
  }
});

// ---------- operações ----------
app.get('/api/operacoes', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.operacoes ORDER BY id');
  res.json(rows);
});
app.patch('/api/operacoes/:id/capital-social', auth(['admin', 'usuario']), async (req, res) => {
  const { valor } = req.body;
  await pool.query('UPDATE dre.operacoes SET capital_social=$1 WHERE id=$2', [valor, req.params.id]);
  await logAudit(req.user.id, 'Editou capital social', `operacao=${req.params.id} valor=${valor}`);
  res.json({ ok: true });
});

// ---------- categorias (linhas fixas do DRE) ----------
app.get('/api/categorias', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.categorias ORDER BY ordem');
  res.json(rows);
});

// ---------- credores manuais (Passivo por loja) ----------
app.get('/api/operacoes/:opId/credores', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.credores_manuais WHERE operacao_id=$1', [req.params.opId]);
  res.json(rows);
});
app.post('/api/operacoes/:opId/credores', auth(['admin', 'usuario']), async (req, res) => {
  const { nome, mes, ano, grupo } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO dre.credores_manuais (operacao_id, nome, mes, ano, grupo) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.opId, nome, mes, ano, grupo || 'passivo']
  );
  await logAudit(req.user.id, 'Adicionou credor (Passivo)', `${req.params.opId} · ${nome} · ${mes}/${ano}`);
  res.json(rows[0]);
});
app.delete('/api/credores/:id', auth(['admin', 'usuario']), async (req, res) => {
  await pool.query('DELETE FROM dre.credores_manuais WHERE id=$1', [req.params.id]);
  await logAudit(req.user.id, 'Removeu credor (Passivo)', req.params.id);
  res.json({ ok: true });
});

// ---------- lançamentos mensais ----------
app.get('/api/lancamentos', auth(), async (req, res) => {
  const { operacaoId, ano } = req.query;
  const { rows } = await pool.query(
    `SELECT * FROM dre.lancamentos WHERE operacao_id=$1 AND ano=$2
     ORDER BY atualizado_em ASC NULLS FIRST, id ASC`, [operacaoId, ano]
  );
  res.json(rows);
});
app.put('/api/lancamentos', auth(['admin', 'usuario']), async (req, res) => {
  const { operacaoId, categoriaId, credorManualId, mes, ano, valor } = req.body;
  // ON CONFLICT não serve aqui: categoria_id/credor_manual_id são NULL em metade
  // dos casos e NULL nunca conflita com NULL no índice único — cada edição criava
  // uma LINHA NOVA, e o GET devolvia valores antigos junto com o novo.
  const params = [operacaoId, categoriaId || null, credorManualId || null, mes, ano, valor, req.user.id];
  const upd = await pool.query(
    `UPDATE dre.lancamentos SET valor=$6, atualizado_em=now(), atualizado_por=$7
      WHERE operacao_id=$1
        AND categoria_id IS NOT DISTINCT FROM $2
        AND credor_manual_id IS NOT DISTINCT FROM $3
        AND mes=$4 AND ano=$5`, params
  );
  if (upd.rowCount === 0) {
    await pool.query(
      `INSERT INTO dre.lancamentos (operacao_id, categoria_id, credor_manual_id, mes, ano, valor, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, params
    );
  }
  await logAudit(req.user.id, 'Editou valor', `op=${operacaoId} cat=${categoriaId||credorManualId} ${mes}/${ano} → ${valor}`);
  res.json({ ok: true });
});

// ---------- dívidas (Passivo geral, juros simples) ----------
app.get('/api/dividas', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.dividas ORDER BY criado_em');
  res.json(rows);
});
app.post('/api/dividas', auth(['admin', 'usuario']), async (req, res) => {
  const { credor, valorInicial, mesInicial, anoInicial, jurosMensal } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO dre.dividas (credor, valor_inicial, mes_inicial, ano_inicial, juros_mensal, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [credor, valorInicial, mesInicial, anoInicial, jurosMensal, req.user.id]
  );
  await logAudit(req.user.id, 'Adicionou dívida', `${credor} · inicial ${valorInicial}`);
  res.json(rows[0]);
});
app.delete('/api/dividas/:id', auth(['admin', 'usuario']), async (req, res) => {
  await pool.query('DELETE FROM dre.dividas WHERE id=$1', [req.params.id]);
  await logAudit(req.user.id, 'Removeu dívida', req.params.id);
  res.json({ ok: true });
});
// juros simples: valor_atualizado = valor_inicial * (1 + juros_mensal/100 * meses_decorridos)

// ---------- controle de faturas ----------
// Módulo isolado: não participa dos cálculos do DRE.
function faturaOut(r) {
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  return {
    id: r.id,
    desc: r.descricao,
    tipo: r.tipo_nome || '',
    comp: iso(r.competencia) ? iso(r.competencia).slice(0, 7) : '',
    venc: iso(r.vencimento) ? iso(r.vencimento).slice(0, 10) : '',
    valor: Number(r.valor),
    mov: r.movimento,
    responsavel: r.responsavel || '',
    conferida: r.conferida,
    por: r.conferida_email || null,
    em: iso(r.conferida_em) ? iso(r.conferida_em).slice(0, 10) : null,
  };
}
const compToDate = (comp) => (comp && /^\d{4}-\d{2}$/.test(comp) ? comp + '-01' : null);

app.get('/api/faturas', auth(), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM dre.faturas ORDER BY vencimento NULLS LAST, id');
  const { rows: tipos } = await pool.query(
    'SELECT nome FROM dre.fatura_tipos WHERE ativo ORDER BY ordem, nome');
  res.json({ faturas: rows.map(faturaOut), tipos: tipos.map(t => t.nome) });
});

app.post('/api/faturas', auth(['admin', 'usuario']), async (req, res) => {
  const { desc, tipo, comp, venc, valor, mov, responsavel } = req.body;
  if (!desc || !String(desc).trim()) return res.status(400).json({ erro: 'descricao obrigatoria' });
  const competencia = compToDate(comp) || new Date().toISOString().slice(0, 8) + '01';
  const { rows } = await pool.query(
    `INSERT INTO dre.faturas (descricao, tipo_nome, competencia, vencimento, valor, movimento, responsavel, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [String(desc).trim(), tipo || '', competencia, venc || null, valor || 0,
      mov === 'receber' ? 'receber' : 'pagar', String(responsavel || '').trim() || null, req.user.id]);
  await logAudit(req.user.id, 'Lançou fatura', `${desc} · ${valor}`);
  res.json(faturaOut(rows[0]));
});

app.patch('/api/faturas/:id', auth(['admin', 'usuario']), async (req, res) => {
  const { tipo, comp, venc, valor, mov, desc, conferida, responsavel } = req.body;
  const sets = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
  if (desc !== undefined) add('descricao', String(desc).trim());
  if (tipo !== undefined) add('tipo_nome', tipo || '');
  if (comp !== undefined) add('competencia', compToDate(comp));
  if (venc !== undefined) add('vencimento', venc || null);
  if (valor !== undefined) add('valor', valor || 0);
  if (mov !== undefined) add('movimento', mov === 'receber' ? 'receber' : 'pagar');
  if (responsavel !== undefined) add('responsavel', String(responsavel || '').trim() || null);
  if (conferida !== undefined) {
    add('conferida', !!conferida);
    add('conferida_por', conferida ? req.user.id : null);
    add('conferida_email', conferida ? req.user.email : null);
    sets.push(conferida ? 'conferida_em=now()' : 'conferida_em=NULL');
  }
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
  sets.push('atualizado_em=now()');
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE dre.faturas SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows.length) return res.status(404).json({ erro: 'fatura inexistente' });
  if (conferida !== undefined) {
    await logAudit(req.user.id, conferida ? 'Conferiu fatura' : 'Desfez conferência de fatura', rows[0].descricao);
  }
  res.json(faturaOut(rows[0]));
});

app.delete('/api/faturas/:id', auth(['admin', 'usuario']), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM dre.faturas WHERE id=$1 RETURNING descricao', [req.params.id]);
  await logAudit(req.user.id, 'Removeu fatura', (rows[0] && rows[0].descricao) || req.params.id);
  res.json({ ok: true });
});

app.post('/api/faturas/tipos', auth(['admin', 'usuario']), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  await pool.query(
    'INSERT INTO dre.fatura_tipos (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo=true', [nome]);
  const { rows } = await pool.query(
    'SELECT nome FROM dre.fatura_tipos WHERE ativo ORDER BY ordem, nome');
  res.json({ tipos: rows.map(t => t.nome) });
});

// Apaga um tipo de fatura. Desativa (ativo=false) para não perder o histórico
// das faturas já lançadas com esse nome.
app.delete('/api/faturas/tipos/:nome', auth(['admin', 'usuario']), async (req, res) => {
  const nome = String(req.params.nome || '').trim();
  const { rows: uso } = await pool.query(
    'SELECT count(*)::int AS n FROM dre.faturas WHERE tipo_nome=$1', [nome]);
  if (uso[0].n > 0) return res.status(409).json({ erro: 'tipo em uso', usadas: uso[0].n });
  await pool.query('UPDATE dre.fatura_tipos SET ativo=false WHERE nome=$1', [nome]);
  await logAudit(req.user.id, 'Removeu tipo de fatura', nome);
  const { rows } = await pool.query(
    'SELECT nome FROM dre.fatura_tipos WHERE ativo ORDER BY ordem, nome');
  res.json({ tipos: rows.map(t => t.nome) });
});

// ---------- responsáveis ----------
app.get('/api/responsaveis', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM dre.responsaveis WHERE ativo ORDER BY nome');
  res.json({ responsaveis: rows.map(r => r.nome) });
});
app.post('/api/responsaveis', auth(['admin', 'usuario']), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  await pool.query(
    'INSERT INTO dre.responsaveis (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo=true', [nome]);
  await logAudit(req.user.id, 'Cadastrou responsável', nome);
  res.json({ ok: true });
});
// Desativa: faturas antigas continuam mostrando o nome gravado.
app.delete('/api/responsaveis/:nome', auth(['admin', 'usuario']), async (req, res) => {
  const nome = String(req.params.nome || '').trim();
  await pool.query('UPDATE dre.responsaveis SET ativo=false WHERE nome=$1', [nome]);
  await logAudit(req.user.id, 'Removeu responsável', nome);
  res.json({ ok: true });
});

// ---------- checklist de cartões ----------
// Cada cartão ativo gera uma linha por competência (replicação automática),
// com o mesmo nome e dia de vencimento; o valor parte do último mês lançado.
const CARTAO_OUT = `c.id, c.nome, c.dia_venc AS dia, c.valor_previsto::float AS valor,
  to_char(c.inicio,'YYYY-MM') AS inicio, to_char(c.fim,'YYYY-MM') AS fim`;
const CHECK_OUT = `k.id, k.cartao_id AS "cartaoId", to_char(k.competencia,'YYYY-MM') AS comp, c.nome,
  to_char(k.vencimento,'YYYY-MM-DD') AS venc, k.valor::float AS valor, k.conferido,
  k.conferido_email AS por, to_char(k.conferido_em,'YYYY-MM-DD') AS em, k.removido`;

app.get('/api/cartoes', auth(), async (req, res) => {
  const comp = compToDate(req.query.comp) || new Date().toISOString().slice(0, 8) + '01';
  await pool.query(
    `INSERT INTO dre.cartao_checks (cartao_id, competencia, vencimento, valor)
     SELECT c.id, $1::date,
       $1::date + (LEAST(c.dia_venc, EXTRACT(DAY FROM ($1::date + interval '1 month' - interval '1 day'))::int) - 1),
       COALESCE((SELECT k.valor FROM dre.cartao_checks k
                 WHERE k.cartao_id=c.id AND k.competencia < $1::date AND NOT k.removido
                 ORDER BY k.competencia DESC LIMIT 1), c.valor_previsto)
     FROM dre.cartoes c
     WHERE c.inicio <= $1::date AND (c.fim IS NULL OR c.fim > $1::date)
     ON CONFLICT (cartao_id, competencia) DO NOTHING`, [comp]);
  const { rows: cartoes } = await pool.query(
    `SELECT ${CARTAO_OUT} FROM dre.cartoes c WHERE c.fim IS NULL ORDER BY c.dia_venc, c.nome`);
  const { rows: checks } = await pool.query(
    `SELECT ${CHECK_OUT} FROM dre.cartao_checks k JOIN dre.cartoes c ON c.id=k.cartao_id
     WHERE k.competencia=$1::date ORDER BY k.vencimento, c.nome`, [comp]);
  res.json({ cartoes, checks });
});

app.post('/api/cartoes', auth(['admin', 'usuario']), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const dia = Math.min(31, Math.max(1, parseInt(req.body.dia, 10) || 1));
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  const inicio = compToDate(req.body.comp) || new Date().toISOString().slice(0, 8) + '01';
  const { rows } = await pool.query(
    `INSERT INTO dre.cartoes (nome, dia_venc, valor_previsto, inicio, criado_por)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [nome, dia, Number(req.body.valor) || 0, inicio, req.user.id]);
  await logAudit(req.user.id, 'Cadastrou cartão', `${nome} · dia ${dia}`);
  res.json({ id: rows[0].id });
});

app.patch('/api/cartoes/:id', auth(['admin', 'usuario']), async (req, res) => {
  const { nome, dia, valor } = req.body;
  const sets = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
  if (nome !== undefined) add('nome', String(nome).trim());
  if (dia !== undefined) add('dia_venc', Math.min(31, Math.max(1, parseInt(dia, 10) || 1)));
  if (valor !== undefined) add('valor_previsto', Number(valor) || 0);
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
  vals.push(req.params.id);
  await pool.query(`UPDATE dre.cartoes SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  res.json({ ok: true });
});

// Exclui a partir de uma competência: meses anteriores ficam preservados.
app.delete('/api/cartoes/:id', auth(['admin', 'usuario']), async (req, res) => {
  const comp = compToDate(req.query.comp) || new Date().toISOString().slice(0, 8) + '01';
  const { rows } = await pool.query('SELECT nome, inicio FROM dre.cartoes WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ erro: 'cartao inexistente' });
  await pool.query(
    'DELETE FROM dre.cartao_checks WHERE cartao_id=$1 AND competencia >= $2::date AND NOT conferido',
    [req.params.id, comp]);
  await pool.query(
    `UPDATE dre.cartoes SET fim=$2::date WHERE id=$1`, [req.params.id, comp]);
  await logAudit(req.user.id, 'Excluiu cartão', `${rows[0].nome} a partir de ${comp.slice(0, 7)}`);
  res.json({ ok: true });
});

app.patch('/api/cartoes/checks/:id', auth(['admin', 'usuario']), async (req, res) => {
  const { conferido, valor, removido } = req.body;
  const sets = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
  if (valor !== undefined) add('valor', Number(valor) || 0);
  if (removido !== undefined) add('removido', !!removido);
  if (conferido !== undefined) {
    add('conferido', !!conferido);
    add('conferido_email', conferido ? req.user.email : null);
    sets.push(conferido ? 'conferido_em=now()' : 'conferido_em=NULL');
  }
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE dre.cartao_checks k SET ${sets.join(', ')} FROM dre.cartoes c
     WHERE k.id=$${vals.length} AND c.id=k.cartao_id RETURNING c.nome, k.competencia`, vals);
  if (!rows.length) return res.status(404).json({ erro: 'item inexistente' });
  if (conferido !== undefined) {
    await logAudit(req.user.id, conferido ? 'Conferiu cartão' : 'Desfez conferência de cartão', rows[0].nome);
  }
  res.json({ ok: true });
});

// ---------- usuários (admin) ----------
app.get('/api/usuarios', auth(['admin']), async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, role FROM dre.usuarios ORDER BY id');
  res.json(rows);
});
app.post('/api/usuarios', auth(['admin']), async (req, res) => {
  const { email, senha, role } = req.body;
  const hash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    'INSERT INTO dre.usuarios (email, senha_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
    [email, hash, role]
  );
  await logAudit(req.user.id, 'Criou usuário', `${email} (${role})`);
  res.json(rows[0]);
});
app.patch('/api/usuarios/:id/role', auth(['admin']), async (req, res) => {
  await pool.query('UPDATE dre.usuarios SET role=$1 WHERE id=$2', [req.body.role, req.params.id]);
  await logAudit(req.user.id, 'Alterou papel', `${req.params.id} → ${req.body.role}`);
  res.json({ ok: true });
});
app.patch('/api/usuarios/:id/senha', auth(['admin']), async (req, res) => {
  const hash = await bcrypt.hash(req.body.senha, 10);
  await pool.query('UPDATE dre.usuarios SET senha_hash=$1 WHERE id=$2', [hash, req.params.id]);
  await logAudit(req.user.id, 'Alterou senha', req.params.id);
  res.json({ ok: true });
});

// ---------- auditoria ----------
app.get('/api/auditoria', auth(['admin']), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, u.email FROM dre.auditoria a LEFT JOIN dre.usuarios u ON u.id=a.usuario_id
     ORDER BY a.id DESC LIMIT 200`
  );
  res.json(rows);
});

// ---------- locks de campo (edição simultânea) ----------
// Produção: trocar por Redis + WebSocket/SSE para push em tempo real.
// TTL de 8s: se não houver heartbeat, o lock expira e é ignorado.
app.post('/api/locks/:campoKey', auth(), async (req, res) => {
  await pool.query(
    `INSERT INTO dre.locks_campo (campo_key, usuario_id, atualizado_em) VALUES ($1,$2,now())
     ON CONFLICT (campo_key) DO UPDATE SET usuario_id=$2, atualizado_em=now()`,
    [req.params.campoKey, req.user.id]
  );
  res.json({ ok: true });
});
app.delete('/api/locks/:campoKey', auth(), async (req, res) => {
  await pool.query('DELETE FROM dre.locks_campo WHERE campo_key=$1 AND usuario_id=$2', [req.params.campoKey, req.user.id]);
  res.json({ ok: true });
});
app.get('/api/locks', auth(), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.campo_key, u.email FROM dre.locks_campo l JOIN dre.usuarios u ON u.id=l.usuario_id
     WHERE l.atualizado_em > now() - interval '8 seconds'`
  );
  res.json(rows);
});

app.use((err, req, res, next) => {
  console.error('erro não tratado:', err && (err.stack || err.message || err));
  if (res.headersSent) return next(err);
  res.status(500).json({ error: (err && err.message) || 'erro interno' });
});

app.listen(process.env.PORT || 3001, () => console.log('DRE Azul backend on :' + (process.env.PORT || 3001)));
