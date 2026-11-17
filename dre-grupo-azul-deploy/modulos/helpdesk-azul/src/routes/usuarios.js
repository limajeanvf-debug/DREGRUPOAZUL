'use strict';
const express = require('express');
const db = require('../db');
const { exigirAdmin } = require('../auth');
const { wrap, fail, str, isEmail, PERFIS, now } = require('../util');

const r = express.Router();
r.use('/usuarios', exigirAdmin);

const publico = u => ({
  id: String(u.id), nome: u.nome, email: u.email, tel: u.telefone || '', loja: u.loja || '',
  perfil: u.perfil, adminFixo: !!u.admin_fixo, inativo: !u.ativo, vinculado: !!u.id_externo,
});

async function garantirOutroAdmin(exceto) {
  const n = await db.one(`SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo AND id <> $1`, [exceto]);
  if (!n.n) fail(400, 'O sistema precisa ter pelo menos um administrador ativo.');
}

const idValido = v => (/^\d+$/.test(String(v)) ? Number(v) : fail(404, 'Usuário não encontrado.'));

r.get('/usuarios', wrap(async (req, res) => {
  const rows = await db.query('SELECT * FROM usuarios ORDER BY nome');
  res.json(rows.map(publico));
}));

// Pré-cadastro: define perfil e loja de alguém antes do primeiro acesso.
// A ficha é vinculada automaticamente pelo e-mail quando a pessoa entrar pelo sistema principal.
r.post('/usuarios', wrap(async (req, res) => {
  const nome = str(req.body.nome, 120), email = str(req.body.email, 190).toLowerCase();
  const tel = str(req.body.tel, 30), loja = str(req.body.loja, 120), perfil = str(req.body.perfil, 20) || 'agente';
  if (!nome) fail(400, 'Informe o nome.');
  if (!isEmail(email)) fail(400, 'E-mail inválido.');
  if (!PERFIS.includes(perfil)) fail(400, 'Perfil inválido.');
  if (await db.one('SELECT id FROM usuarios WHERE email = $1', [email])) fail(409, 'Esse e-mail já está cadastrado.');
  const t = now();
  const u = await db.one(
    `INSERT INTO usuarios (nome, email, telefone, loja, perfil, criado_em, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
    [nome, email, tel || null, loja || null, perfil, t]
  );
  res.status(201).json(publico(u));
}));

r.patch('/usuarios/:id', wrap(async (req, res) => {
  const u = await db.one('SELECT * FROM usuarios WHERE id = $1', [idValido(req.params.id)]);
  if (!u) fail(404, 'Usuário não encontrado.');
  const b = req.body || {}, sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const proprio = u.id === req.user.id;
  if ('perfil' in b) {
    if (!PERFIS.includes(b.perfil)) fail(400, 'Perfil inválido.');
    if (b.perfil !== u.perfil) {
      if (u.admin_fixo) fail(400, 'O perfil do administrador fixo não pode ser alterado.');
      if (proprio) fail(400, 'Você não pode alterar o seu próprio perfil.');
      if (u.perfil === 'admin') await garantirOutroAdmin(u.id);
      add('perfil', b.perfil);
    }
  }
  if ('inativo' in b) {
    const ativo = !b.inativo;
    if (!ativo && (u.admin_fixo || proprio)) fail(400, 'Esta conta não pode ser desativada.');
    if (!ativo && u.perfil === 'admin') await garantirOutroAdmin(u.id);
    add('ativo', ativo);
  }
  if ('loja' in b) add('loja', str(b.loja, 120) || null);
  if ('tel' in b) add('telefone', str(b.tel, 30) || null);
  let atual = u;
  if (sets.length) {
    add('atualizado_em', now());
    vals.push(u.id);
    atual = await db.one(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  }
  res.json(publico(atual));
}));

r.delete('/usuarios/:id', wrap(async (req, res) => {
  const u = await db.one('SELECT * FROM usuarios WHERE id = $1', [idValido(req.params.id)]);
  if (!u) fail(404, 'Usuário não encontrado.');
  if (u.admin_fixo) fail(400, 'O administrador fixo não pode ser excluído.');
  if (u.id === req.user.id) fail(400, 'Você não pode excluir a sua própria conta.');
  if (u.perfil === 'admin') await garantirOutroAdmin(u.id);
  await db.query('DELETE FROM usuarios WHERE id = $1', [u.id]);
  res.json({ ok: true });
}));

module.exports = r;
