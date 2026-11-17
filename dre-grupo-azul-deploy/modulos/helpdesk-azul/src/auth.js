'use strict';
/**
 * Identificação do usuário.
 * O help desk NÃO tem tela de login: ele pergunta ao sistema principal quem está logado
 * (função obterUsuario passada em criarHelpdesk) e mantém uma ficha local com perfil,
 * loja e celular, criada automaticamente no primeiro acesso.
 */
const db = require('./db');
const { fail, PERFIS, now } = require('./util');

const limpa = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

async function sincronizar(ext) {
  const idExt = limpa(ext.id, 190);
  const email = limpa(ext.email, 190).toLowerCase() || null;
  const nomeExt = limpa(ext.nome || ext.name, 120);
  const nome = nomeExt || email || `Usuário ${idExt}`;
  const perfilExt = PERFIS.includes(ext.perfil) ? ext.perfil : null;
  const lojaExt = ext.loja !== undefined ? (limpa(ext.loja, 120) || null) : undefined;
  const telExt = ext.telefone !== undefined || ext.tel !== undefined ? (limpa(ext.telefone ?? ext.tel, 30) || null) : undefined;

  let u = await db.one('SELECT * FROM usuarios WHERE id_externo = $1', [idExt]);
  if (!u && email) {
    // Conta já existente no help desk (ex.: importada) com o mesmo e-mail: vincula
    u = await db.one('SELECT * FROM usuarios WHERE email = $1 AND id_externo IS NULL', [email]);
    if (u) u = await db.one('UPDATE usuarios SET id_externo = $1 WHERE id = $2 RETURNING *', [idExt, u.id]);
  }
  if (!u) {
    const t = now();
    try {
      return await db.one(
        `INSERT INTO usuarios (id_externo, nome, email, telefone, loja, perfil, criado_em, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
        [idExt, nome, email, telExt ?? null, lojaExt ?? null, perfilExt || 'agente', t]);
    } catch (e) {
      if (e.code === '23505') fail(409, 'Já existe outro usuário do help desk com este e-mail. Peça ao administrador para corrigir.');
      throw e;
    }
  }
  // Atualiza só o que mudou no sistema principal (evita gravar a cada requisição)
  const sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (nomeExt && nomeExt !== u.nome) add('nome', nomeExt);
  if (email && email !== u.email) add('email', email);
  if (lojaExt !== undefined && lojaExt !== u.loja) add('loja', lojaExt);
  if (telExt !== undefined && telExt !== u.telefone) add('telefone', telExt);
  if (perfilExt && !u.admin_fixo && perfilExt !== u.perfil) add('perfil', perfilExt);
  if (!sets.length) return u;
  add('atualizado_em', now());
  vals.push(u.id);
  try {
    return await db.one(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  } catch (e) {
    if (e.code === '23505') return u; // e-mail duplicado: mantém a ficha como está
    throw e;
  }
}

/** Middleware: descobre o usuário pelo sistema principal. */
function carregarUsuario(obterUsuario) {
  return async (req, res, next) => {
    try {
      req.user = null;
      const ext = await obterUsuario(req);
      if (ext && ext.id !== undefined && ext.id !== null && ext.id !== '') {
        const u = await sincronizar(ext);
        if (!u.ativo) { req.userInativo = true; }
        else req.user = u;
      }
      next();
    } catch (e) { next(e); }
  };
}

const isStaff = u => u && (u.perfil === 'suporte' || u.perfil === 'admin');
const isAdmin = u => u && u.perfil === 'admin';

const exigirLogin = (req, res, next) => {
  if (req.user) return next();
  if (req.userInativo) return next(Object.assign(new Error('Seu acesso ao help desk foi desativado. Fale com o administrador.'), { status: 403, codigo: 'inativo' }));
  return next(Object.assign(new Error('Entre no sistema principal para usar o help desk.'), { status: 401 }));
};
const exigirStaff = (req, res, next) => (isStaff(req.user) ? next() : fail(403, 'Acesso restrito ao help desk.'));
const exigirAdmin = (req, res, next) => (isAdmin(req.user) ? next() : fail(403, 'Acesso restrito ao administrador.'));

function usuarioPublico(u) {
  return { id: u.id, nome: u.nome, email: u.email || '', tel: u.telefone || '', loja: u.loja || '', perfil: u.perfil, adminFixo: !!u.admin_fixo };
}

module.exports = { carregarUsuario, exigirLogin, exigirStaff, exigirAdmin, isStaff, isAdmin, usuarioPublico };
