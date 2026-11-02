'use strict';
const express = require('express');
const db = require('../db');
const { getConfig } = require('../settings');
const mail = require('../mail');
const { exigirLogin, usuarioPublico } = require('../auth');
const { wrap, str, now } = require('../util');

module.exports = function rotasConta(opts) {
  const r = express.Router();

  r.get('/sessao', exigirLogin, wrap(async (req, res) => {
    res.json({
      usuario: usuarioPublico(req.user),
      config: await getConfig(),
      emailAutomatico: mail.ativo(),
      perfilPeloSistema: !!opts.perfilPeloSistema,
      links: { voltar: opts.urlVoltar || '', sair: opts.urlSair || '' },
    });
  }));

  // Informações para a tela de "sem acesso" (não exige login)
  r.get('/acesso', (req, res) => res.json({ entrar: opts.urlEntrar || '' }));

  r.patch('/minha-conta', exigirLogin, wrap(async (req, res) => {
    const tel = str(req.body.tel, 30);
    await db.query('UPDATE usuarios SET telefone = $1, atualizado_em = $2 WHERE id = $3', [tel || null, now(), req.user.id]);
    res.json({ ok: true, tel });
  }));

  return r;
};
