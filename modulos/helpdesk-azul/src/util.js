'use strict';
const STATUS = ['Aberto', 'Em andamento', 'Aguardando agente', 'Resolvido', 'Fechado'];
const PRIORIDADES = ['Urgente', 'Alta', 'Média', 'Baixa'];
const PERFIS = ['agente', 'suporte', 'admin'];
const DONE = s => s === 'Resolvido' || s === 'Fechado';
const STATUS_LABEL = s => (s === 'Aberto' ? 'Novo' : s);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const iso = d => (d ? new Date(d).toISOString() : '');
const now = () => new Date();
const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Envolve rotas async para que erros cheguem ao tratador central
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { STATUS, PRIORIDADES, PERFIS, DONE, STATUS_LABEL, HttpError, fail, iso, now, str, isEmail, wrap };
