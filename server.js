// DRE Grupo Azul — backend skeleton (Node + Express + PostgreSQL)
// Implements the API the frontend needs. Fill in TODOs; wire to schema.sql.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { logger, requestId, httpLog } = require('./logger');

const app = express();
app.set('trust proxy', 1);
app.use(requestId);
app.use(httpLog);
app.use(cors({ exposedHeaders: ['X-Request-Id'] }));
app.use(express.json({ limit: '8mb' }));
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
    logger.info('schema ok · categorias novas presentes: ' + (rows.map(r => r.codigo).join(', ') || 'nenhuma'));
  } catch (e) {
    logger.error('bootstrapSchema falhou: ' + (e.message));
  }
  try {
    await pool.query('ALTER TABLE dre.usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB');
  } catch (e) { logger.error('permissoes falhou: ' + (e.message)); }
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
    await pool.query('ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido BOOLEAN NOT NULL DEFAULT false');
    await pool.query('ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_email TEXT');
    await pool.query('ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_em TIMESTAMPTZ');
    await pool.query('ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_banco TEXT');
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.bancos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ativo BOOLEAN NOT NULL DEFAULT true
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_faturas_comp
      ON dre.faturas (competencia, tipo_nome, movimento)`);
    const tiposPadrao = [['Cartão', 10], ['Azul', 20], ['Azul Viagens', 30], ['Gol', 40], ['Latam', 50], ['Consolidadora', 60]];
    for (const t of tiposPadrao) {
      await pool.query(
        `INSERT INTO dre.fatura_tipos (nome, ordem) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING`, t);
    }
    const { rows: fr } = await pool.query('SELECT count(*)::int AS n FROM dre.faturas');
    logger.info('schema faturas ok · faturas no banco: ' + (fr[0].n));
  } catch (e) {
    logger.error('bootstrapSchema faturas falhou: ' + (e.message));
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
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.faturas_adm_tipos (
      nome TEXT PRIMARY KEY,
      ativo BOOLEAN NOT NULL DEFAULT true,
      ordem INT NOT NULL DEFAULT 100
    )`);
    const admPadrao = ['Aluguel','Energia','Água','Internet','Telefone','Contabilidade','Impostos','Manutenção','Outros'];
    for (let i = 0; i < admPadrao.length; i++) {
      await pool.query('INSERT INTO dre.faturas_adm_tipos (nome, ordem) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING', [admPadrao[i], (i + 1) * 10]);
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.faturas_adm (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT '',
      loja TEXT NOT NULL DEFAULT '',
      vencimento DATE,
      valor NUMERIC(14,2) NOT NULL DEFAULT 0,
      pago BOOLEAN NOT NULL DEFAULT false,
      pago_email TEXT,
      pago_em TIMESTAMPTZ,
      criado_por INT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    logger.info('schema cartoes/responsaveis/adm ok');
  } catch (e) {
    logger.error('bootstrapSchema cartoes falhou: ' + (e.message));
  }
}
bootstrapSchema().then(bootstrapModulos)
  .then(() => bootstrapHelpdesk())
  .then(() => comercial.bootstrap())
  .then(() => fatDiario.bootstrap())
  .catch(e => logger.error('módulos (bootstrap) falhou: ' + (e.message)));

app.get('/api/health', (req, res) => res.json({ ok: true, versao: 'helpdesk-modulo-2026-10-27b',
  helpdeskTela: require('fs').existsSync(require('path').join(__dirname, 'modulos', 'helpdesk-azul', 'public', 'index.html')) }));
