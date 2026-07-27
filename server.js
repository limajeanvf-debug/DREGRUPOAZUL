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

app.get('/api/health', (req, res) => res.json({ ok: true }));
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
async function logAudit(userId, acao, detalhe) {
  await pool.query('INSERT INTO dre.auditoria (usuario_id, acao, detalhe) VALUES ($1,$2,$3)', [userId, acao, detalhe]);
}

// ---------- auth ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const { rows } = await pool.query('SELECT * FROM dre.usuarios WHERE email=$1', [email]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(senha, u.senha_hash))) return res.status(401).json({ error: 'credenciais inválidas' });
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { email: u.email, role: u.role } });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: e.message });
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
    const token = jwt.sign(rows[0], JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: rows[0] });
  } catch (e) {
    console.error('register error:', e.message);
    res.status(500).json({ error: e.message });
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
  const { nome } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO dre.credores_manuais (operacao_id, nome) VALUES ($1,$2) RETURNING *',
    [req.params.opId, nome]
  );
  await logAudit(req.user.id, 'Adicionou credor (Passivo)', `${req.params.opId} · ${nome}`);
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
    'SELECT * FROM dre.lancamentos WHERE operacao_id=$1 AND ano=$2', [operacaoId, ano]
  );
  res.json(rows);
});
app.put('/api/lancamentos', auth(['admin', 'usuario']), async (req, res) => {
  const { operacaoId, categoriaId, credorManualId, mes, ano, valor } = req.body;
  await pool.query(
    `INSERT INTO dre.lancamentos (operacao_id, categoria_id, credor_manual_id, mes, ano, valor, atualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (operacao_id, categoria_id, credor_manual_id, mes, ano)
     DO UPDATE SET valor=$6, atualizado_em=now(), atualizado_por=$7`,
    [operacaoId, categoriaId || null, credorManualId || null, mes, ano, valor, req.user.id]
  );
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

app.listen(process.env.PORT || 3001, () => console.log('DRE Azul backend on :' + (process.env.PORT || 3001)));
