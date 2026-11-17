'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const mail = require('../mail');
const { getConfig, prazoPara } = require('../settings');
const { exigirLogin, isStaff } = require('../auth');
const { wrap, fail, str, iso, now, STATUS, PRIORIDADES, DONE, STATUS_LABEL } = require('../util');

const r = express.Router();
r.use(['/chamados', '/anexos'], exigirLogin);

/* ---------------- uploads (prints, PDF e planilhas) ----------------
   Os arquivos ficam no disco (UPLOAD_DIR); o banco guarda só nome, tamanho e tipo. */
let UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
function configurarUploads(dir) {
  if (dir) UPLOAD_DIR = path.resolve(dir);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
// Documentos: o tipo vem da extensão (o Windows manda CSV como "vnd.ms-excel") e é conferido pela assinatura.
const DOCS = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};
const extDe = f => path.extname(f.originalname || '').toLowerCase();
const tipoDe = f => MIMES[f.mimetype] ? f.mimetype : (DOCS[extDe(f)] || '');
const MAX_IMG = 4 * 1024 * 1024, MAX_DOC = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (MIMES[file.mimetype] || (DOCS[extDe(file)] ? extDe(file) : '.bin'))),
  }),
  limits: { fileSize: MAX_DOC, files: 6, fields: 20 },
  fileFilter: (req, file, cb) => cb(null, !!tipoDe(file)),
}).array('prints', 6);

const receber = (req, res) => new Promise((resolve, reject) => upload(req, res, e => (e ? reject(e) : resolve())));

