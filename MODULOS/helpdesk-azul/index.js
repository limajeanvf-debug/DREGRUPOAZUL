'use strict';
/**
 * Help Desk — Azul Viagens Shopping Recife
 * Módulo para ser montado dentro do sistema principal (Express). O login é o do sistema principal.
 *
 *   const criarHelpdesk = require('./helpdesk-azul');
 *   app.use('/helpdesk', criarHelpdesk({
 *     obterUsuario: req => req.user && { id: req.user.id, nome: req.user.nome, email: req.user.email },
 *   }));
 *
 * Veja o README para todas as opções.
 */
const path = require('path');
const express = require('express');
const db = require('./src/db');
const mail = require('./src/mail');
const { carregarUsuario } = require('./src/auth');
const { HttpError } = require('./src/util');

function criarHelpdesk(opts = {}) {
  if (typeof opts.obterUsuario !== 'function') {
    throw new Error('criarHelpdesk: informe obterUsuario(req), que devolve o usuário logado no sistema principal ({ id, nome, email }) ou null.');
  }
  db.configurar(opts.banco || {});
  mail.definirUrl(opts.urlPublica);
  const chamados = require('./src/routes/chamados');
  chamados.configurarUploads(opts.pastaUploads);

  const router = express.Router();

  // /helpdesk → /helpdesk/  (os caminhos da tela são relativos)
  router.use((req, res, next) => {
    if (req.method === 'GET' && req.originalUrl.split('?')[0] === req.baseUrl && req.baseUrl) {
      return res.redirect(301, req.baseUrl + '/' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''));
    }
    next();
  });

  // Bloqueia envios vindos de outros sites (proteção contra CSRF)
  router.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ erro: 'Origem não permitida.' }); }
      catch { return res.status(403).json({ erro: 'Origem não permitida.' }); }
    }
    next();
  });

  router.use('/api', express.json({ limit: '200kb' }));
  router.use('/api', carregarUsuario(opts.obterUsuario));
  router.use('/api', require('./src/routes/conta')(opts));
  router.use('/api', require('./src/routes/config'));
  router.use('/api', require('./src/routes/usuarios'));
  router.use('/api', chamados);
  router.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // Erros da API em JSON
  // eslint-disable-next-line no-unused-vars
  router.use('/api', (err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Cada print pode ter no máximo 4 MB.' });
    if (err && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ erro: 'Envie no máximo 4 prints por vez.' });
    if (err instanceof HttpError || (err && err.status && err.status < 500)) return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
    (req.log || console).error('[help desk] ' + ((err && err.message) || err), { stack: err && err.stack, url: req.originalUrl });
    res.status(500).json({ erro: 'Erro interno no servidor. Tente novamente em instantes.' });
  });

  // Telas
  router.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  return router;
}

module.exports = criarHelpdesk;
module.exports.criarHelpdesk = criarHelpdesk;
