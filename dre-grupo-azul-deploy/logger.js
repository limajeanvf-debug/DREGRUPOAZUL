'use strict';
// Logs do servidor.
// winston: logs da aplicação (JSON em produção, legível em desenvolvimento).
// morgan: uma linha por requisição HTTP, enviada ao winston, com id da requisição para rastrear erros.
const crypto = require('crypto');
const winston = require('winston');
const morgan = require('morgan');

const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (PROD ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    PROD ? winston.format.json() : winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `${timestamp} ${level} ${message}${extra}${stack ? '\n' + stack : ''}`;
      })
    )
  ),
  transports: [new winston.transports.Console()],
});

// Id por requisição: volta no header X-Request-Id e aparece em todos os logs daquela requisição.
function requestId(req, res, next) {
  const vindo = String(req.headers['x-request-id'] || '');
  req.id = /^[\w-]{6,64}$/.test(vindo) ? vindo : crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  req.log = logger.child({ reqId: req.id });
  next();
}

morgan.token('id', req => req.id);
morgan.token('usuario', req => (req.user && (req.user.email || req.user.id)) || '-');
const httpLog = morgan(
  (tokens, req, res) => JSON.stringify({
    reqId: tokens.id(req, res),
    metodo: tokens.method(req, res),
    url: tokens.url(req, res).replace(/([?&]t=)[^&]+/, '$1***'),
    status: Number(tokens.status(req, res)) || 0,
    ms: Number(tokens['response-time'](req, res)) || 0,
    usuario: tokens.usuario(req, res),
  }),
  {
    // Sem ruído: health check e arquivos estáticos ficam de fora.
    skip: req => req.path === '/api/health' || !(req.path.startsWith('/api') || req.path.startsWith('/helpdesk/api')),
    stream: {
      write: linha => {
        const d = JSON.parse(linha);
        const nivel = d.status >= 500 ? 'error' : d.status >= 400 ? 'warn' : 'info';
        logger.log(nivel, `${d.metodo} ${d.url} ${d.status} ${d.ms}ms`, d);
      },
    },
  }
);

module.exports = { logger, requestId, httpLog };