// Confere a assinatura do arquivo para não aceitar algo que não seja imagem
function imagemValida(file) {
  const fd = fs.openSync(file.path, 'r'); const b = Buffer.alloc(512);
  const n = fs.readSync(fd, b, 0, 512, 0); fs.closeSync(fd);
  const ext = extDe(file);
  if (!MIMES[file.mimetype] && DOCS[ext]) {
    if (ext === '.pdf') return b.slice(0, 4).toString() === '%PDF';
    if (ext === '.xlsx') return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
    if (ext === '.xls') return b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (ext === '.csv') return !b.slice(0, n).includes(0);
    return false;
  }
  if (file.size > MAX_IMG) return false;
  if (file.mimetype === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (file.mimetype === 'image/png') return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (file.mimetype === 'image/gif') return b.slice(0, 4).toString() === 'GIF8';
  if (file.mimetype === 'image/webp') return b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
  return false;
}
function validarArquivos(files) {
  for (const f of files || []) {
    if (!imagemValida(f)) { (files || []).forEach(x => fs.unlink(x.path, () => {})); fail(400, `O arquivo "${f.originalname}" não é uma imagem, PDF ou planilha válida.`); }
  }
}
const descartar = files => (files || []).forEach(f => fs.unlink(f.path, () => {}));

async function salvarAnexos(q, files, chamadoId, mensagemId, user) {
  const t = now();
  for (const f of files || []) {
    await q('INSERT INTO anexos (chamado_id, mensagem_id, nome_original, arquivo, mime, tamanho, autor_id, autor_nome, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [chamadoId, mensagemId, str(f.originalname, 255) || 'print.jpg', f.filename, tipoDe(f), f.size, user.id, user.nome, t]);
  }
}

/* ---------------- leitura e formato para o navegador ---------------- */
async function carregarChamados(where = '', params = []) {
  const rows = await db.query(
    `SELECT c.*, u.telefone AS autor_tel FROM chamados c LEFT JOIN usuarios u ON u.id = c.autor_id ${where} ORDER BY c.atualizado_em DESC`, params);
  if (!rows.length) return [];
  const ids = rows.map(c => c.id);
  const msgs = await db.query('SELECT * FROM mensagens WHERE chamado_id = ANY($1::int[]) ORDER BY criado_em, id', [ids]);
  const anex = await db.query('SELECT id, chamado_id, nome_original, mime, tamanho, autor_nome, criado_em FROM anexos WHERE chamado_id = ANY($1::int[]) ORDER BY id', [ids]);
  const porChamado = (lista) => lista.reduce((m, x) => ((m[x.chamado_id] ||= []).push(x), m), {});
  const M = porChamado(msgs), A = porChamado(anex);
  return rows.map(c => formatar(c, M[c.id] || [], A[c.id] || []));
}

function formatar(c, msgs, anex) {
  return {
    id: String(c.id), numero: c.numero, titulo: c.titulo, categoria: c.categoria, prioridade: c.prioridade, status: c.status,
    locAereo: c.loc_aereo || '', locPacote: c.loc_pacote || '', descricao: c.descricao,
    clienteNome: c.cliente_nome || '', emissor: c.emissor || '', fornecedor: c.fornecedor || '',
    autorId: c.autor_id ? String(c.autor_id) : '', autorNome: c.autor_nome, autorEmail: c.autor_email || '', autorTel: c.autor_tel || '', autorLoja: c.autor_loja || '',
    responsavelId: c.responsavel_id ? String(c.responsavel_id) : '', responsavelNome: c.responsavel_nome || '',
    criadoEm: iso(c.criado_em), atualizadoEm: iso(c.atualizado_em), prazoEm: iso(c.prazo_em), resolvidoEm: iso(c.resolvido_em),
    ultimaMsgPerfil: c.ultima_msg_visao || '', ultimaMsgEm: iso(c.ultima_msg_em),
    anexos: anex.map(a => ({ id: String(a.id), nome: a.nome_original, mime: a.mime || '', tamanho: a.tamanho || 0, autor: a.autor_nome || '', em: iso(a.criado_em) })),
    mensagens: msgs.map(m => m.sistema
      ? { sistema: true, texto: m.texto, em: iso(m.criado_em) }
      : { autor: m.autor_nome || '', autorId: m.autor_id ? String(m.autor_id) : '', perfil: m.visao || '', texto: m.texto, anexos: m.qtd_anexos || 0, em: iso(m.criado_em) }),
  };
}

async function umChamado(id) {
  const lista = await carregarChamados('WHERE c.id = $1', [id]);
  return lista[0] || null;
}

const idValido = v => (/^\d+$/.test(String(v)) ? Number(v) : fail(404, 'Não encontrado.'));

async function buscarComPermissao(req, id) {
  const c = await db.one('SELECT * FROM chamados WHERE id = $1', [idValido(id)]);
  if (!c) fail(404, 'Chamado não encontrado.');
  if (!isStaff(req.user) && c.autor_id !== req.user.id) fail(403, 'Você não tem acesso a este chamado.');
  return c;
}

const sysMsg = (q, chamadoId, texto, t) =>
  q('INSERT INTO mensagens (chamado_id, sistema, texto, criado_em) VALUES ($1, TRUE, $2, $3)', [chamadoId, texto, t]);

/* ---------------- rotas ---------------- */

// Consulta leve usada a cada poucos segundos para saber se algo mudou
r.get('/chamados/versao', wrap(async (req, res) => {
  const staff = isStaff(req.user);
  const row = await db.one(`SELECT COUNT(*) AS n, MAX(atualizado_em) AS m FROM chamados ${staff ? '' : 'WHERE autor_id = $1'}`, staff ? [] : [req.user.id]);
  const cfg = await getConfig();
  res.json({ versao: `${row.n}|${row.m ? new Date(row.m).getTime() : 0}|${cfg.versao}` });
}));

r.get('/chamados', wrap(async (req, res) => {
  const staff = isStaff(req.user);
  const chamados = staff ? await carregarChamados() : await carregarChamados('WHERE c.autor_id = $1', [req.user.id]);
  const lidos = await db.query('SELECT chamado_id, visao, lido_em FROM leituras WHERE usuario_id = $1', [req.user.id]);
  const leituras = {};
  for (const l of lidos) leituras[`${l.visao}:${l.chamado_id}`] = iso(l.lido_em);
  if (!staff) chamados.forEach(c => { c.autorTel = ''; });
  res.json({ chamados, leituras });
}));

r.post('/chamados', wrap(async (req, res) => {
  await receber(req, res);
  try {
    validarArquivos(req.files);
    const b = req.body || {}, cfg = await getConfig();
    const titulo = str(b.titulo, 160), descricao = str(b.descricao, 10000);
    const prioridade = PRIORIDADES.includes(b.prioridade) ? b.prioridade : 'Média';
    const categoria = str(b.categoria, 120) || 'Geral';
    const locAereo = str(b.locAereo, 10).toUpperCase(), locPacote = str(b.locPacote, 40).toUpperCase();
    const clienteNome = str(b.clienteNome, 160), emissor = str(b.emissor, 120), fornecedor = str(b.fornecedor, 120);
    if (!clienteNome) fail(400, 'Informe o nome do cliente.');
    if (cfg.emissores.length && !cfg.emissores.includes(emissor)) fail(400, 'Escolha o emissor da lista.');
    if (cfg.fornecedores.length && !cfg.fornecedores.includes(fornecedor)) fail(400, 'Escolha o fornecedor da lista.');
    if (!titulo) fail(400, 'Escreva um resumo do problema.');
    if (!descricao) fail(400, 'Descreva o que aconteceu.');
    if (!locAereo && !locPacote) fail(400, 'Informe o localizador aéreo ou o número do pacote/reserva.');
    if (locAereo && !/^[A-Z0-9]{5,8}$/.test(locAereo)) fail(400, 'O localizador aéreo deve ter de 5 a 8 caracteres (letras e números).');
    if (cfg.categorias.length && !cfg.categorias.includes(categoria)) fail(400, 'Escolha uma categoria da lista.');

    const t = now(), u = req.user;
    const id = await db.transaction(async q => {
      const [ins] = await q(
        `INSERT INTO chamados (titulo, categoria, prioridade, status, loc_aereo, loc_pacote, descricao, autor_id, autor_nome, autor_email, autor_loja,
           criado_em, atualizado_em, prazo_em, ultima_msg_visao, ultima_msg_em, cliente_nome, emissor, fornecedor)
         VALUES ($1,$2,$3,'Aberto',$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,'agente',$11,$13,$14,$15) RETURNING id`,
        [titulo, categoria, prioridade, locAereo || null, locPacote || null, descricao, u.id, u.nome, u.email, u.loja || null, t, prazoPara(cfg, t, prioridade),
         clienteNome, emissor || null, fornecedor || null]);
      const cid = ins.id;
      await q('UPDATE chamados SET numero = $1 WHERE id = $2', ['HD-' + String(cid).padStart(6, '0'), cid]);
      await sysMsg(q, cid, 'Chamado enviado ao help desk', t);
      await salvarAnexos(q, req.files, cid, null, u);
      return cid;
    });
    const ch = await db.one('SELECT * FROM chamados WHERE id = $1', [id]);
    mail.enviar({ para: cfg.emailHelpdesk, assunto: `[${ch.numero}] ${ch.prioridade}: ${ch.titulo}`, intro: `Novo chamado aberto por ${u.nome}.`, chamado: ch, texto: ch.descricao });
    res.status(201).json(await umChamado(id));
  } catch (e) { descartar(req.files); throw e; }
}));

r.post('/chamados/:id/mensagens', wrap(async (req, res) => {
  await receber(req, res);
  try {
    validarArquivos(req.files);
    const c = await buscarComPermissao(req, req.params.id);
    if (c.status === 'Fechado') fail(400, 'Este chamado está fechado.');
    const texto = str(req.body.texto, 10000);
    const files = req.files || [];
    if (!texto && !files.length) fail(400, 'Escreva uma mensagem ou anexe um print.');
    // "visao" = de qual lado a mensagem foi enviada (o admin pode responder como help desk ou como agente)
    let visao = req.body.visao === 'suporte' ? 'suporte' : 'agente';
    if (visao === 'suporte' && !isStaff(req.user)) visao = 'agente';
    if (visao === 'agente' && c.autor_id !== req.user.id) visao = 'suporte';
    const t = now();
    await db.transaction(async q => {
      const [m] = await q('INSERT INTO mensagens (chamado_id, autor_id, autor_nome, visao, texto, qtd_anexos, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [c.id, req.user.id, req.user.nome, visao, texto || '(arquivo anexado)', files.length, t]);
      await salvarAnexos(q, files, c.id, m.id, req.user);
      const novoStatus = (visao === 'agente' && c.status === 'Aguardando agente') ? 'Em andamento' : c.status;
      await q('UPDATE chamados SET status = $1, atualizado_em = $2, ultima_msg_visao = $3, ultima_msg_em = $2 WHERE id = $4', [novoStatus, t, visao, c.id]);
      await q(`INSERT INTO leituras (usuario_id, chamado_id, visao, lido_em) VALUES ($1,$2,$3,$4)
               ON CONFLICT (usuario_id, chamado_id, visao) DO UPDATE SET lido_em = EXCLUDED.lido_em`, [req.user.id, c.id, visao, t]);
    });
    const cfg = await getConfig();
    const extra = files.length ? `\n(${files.length} arquivo(s) anexado(s) no chamado)` : '';
    if (visao === 'agente') mail.enviar({ para: cfg.emailHelpdesk, assunto: `[${c.numero}] Nova mensagem do agente`, intro: `${req.user.nome} respondeu no chamado.`, chamado: c, texto: texto + extra });
    else mail.enviar({ para: c.autor_email, assunto: `[${c.numero}] Resposta do help desk`, intro: `${req.user.nome} respondeu ao seu chamado.`, chamado: c, texto: texto + extra });
    res.status(201).json(await umChamado(c.id));
  } catch (e) { descartar(req.files); throw e; }
}));

r.patch('/chamados/:id', wrap(async (req, res) => {
  const c = await buscarComPermissao(req, req.params.id);
  const { acao, valor } = req.body || {};
  const staff = isStaff(req.user), autor = c.autor_id === req.user.id;
  const t = now(), u = req.user, cfg = await getConfig();
  let aviso = null;

  await db.transaction(async q => {
    const mudarStatus = async (st, textoSys) => {
      const resolvido = DONE(st) ? (c.resolvido_em || t) : null;
      await q('UPDATE chamados SET status = $1, resolvido_em = $2, atualizado_em = $3 WHERE id = $4', [st, resolvido, t, c.id]);
      await sysMsg(q, c.id, textoSys, t);
    };
    if (acao === 'status') {
      if (!staff) fail(403, 'Apenas o help desk altera o status.');
      if (!STATUS.includes(valor)) fail(400, 'Status inválido.');
      if (valor === c.status) return;
      await mudarStatus(valor, `${u.nome} alterou o status para "${STATUS_LABEL(valor)}"`);
      if (valor === 'Resolvido') aviso = { para: c.autor_email, assunto: `[${c.numero}] Chamado resolvido`, intro: 'Seu chamado foi marcado como resolvido. Confirme a solução no sistema.' };
      if (valor === 'Aguardando agente') aviso = { para: c.autor_email, assunto: `[${c.numero}] Precisamos de mais informações`, intro: 'O help desk precisa de mais informações para continuar o seu chamado.' };
    } else if (acao === 'prioridade') {
      if (!staff) fail(403, 'Apenas o help desk altera a prioridade.');
      if (!PRIORIDADES.includes(valor)) fail(400, 'Prioridade inválida.');
      if (valor === c.prioridade) return;
      const prazo = prazoPara(cfg, c.criado_em, valor);
      await q('UPDATE chamados SET prioridade = $1, prazo_em = $2, atualizado_em = $3 WHERE id = $4', [valor, prazo, t, c.id]);
      await sysMsg(q, c.id, `Prioridade alterada para ${valor}; novo prazo ${prazo.toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, t);
    } else if (acao === 'assumir') {
      if (!staff) fail(403, 'Apenas o help desk assume chamados.');
      const st = c.status === 'Aberto' ? 'Em andamento' : c.status;
      await q('UPDATE chamados SET responsavel_id = $1, responsavel_nome = $2, status = $3, atualizado_em = $4 WHERE id = $5', [u.id, u.nome, st, t, c.id]);
      await sysMsg(q, c.id, `${u.nome} assumiu o chamado`, t);
    } else if (acao === 'confirmar') {
      if (!autor) fail(403, 'Apenas quem abriu o chamado pode confirmar a solução.');
      if (c.status !== 'Resolvido') fail(400, 'O chamado ainda não foi marcado como resolvido.');
      await mudarStatus('Fechado', `${u.nome} confirmou a solução`);
    } else if (acao === 'reabrir') {
      if (!autor) fail(403, 'Apenas quem abriu o chamado pode reabri-lo.');
      if (c.status !== 'Resolvido') fail(400, 'Só é possível reabrir um chamado resolvido.');
      await q(`UPDATE chamados SET status = 'Aberto', resolvido_em = NULL, atualizado_em = $1 WHERE id = $2`, [t, c.id]);
      await sysMsg(q, c.id, `${u.nome} reabriu o chamado`, t);
      aviso = { para: cfg.emailHelpdesk, assunto: `[${c.numero}] Chamado reaberto`, intro: `${u.nome} reabriu o chamado: a solução não resolveu.` };
    } else {
      fail(400, 'Ação inválida.');
    }
  });
  const atual = await db.one('SELECT * FROM chamados WHERE id = $1', [c.id]);
  if (aviso) mail.enviar({ ...aviso, chamado: atual });
  res.json(await umChamado(c.id));
}));

r.post('/chamados/:id/lido', wrap(async (req, res) => {
  const c = await buscarComPermissao(req, req.params.id);
  const visao = req.body && req.body.visao === 'suporte' ? 'suporte' : 'agente';
  const em = req.body && req.body.em ? new Date(req.body.em) : now();
  await db.query(`INSERT INTO leituras (usuario_id, chamado_id, visao, lido_em) VALUES ($1,$2,$3,$4)
                  ON CONFLICT (usuario_id, chamado_id, visao) DO UPDATE SET lido_em = GREATEST(leituras.lido_em, EXCLUDED.lido_em)`,
    [req.user.id, c.id, visao, isNaN(em) ? now() : em]);
  res.json({ ok: true });
}));

r.get('/anexos/:id', wrap(async (req, res) => {
  const a = await db.one('SELECT a.*, c.autor_id AS chamado_autor FROM anexos a JOIN chamados c ON c.id = a.chamado_id WHERE a.id = $1', [idValido(req.params.id)]);
  if (!a) fail(404, 'Arquivo não encontrado.');
  if (!isStaff(req.user) && a.chamado_autor !== req.user.id) fail(403, 'Sem acesso a este arquivo.');
  const file = path.join(UPLOAD_DIR, path.basename(a.arquivo));
  if (!fs.existsSync(file)) fail(404, 'Arquivo não encontrado no servidor.');
  res.set({ 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `${/^image\/|^application\/pdf$/.test(a.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}));

module.exports = r;
module.exports.configurarUploads = configurarUploads;