// ---------- Help Desk (módulo modulos/helpdesk-azul, montado em /helpdesk) ----------
// Login único: o usuário vem do token do Sistema Grupo Azul (cookie hd_token ou header Authorization).
// Perfil pela permissão "Help desk": admin → Administrador · editar → Help desk · ver → Agente.
const HD_DIR = require('path').join(__dirname, 'modulos', 'helpdesk-azul');
const HD_LOCAL = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost'));
process.env.DB_SCHEMA = process.env.DB_SCHEMA || 'helpdesk_azul'; // schema próprio: o antigo "helpdesk" tem outra estrutura
process.env.DB_SSL = HD_LOCAL ? 'false' : 'true';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('path').join(HD_DIR, 'uploads');
function lerCookie(req, nome) {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(nome + '='));
  return c ? decodeURIComponent(c.slice(nome.length + 1)) : '';
}
// Tela do help desk servida explicitamente (se faltar no deploy, mostra o motivo em vez de "Cannot GET").
app.get(['/helpdesk', '/helpdesk/', '/helpdesk/index.html'], (req, res, next) => {
  if (req.path === '/helpdesk') return res.redirect(301, '/helpdesk/');
  const f = require('path').join(HD_DIR, 'public', 'index.html');
  if (!require('fs').existsSync(f)) return res.status(500).send('Help desk: arquivo modulos/helpdesk-azul/public/index.html não foi enviado ao servidor.');
  res.set('Cache-Control', 'no-cache').sendFile(f);
});
const criarHelpdesk = require('./modulos/helpdesk-azul');
app.use('/helpdesk', criarHelpdesk({
  obterUsuario: async req => {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || String((req.query && req.query.t) || '') || lerCookie(req, 'hd_token');
    if (!token) return null;
    let p; try { p = jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
    if (p.tipo) return null;
    const { rows } = await pool.query('SELECT id, email, role, permissoes FROM dre.usuarios WHERE id=$1', [p.id]);
    const u = rows[0];
    if (!u) return null;
    const nivel = permsDe(u).helpdesk;
    if (nivel === 'nenhum') return null;
    return { id: 'dre-' + u.id, email: u.email, perfil: u.role === 'admin' ? 'admin' : nivel === 'editar' ? 'suporte' : 'agente' };
  },
  perfilPeloSistema: true,
  urlEntrar: '/',
  urlPublica: (process.env.APP_URL || 'https://dregrupoazul.onrender.com') + '/helpdesk',
  banco: { connectionString: process.env.DATABASE_URL, ssl: !HD_LOCAL, schema: process.env.DB_SCHEMA },
  pastaUploads: process.env.UPLOAD_DIR,
}));
// Cria as tabelas do help desk e importa os dados atuais (o importador ignora o que já existe).
async function bootstrapHelpdesk() {
  const fs = require('fs'), path = require('path');
  const hdDb = require('./modulos/helpdesk-azul/src/db');
  const schema = hdDb.schema;
  const sql = fs.readFileSync(path.join(HD_DIR, 'database', 'schema.sql'), 'utf8')
    .replace('CREATE SCHEMA IF NOT EXISTS helpdesk;', `CREATE SCHEMA IF NOT EXISTS ${schema};`)
    .replace('SET search_path TO helpdesk, public;', `SET search_path TO ${schema}, public;`);
  await hdDb.pool.query(sql);
  logger.info(`help desk: tabelas ok no schema "${schema}"`);
  if (fs.existsSync(path.join(HD_DIR, 'dados-importacao'))) {
    await new Promise(resolve => {
      const p = require('child_process').spawn(process.execPath, [path.join(HD_DIR, 'scripts', 'importar-claude.js')], { env: process.env, stdio: 'inherit' });
      p.on('exit', resolve); p.on('error', e => { logger.error('help desk: importação falhou: ' + (e.message)); resolve(); });
    });
  }
}
// no-cache = o navegador sempre confere se há versão nova (ETag), então um deploy aparece sem Ctrl+F5.
app.use(express.static(require('path').join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
// Comercial: relatórios de vendas, rotas em /api/comercial.
const comercial = require('./comercial')(app, { pool, permMin, logAudit });
// Financeiro · Faturamento diário (Azul Viagens, Sonho Azul, Arranjos Express), rotas em /api/fatdiario.
const fatDiario = require('./fatdiario')(app, { pool, permMin, logAudit });

// ---------- auth middleware ----------
function auth(requiredRoles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.tipo) return res.status(401).json({ error: 'unauthorized' }); // token do Portal do Colaborador
      req.user = payload; // {id, email, role}
      if (requiredRoles && !requiredRoles.includes(payload.role)) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch (e) { res.status(401).json({ error: 'unauthorized' }); }
  };
}
// ---------- permissões por aba ----------
// nenhum = aba oculta · ver = somente leitura · editar = leitura e escrita.
// Sem registro salvo, vale o papel: leitor → ver, usuario → editar. Admin sempre editar.
const ABAS = ['operacao', 'consolidacao', 'balanco', 'passivo', 'faturas', 'contasadm', 'importacao', 'conferencia', 'fatdiario', 'helpdesk', 'rh', 'comercial'];
// Módulos novos têm padrão próprio: todos abrem chamados; RH fica fechado até o admin liberar.
const PADRAO_MOD = { helpdesk: 'ver', rh: 'nenhum', comercial: 'nenhum' };
const RANK = { nenhum: 0, ver: 1, editar: 2 };
const NIVEIS = ['nenhum', 'ver', 'editar'];
function permsDe(u) {
  const base = u.role === 'leitor' ? 'ver' : 'editar';
  const p = (u.permissoes && typeof u.permissoes === 'object') ? u.permissoes : {};
  const out = {};
  ABAS.forEach(a => { out[a] = u.role === 'admin' ? 'editar' : (NIVEIS.includes(p[a]) ? p[a] : (PADRAO_MOD[a] || base)); });
  // Aba nova: quem não tem registro herda o nível de "Por operação".
  if (u.role !== 'admin' && !NIVEIS.includes(p.importacao)) out.importacao = out.operacao;
  if (u.role !== 'admin' && !NIVEIS.includes(p.contasadm)) out.contasadm = out.faturas;
  if (u.role !== 'admin' && !NIVEIS.includes(p.fatdiario)) out.fatdiario = out.operacao;
  return out;
}
// Lê do banco a cada escrita: a mudança feita pelo admin vale sem novo login.
function perm(abas) {
  const lista = [].concat(abas);
  return async (req, res, next) => {
    let payload;
    try { payload = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); }
    catch (e) { return res.status(401).json({ error: 'unauthorized' }); }
    try {
      const { rows } = await pool.query('SELECT id, email, role, permissoes FROM dre.usuarios WHERE id=$1', [payload.id]);
      if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
      req.user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
      const p = permsDe(rows[0]);
      if (!lista.some(a => p[a] === 'editar')) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch (e) { next(e); }
  };
}
// A auditoria é secundária: se falhar, registra no log mas não derruba a escrita.
async function logAudit(userId, acao, detalhe) {
  try {
    await pool.query('INSERT INTO dre.auditoria (usuario_id, acao, detalhe) VALUES ($1,$2,$3)', [userId, acao, detalhe]);
  } catch (e) { logger.error('auditoria falhou: ' + (e.message)); }
}

// ---------- auth ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const { rows } = await pool.query('SELECT * FROM dre.usuarios WHERE lower(email)=lower($1) ORDER BY id LIMIT 1', [String(email || '').trim()]);
    const u = rows[0];
    if (!u || !senha || !(await bcrypt.compare(senha, u.senha_hash))) return res.status(401).json({ error: 'credenciais inválidas' });
    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { email: u.email, role: u.role, permissoes: permsDe(u) } });
  } catch (e) {
    (req.log || logger).error('falha no login: ' + ((e && e.message) || e), { codigo: e && e.code, stack: e && e.stack });
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
    (req.log || logger).error('falha no cadastro: ' + ((e && e.message) || e), { codigo: e && e.code, stack: e && e.stack });
    res.status(500).json({ error: (e && e.message) || 'erro desconhecido' });
  }
});

app.get('/api/me', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT email, role, permissoes FROM dre.usuarios WHERE id=$1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
  res.json({ email: rows[0].email, role: rows[0].role, permissoes: permsDe(rows[0]) });
});

// ---------- operações ----------
app.get('/api/operacoes', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.operacoes ORDER BY id');
  res.json(rows);
});
app.patch('/api/operacoes/:id/capital-social', perm(['operacao', 'consolidacao', 'balanco']), async (req, res) => {
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
app.post('/api/operacoes/:opId/credores', perm(['operacao', 'consolidacao', 'balanco']), async (req, res) => {
  const { nome, mes, ano, grupo } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO dre.credores_manuais (operacao_id, nome, mes, ano, grupo) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.opId, nome, mes, ano, grupo || 'passivo']
  );
  await logAudit(req.user.id, 'Adicionou credor (Passivo)', `${req.params.opId} · ${nome} · ${mes}/${ano}`);
  res.json(rows[0]);
});
app.delete('/api/credores/:id', perm(['operacao', 'consolidacao', 'balanco']), async (req, res) => {
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
app.put('/api/lancamentos', perm(['operacao', 'consolidacao', 'balanco']), async (req, res) => {
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
app.post('/api/dividas', perm('passivo'), async (req, res) => {
  const { credor, valorInicial, mesInicial, anoInicial, jurosMensal } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO dre.dividas (credor, valor_inicial, mes_inicial, ano_inicial, juros_mensal, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [credor, valorInicial, mesInicial, anoInicial, jurosMensal, req.user.id]
  );
  await logAudit(req.user.id, 'Adicionou dívida', `${credor} · inicial ${valorInicial}`);
  res.json(rows[0]);
});
app.delete('/api/dividas/:id', perm('passivo'), async (req, res) => {
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
    recebido: !!r.recebido,
    recPor: r.recebido_email || null,
    recBanco: r.recebido_banco || '',
    recEm: iso(r.recebido_em) ? iso(r.recebido_em).slice(0, 10) : null,
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

app.post('/api/faturas', perm('faturas'), async (req, res) => {
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

app.patch('/api/faturas/:id', perm('faturas'), async (req, res) => {
  const { tipo, comp, venc, valor, mov, desc, conferida, responsavel, recebido, recBanco } = req.body;
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
  if (recBanco !== undefined) add('recebido_banco', String(recBanco || '').trim() || null);
  if (recebido !== undefined) {
    add('recebido', !!recebido);
    add('recebido_email', recebido ? req.user.email : null);
    sets.push(recebido ? 'recebido_em=now()' : 'recebido_em=NULL');
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
  if (recebido !== undefined) {
    await logAudit(req.user.id, recebido ? 'Confirmou recebimento na conta' : 'Desfez confirmação de recebimento', rows[0].descricao);
  }
  res.json(faturaOut(rows[0]));
});

app.delete('/api/faturas/:id', perm('faturas'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM dre.faturas WHERE id=$1 RETURNING descricao', [req.params.id]);
  await logAudit(req.user.id, 'Removeu fatura', (rows[0] && rows[0].descricao) || req.params.id);
  res.json({ ok: true });
});

app.post('/api/faturas/tipos', perm('faturas'), async (req, res) => {
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
app.delete('/api/faturas/tipos/:nome', perm('faturas'), async (req, res) => {
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
app.post('/api/responsaveis', perm('faturas'), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  await pool.query(
    'INSERT INTO dre.responsaveis (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo=true', [nome]);
  await logAudit(req.user.id, 'Cadastrou responsável', nome);
  res.json({ ok: true });
});
// Desativa: faturas antigas continuam mostrando o nome gravado.
app.delete('/api/responsaveis/:nome', perm('faturas'), async (req, res) => {
  const nome = String(req.params.nome || '').trim();
  await pool.query('UPDATE dre.responsaveis SET ativo=false WHERE nome=$1', [nome]);
  await logAudit(req.user.id, 'Removeu responsável', nome);
  res.json({ ok: true });
});

// ---------- bancos (recebimentos) ----------
app.get('/api/bancos', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM dre.bancos WHERE ativo ORDER BY nome');
  res.json({ bancos: rows.map(r => r.nome) });
});
app.post('/api/bancos', perm('faturas'), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  await pool.query('INSERT INTO dre.bancos (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo=true', [nome]);
  await logAudit(req.user.id, 'Cadastrou banco', nome);
  res.json({ ok: true });
});
app.delete('/api/bancos/:nome', perm('faturas'), async (req, res) => {
  const nome = String(req.params.nome || '').trim();
  await pool.query('UPDATE dre.bancos SET ativo=false WHERE nome=$1', [nome]);
  await logAudit(req.user.id, 'Removeu banco', nome);
  res.json({ ok: true });
});

// ---------- faturas administrativas ----------
const admOut = r => ({
  id: r.id, nome: r.nome, tipo: r.tipo, loja: r.loja,
  venc: r.vencimento ? new Date(r.vencimento).toISOString().slice(0, 10) : '',
  valor: Number(r.valor), pago: !!r.pago, por: r.pago_email || null,
});
app.get('/api/faturas-adm', auth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM dre.faturas_adm ORDER BY vencimento NULLS LAST, id');
  const { rows: tipos } = await pool.query('SELECT nome FROM dre.faturas_adm_tipos WHERE ativo ORDER BY ordem, nome');
  res.json({ itens: rows.map(admOut), tipos: tipos.map(t => t.nome) });
});
app.post('/api/faturas-adm/tipos', perm(['faturas', 'contasadm']), async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  await pool.query('INSERT INTO dre.faturas_adm_tipos (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET ativo=true', [nome]);
  res.json({ ok: true });
});
app.delete('/api/faturas-adm/tipos/:nome', perm(['faturas', 'contasadm']), async (req, res) => {
  const nome = String(req.params.nome || '').trim();
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM dre.faturas_adm WHERE tipo=$1', [nome]);
  if (rows[0].n > 0) return res.status(409).json({ erro: 'tipo em uso' });
  await pool.query('UPDATE dre.faturas_adm_tipos SET ativo=false WHERE nome=$1', [nome]);
  res.json({ ok: true });
});
app.post('/api/faturas-adm', perm(['faturas', 'contasadm']), async (req, res) => {
  const { nome, tipo, loja, venc, valor } = req.body;
  if (!String(nome || '').trim()) return res.status(400).json({ erro: 'nome obrigatorio' });
  const { rows } = await pool.query(
    `INSERT INTO dre.faturas_adm (nome, tipo, loja, vencimento, valor, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [String(nome).trim(), tipo || '', loja || '', venc || null, Number(valor) || 0, req.user.id]);
  await logAudit(req.user.id, 'Lançou fatura administrativa', `${rows[0].nome} · ${rows[0].loja}`);
  res.json(admOut(rows[0]));
});
app.patch('/api/faturas-adm/:id', perm(['faturas', 'contasadm']), async (req, res) => {
  const { nome, tipo, loja, venc, valor, pago } = req.body;
  const sets = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); sets.push(`${sql}=$${vals.length}`); };
  if (nome !== undefined) add('nome', String(nome).trim());
  if (tipo !== undefined) add('tipo', tipo || '');
  if (loja !== undefined) add('loja', loja || '');
  if (venc !== undefined) add('vencimento', venc || null);
  if (valor !== undefined) add('valor', Number(valor) || 0);
  if (pago !== undefined) {
    add('pago', !!pago);
    add('pago_email', pago ? req.user.email : null);
    sets.push(pago ? 'pago_em=now()' : 'pago_em=NULL');
  }
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE dre.faturas_adm SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows.length) return res.status(404).json({ erro: 'fatura inexistente' });
  if (pago !== undefined) {
    await logAudit(req.user.id, pago ? 'Pagou fatura administrativa' : 'Reabriu fatura administrativa', rows[0].nome);
  }
  res.json(admOut(rows[0]));
});
app.delete('/api/faturas-adm/:id', perm(['faturas', 'contasadm']), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM dre.faturas_adm WHERE id=$1 RETURNING nome, loja', [req.params.id]);
  if (rows.length) await logAudit(req.user.id, 'Excluiu fatura administrativa', `${rows[0].nome} · ${rows[0].loja}`);
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

app.post('/api/cartoes', perm('faturas'), async (req, res) => {
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

app.patch('/api/cartoes/:id', perm('faturas'), async (req, res) => {
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
app.delete('/api/cartoes/:id', perm('faturas'), async (req, res) => {
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

app.patch('/api/cartoes/checks/:id', perm('faturas'), async (req, res) => {
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
  const { rows } = await pool.query('SELECT id, email, role, permissoes FROM dre.usuarios ORDER BY id');
  res.json(rows.map(u => ({ id: u.id, email: u.email, role: u.role, permissoes: permsDe(u) })));
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
app.patch('/api/usuarios/:id/permissoes', auth(['admin']), async (req, res) => {
  const inp = req.body.permissoes || {};
  const p = {};
  ABAS.forEach(a => { if (NIVEIS.includes(inp[a])) p[a] = inp[a]; });
  const { rows } = await pool.query('UPDATE dre.usuarios SET permissoes=$1 WHERE id=$2 RETURNING email', [JSON.stringify(p), req.params.id]);
  await logAudit(req.user.id, 'Alterou permissões', `${(rows[0] && rows[0].email) || req.params.id} · ${ABAS.map(a => a + ':' + (p[a] || '-')).join(' ')}`);
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


// ---------- módulos: Help desk e RH ----------
async function bootstrapModulos() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.hd_chamados (
      id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT 'Outros',
      prioridade TEXT NOT NULL DEFAULT 'Média', loja TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Novo', solicitante_id INT, solicitante_email TEXT NOT NULL,
      responsavel_email TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), resolvido_em TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.hd_mensagens (
      id SERIAL PRIMARY KEY, chamado_id INT NOT NULL REFERENCES dre.hd_chamados(id) ON DELETE CASCADE,
      autor_email TEXT NOT NULL, texto TEXT NOT NULL, interno BOOLEAN NOT NULL DEFAULT false,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.rh_colaboradores (
      id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '', loja TEXT NOT NULL DEFAULT '',
      admissao DATE, salario NUMERIC(14,2) NOT NULL DEFAULT 0, telefone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT true, desligamento DATE, criado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.rh_ausencias (
      id SERIAL PRIMARY KEY, colaborador_id INT NOT NULL REFERENCES dre.rh_colaboradores(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL, inicio DATE NOT NULL, fim DATE NOT NULL, obs TEXT NOT NULL DEFAULT '',
      criado_por TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // Painel RH / Portal do Colaborador (Unifica RH): uma linha JSON por coleção.
    await pool.query(`CREATE TABLE IF NOT EXISTS dre.rh_store (
      chave TEXT PRIMARY KEY, valor JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_por TEXT)`);
  } catch (e) { logger.error('módulos (help desk/RH) falhou: ' + (e.message)); }
}
// Confere o nível mínimo no módulo lendo o usuário do banco a cada requisição.
function permMin(aba, min) {
  return async (req, res, next) => {
    let payload;
    try { payload = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); }
    catch (e) { return res.status(401).json({ error: 'unauthorized' }); }
    try {
      const { rows } = await pool.query('SELECT id, email, role, permissoes FROM dre.usuarios WHERE id=$1', [payload.id]);
      if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
      req.user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
      req.perms = permsDe(rows[0]);
      if (RANK[req.perms[aba]] < RANK[min]) return res.status(403).json({ error: 'forbidden' });
      next();
    } catch (e) { next(e); }
  };
}
const HD_PRIOS = ['Baixa', 'Média', 'Alta', 'Urgente'];
const HD_STATUS = ['Novo', 'Em atendimento', 'Aguardando solicitante', 'Aguardando fornecedor', 'Resolvido'];
async function hdCarregar(where, params, verInterno) {
  const { rows } = await pool.query(`SELECT * FROM dre.hd_chamados ${where} ORDER BY criado_em DESC LIMIT 500`, params);
  if (!rows.length) return [];
  const { rows: msgs } = await pool.query(
    `SELECT * FROM dre.hd_mensagens WHERE chamado_id = ANY($1) ${verInterno ? '' : 'AND NOT interno'} ORDER BY criado_em`,
    [rows.map(r => r.id)]);
  return rows.map(r => ({
    id: r.id, numero: r.id, titulo: r.titulo, categoria: r.categoria, prioridade: r.prioridade, loja: r.loja,
    descricao: r.descricao, status: r.status, solicitante: r.solicitante_email, responsavel: r.responsavel_email || '',
    criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, resolvidoEm: r.resolvido_em,
    mensagens: msgs.filter(m => m.chamado_id === r.id).map(m => ({ id: m.id, autor: m.autor_email, texto: m.texto, interno: m.interno, em: m.criado_em })),
  }));
}
async function hdUm(id, req) {
  const l = await hdCarregar('WHERE id=$1', [id], req.perms.helpdesk === 'editar');
  return l[0] || null;
}
// Quem edita o Help desk vê todos os chamados; quem só visualiza vê os que abriu.
app.get('/api/helpdesk/chamados', permMin('helpdesk', 'ver'), async (req, res) => {
  const edit = req.perms.helpdesk === 'editar';
  const chamados = edit ? await hdCarregar('', [], true) : await hdCarregar('WHERE solicitante_email=$1', [req.user.email], false);
  let atendentes = [];
  if (edit) {
    const { rows } = await pool.query('SELECT email, role, permissoes FROM dre.usuarios ORDER BY email');
    atendentes = rows.filter(u => permsDe(u).helpdesk === 'editar').map(u => u.email);
  }
  res.json({ chamados, atendentes });
});
app.post('/api/helpdesk/chamados', permMin('helpdesk', 'ver'), async (req, res) => {
  const titulo = String(req.body.titulo || '').trim();
  if (!titulo) return res.status(400).json({ erro: 'titulo obrigatorio' });
  const prio = HD_PRIOS.includes(req.body.prioridade) ? req.body.prioridade : 'Média';
  const { rows } = await pool.query(
    `INSERT INTO dre.hd_chamados (titulo, categoria, prioridade, loja, descricao, solicitante_id, solicitante_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [titulo, String(req.body.categoria || 'Outros'), prio, String(req.body.loja || ''), String(req.body.descricao || ''), req.user.id, req.user.email]);
  await logAudit(req.user.id, 'Abriu chamado', `#${rows[0].id} ${titulo}`);
  res.json(await hdUm(rows[0].id, req));
});
app.patch('/api/helpdesk/chamados/:id', permMin('helpdesk', 'editar'), async (req, res) => {
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  const { status, prioridade, responsavel } = req.body;
  if (HD_STATUS.includes(status)) { add('status', status); sets.push(status === 'Resolvido' ? 'resolvido_em=now()' : 'resolvido_em=NULL'); }
  if (HD_PRIOS.includes(prioridade)) add('prioridade', prioridade);
  if (responsavel !== undefined) add('responsavel_email', String(responsavel || '') || null);
  if (!sets.length) return res.status(400).json({ erro: 'nada para alterar' });
  sets.push('atualizado_em=now()');
  vals.push(req.params.id);
  await pool.query(`UPDATE dre.hd_chamados SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  await logAudit(req.user.id, 'Atualizou chamado', `#${req.params.id} ${[status, prioridade, responsavel].filter(v => v !== undefined).join(' · ')}`);
  res.json(await hdUm(req.params.id, req));
});
app.post('/api/helpdesk/chamados/:id/mensagens', permMin('helpdesk', 'ver'), async (req, res) => {
  const edit = req.perms.helpdesk === 'editar';
  const { rows } = await pool.query('SELECT solicitante_email FROM dre.hd_chamados WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'chamado não encontrado' });
  if (!edit && rows[0].solicitante_email !== req.user.email) return res.status(403).json({ error: 'forbidden' });
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'texto obrigatorio' });
  const interno = edit && !!req.body.interno;
  await pool.query('INSERT INTO dre.hd_mensagens (chamado_id, autor_email, texto, interno) VALUES ($1,$2,$3,$4)', [req.params.id, req.user.email, texto, interno]);
  if (edit && !interno) {
    // primeira resposta do suporte assume o chamado
    await pool.query(`UPDATE dre.hd_chamados SET status=CASE WHEN status='Novo' THEN 'Em atendimento' ELSE status END,
      responsavel_email=COALESCE(responsavel_email,$2), atualizado_em=now() WHERE id=$1`, [req.params.id, req.user.email]);
  } else if (!edit) {
    await pool.query(`UPDATE dre.hd_chamados SET status=CASE WHEN status='Aguardando solicitante' THEN 'Em atendimento' ELSE status END,
      atualizado_em=now() WHERE id=$1`, [req.params.id]);
  }
  res.json(await hdUm(req.params.id, req));
});

const RH_TIPOS = ['Férias', 'Atestado médico', 'Folga', 'Licença', 'Falta'];
const RH_COLS = `id, nome, cargo, loja, to_char(admissao,'YYYY-MM-DD') AS admissao, salario, telefone, email, ativo,
  to_char(desligamento,'YYYY-MM-DD') AS desligamento`;
const rhOut = (r, verSalario) => ({ id: r.id, nome: r.nome, cargo: r.cargo, loja: r.loja, admissao: r.admissao || '',
  salario: verSalario ? Number(r.salario) : null, telefone: r.telefone, email: r.email, ativo: r.ativo, desligamento: r.desligamento || '' });
const ausOut = (a) => ({ id: a.id, colaboradorId: a.colaborador_id, tipo: a.tipo, inicio: a.inicio, fim: a.fim, obs: a.obs });
// Salário só aparece para quem edita o RH.
app.get('/api/rh', permMin('rh', 'ver'), async (req, res) => {
  const edit = req.perms.rh === 'editar';
  const { rows } = await pool.query(`SELECT ${RH_COLS} FROM dre.rh_colaboradores ORDER BY nome`);
  const { rows: aus } = await pool.query(`SELECT id, colaborador_id, tipo, to_char(inicio,'YYYY-MM-DD') AS inicio,
    to_char(fim,'YYYY-MM-DD') AS fim, obs FROM dre.rh_ausencias ORDER BY inicio DESC`);
  res.json({ colaboradores: rows.map(r => rhOut(r, edit)), ausencias: aus.map(ausOut) });
});
app.post('/api/rh/colaboradores', permMin('rh', 'editar'), async (req, res) => {
  const b = req.body; const nome = String(b.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatorio' });
  const { rows } = await pool.query(
    `INSERT INTO dre.rh_colaboradores (nome, cargo, loja, admissao, salario, telefone, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${RH_COLS}`,
    [nome, String(b.cargo || ''), String(b.loja || ''), b.admissao || null, Number(b.salario) || 0, String(b.telefone || ''), String(b.email || '')]);
  await logAudit(req.user.id, 'Cadastrou colaborador', nome);
  res.json(rhOut(rows[0], true));
});
app.patch('/api/rh/colaboradores/:id', permMin('rh', 'editar'), async (req, res) => {
  const b = req.body; const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.nome !== undefined) { const n = String(b.nome).trim(); if (!n) return res.status(400).json({ erro: 'nome obrigatorio' }); add('nome', n); }
  ['cargo', 'loja', 'telefone', 'email'].forEach(c => { if (b[c] !== undefined) add(c, String(b[c] || '')); });
  if (b.admissao !== undefined) add('admissao', b.admissao || null);
  if (b.salario !== undefined) add('salario', Number(b.salario) || 0);
  if (b.ativo !== undefined) { add('ativo', !!b.ativo); sets.push(b.ativo ? 'desligamento=NULL' : 'desligamento=CURRENT_DATE'); }
  if (!sets.length) return res.status(400).json({ erro: 'nada para alterar' });
  vals.push(req.params.id);
  const { rows } = await pool.query(`UPDATE dre.rh_colaboradores SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING ${RH_COLS}`, vals);
  if (!rows[0]) return res.status(404).json({ erro: 'colaborador não encontrado' });
  await logAudit(req.user.id, b.ativo === false ? 'Desligou colaborador' : b.ativo === true ? 'Reativou colaborador' : 'Editou colaborador', rows[0].nome);
  res.json(rhOut(rows[0], true));
});
app.post('/api/rh/ausencias', permMin('rh', 'editar'), async (req, res) => {
  const b = req.body;
  if (!b.colaboradorId || !b.inicio || !b.fim) return res.status(400).json({ erro: 'dados incompletos' });
  if (b.fim < b.inicio) return res.status(400).json({ erro: 'fim antes do início' });
  const tipo = RH_TIPOS.includes(b.tipo) ? b.tipo : 'Folga';
  const { rows } = await pool.query(
    `INSERT INTO dre.rh_ausencias (colaborador_id, tipo, inicio, fim, obs, criado_por) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, colaborador_id, tipo, to_char(inicio,'YYYY-MM-DD') AS inicio, to_char(fim,'YYYY-MM-DD') AS fim, obs`,
    [b.colaboradorId, tipo, b.inicio, b.fim, String(b.obs || ''), req.user.email]);
  await logAudit(req.user.id, 'Registrou ausência', `${tipo} · colaborador ${b.colaboradorId} · ${b.inicio} a ${b.fim}`);
  res.json(ausOut(rows[0]));
});
app.delete('/api/rh/ausencias/:id', permMin('rh', 'editar'), async (req, res) => {
  await pool.query('DELETE FROM dre.rh_ausencias WHERE id=$1', [req.params.id]);
  await logAudit(req.user.id, 'Excluiu ausência', req.params.id);
  res.json({ ok: true });
});

// ---------- Painel RH e Portal do Colaborador (Unifica RH) ----------
const RH_KEYS = ['unificarh_usuarios', 'unificarh_docs', 'unificarh_avisos', 'unificarh_solicitacoes', 'unificarh_atestados', 'unificarh_painel'];
async function rhLer(chave, padrao) {
  const { rows } = await pool.query('SELECT valor FROM dre.rh_store WHERE chave=$1', [chave]);
  return rows[0] ? rows[0].valor : padrao;
}
async function rhGravar(chave, valor, por) {
  await pool.query(
    `INSERT INTO dre.rh_store (chave, valor, atualizado_por) VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (chave) DO UPDATE SET valor=$2::jsonb, atualizado_em=now(), atualizado_por=$3`,
    [chave, JSON.stringify(valor), por]);
}
const semSenha = (lista) => (Array.isArray(lista) ? lista.map(({ senha, ...r }) => r) : lista);
const RH_ROTULO = { unificarh_usuarios: 'acessos do portal', unificarh_docs: 'documentos', unificarh_avisos: 'avisos',
  unificarh_solicitacoes: 'solicitações', unificarh_atestados: 'atestados', unificarh_painel: 'cadastros' };

// Senha do portal só aparece para quem edita o RH.
app.get('/api/rh/store', permMin('rh', 'ver'), async (req, res) => {
  const edit = req.perms.rh === 'editar';
  const { rows } = await pool.query('SELECT chave, valor FROM dre.rh_store WHERE chave = ANY($1)', [RH_KEYS]);
  const itens = {};
  rows.forEach(r => { itens[r.chave] = r.valor; });
  if (!edit) {
    if (itens.unificarh_usuarios) itens.unificarh_usuarios = semSenha(itens.unificarh_usuarios);
    if (itens.unificarh_painel && itens.unificarh_painel.colaboradores) {
      itens.unificarh_painel = { ...itens.unificarh_painel, colaboradores: semSenha(itens.unificarh_painel.colaboradores) };
    }
  }
  res.json({ itens, edit, email: req.user.email });
});
app.put('/api/rh/store/:chave', permMin('rh', 'editar'), async (req, res) => {
  const chave = req.params.chave;
  if (!RH_KEYS.includes(chave)) return res.status(400).json({ erro: 'coleção inválida' });
  let valor = req.body ? req.body.valor : undefined;
  if (valor === undefined || valor === null) return res.status(400).json({ erro: 'valor obrigatório' });
  // Solicitações também chegam pelo portal: não perde as que entraram depois que o painel abriu.
  if (chave === 'unificarh_solicitacoes' && Array.isArray(valor)) {
    const atual = await rhLer(chave, []);
    const ids = new Set(valor.map(x => x && x.id));
    const novas = (Array.isArray(atual) ? atual : []).filter(x => x && x.id && !ids.has(x.id));
    valor = novas.concat(valor);
  }
  await rhGravar(chave, valor, req.user.email);
  await logAudit(req.user.id, 'Atualizou RH', RH_ROTULO[chave] + (Array.isArray(valor) ? ` · ${valor.length} registro(s)` : ''));
  res.json({ ok: true });
});

// Portal do Colaborador: login do Sistema Grupo Azul. O colaborador é achado pelo e-mail do cadastro no RH.
async function portalAuth(req, res, next) {
  let payload;
  try { payload = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); }
  catch (e) { return res.status(401).json({ erro: 'Sessão expirada. Entre novamente no Sistema Grupo Azul.' }); }
  if (payload.tipo) return res.status(401).json({ erro: 'Sessão inválida.' });
  try {
    const { rows } = await pool.query('SELECT email FROM dre.usuarios WHERE id=$1', [payload.id]);
    if (!rows[0]) return res.status(401).json({ erro: 'Usuário não encontrado.' });
    const email = String(rows[0].email).trim().toLowerCase();
    const lista = await rhLer('unificarh_usuarios', []);
    const u = (Array.isArray(lista) ? lista : []).find(x => String((x.dados && x.dados.email) || x.email || '').trim().toLowerCase() === email);
    if (!u) return res.status(404).json({ erro: 'Seu e-mail (' + email + ') não está no cadastro de colaboradores. Peça ao RH para incluí-lo na sua ficha.' });
    if (u.status === 'Desligado') return res.status(403).json({ erro: 'Acesso desativado. Procure o RH.' });
    const { senha, ...pub } = u;
    req.colab = pub;
    next();
  } catch (e) { next(e); }
}
app.get('/api/rh-portal/dados', portalAuth, async (req, res) => {
  const c = req.colab;
  const doMeu = (x) => x && x.matricula === c.matricula;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const [docs, avisos, atestados, solicitacoes] = await Promise.all(
    ['unificarh_docs', 'unificarh_avisos', 'unificarh_atestados', 'unificarh_solicitacoes'].map(k => rhLer(k, [])));
  res.json({
    usuario: c,
    docs: arr(docs).filter(d => doMeu(d) && (!d.empresa || d.empresa === c.empresa)),
    avisos: arr(avisos),
    atestados: arr(atestados).filter(doMeu),
    solicitacoes: arr(solicitacoes).filter(doMeu),
  });
});
app.post('/api/rh-portal/solicitacoes', portalAuth, async (req, res) => {
  const c = req.colab;
  const it = (req.body && req.body.item) || {};
  if (!String(it.texto || '').trim()) return res.status(400).json({ erro: 'texto obrigatório' });
  const item = { ...it, id: it.id || ('sol-' + Date.now()), colab: c.nome, matricula: c.matricula, empresa: c.empresa, status: 'Pendente' };
  const upd = await pool.query(
    `UPDATE dre.rh_store SET valor = jsonb_build_array($1::jsonb) || valor, atualizado_em=now(), atualizado_por=$2
     WHERE chave='unificarh_solicitacoes'`, [JSON.stringify(item), 'portal:' + c.usuario]);
  if (!upd.rowCount) await rhGravar('unificarh_solicitacoes', [item], 'portal:' + c.usuario);
  res.json({ ok: true, id: item.id });
});

// Erros que o navegador relata (tela quebrada, falha de API). Sem login, corpo pequeno e limite por IP.
const _cliLog = new Map();
app.post('/api/logs/cliente', express.json({ limit: '8kb', type: ['application/json', 'text/plain'] }), (req, res) => {
  const ip = req.ip, agora = Date.now();
  const n = (_cliLog.get(ip) || []).filter(t => agora - t < 60000);
  if (n.length >= 20) return res.status(429).end();
  n.push(agora); _cliLog.set(ip, n);
  if (_cliLog.size > 5000) _cliLog.clear();
  const b = req.body || {}, cut = (v, m) => String(v == null ? '' : v).slice(0, m);
  logger.warn('erro no navegador: ' + cut(b.mensagem, 300), {
    reqId: req.id, tipo: cut(b.tipo, 30), origem: cut(b.origem, 300), linha: Number(b.linha) || undefined,
    stack: cut(b.stack, 2000), tela: cut(b.tela, 200), usuario: cut(b.usuario, 120), apiRef: cut(b.apiRef, 64), navegador: cut(req.headers['user-agent'], 200),
  });
  res.status(204).end();
});

// Erro não tratado: vai para o log com o id da requisição, que também volta ao navegador.
app.use((err, req, res, next) => {
  (req.log || logger).error('erro não tratado: ' + ((err && err.message) || err), {
    metodo: req.method, url: req.originalUrl, usuario: req.user && req.user.email, stack: err && err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: (err && err.message) || 'erro interno', ref: req.id });
});

process.on('unhandledRejection', e => logger.error('promise rejeitada sem tratamento: ' + (e && e.message || e), { stack: e && e.stack }));
process.on('uncaughtException', e => { logger.error('exceção não tratada: ' + e.message, { stack: e.stack }); process.exit(1); });

app.listen(process.env.PORT || 3001, () => logger.info('DRE Azul backend no ar', { porta: Number(process.env.PORT || 3001) }));
