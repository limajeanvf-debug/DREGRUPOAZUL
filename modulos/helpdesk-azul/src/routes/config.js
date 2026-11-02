'use strict';
const express = require('express');
const db = require('../db');
const { getConfig, setValor } = require('../settings');
const { exigirLogin, exigirAdmin } = require('../auth');
const { wrap, fail, str, PRIORIDADES } = require('../util');

const r = express.Router();

r.get('/config', exigirLogin, wrap(async (req, res) => res.json(await getConfig())));

const listaLimpa = (v, max = 120) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) { const s = str(x, max); if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s); }
  return out;
};

const LISTAS = ['lojas', 'categorias', 'emissores', 'fornecedores'];
// tabela vem de uma lista fixa, nunca do usuário
async function substituirLista(q, tabela, nomes) {
  if (!LISTAS.includes(tabela)) throw new Error('tabela inválida');
  await q(`DELETE FROM ${tabela} WHERE NOT (nome = ANY($1::text[]))`, [nomes]);
  for (let i = 0; i < nomes.length; i++) {
    await q(`INSERT INTO ${tabela} (nome, ordem) VALUES ($1, $2) ON CONFLICT (nome) DO UPDATE SET ordem = EXCLUDED.ordem`, [nomes[i], i]);
  }
  await q(`INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ('_lista', '0', $1)
           ON CONFLICT (chave) DO UPDATE SET atualizado_em = EXCLUDED.atualizado_em`, [new Date()]);
}

r.put('/config', exigirAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const sla = {};
  for (const p of PRIORIDADES) {
    const h = Number(b.sla && b.sla[p]);
    if (!(h > 0 && h <= 24 * 60)) fail(400, `Prazo inválido para a prioridade ${p}.`);
    sla[p] = h;
  }
  const lojas = listaLimpa(b.lojas);
  if (!lojas.length) fail(400, 'Cadastre pelo menos uma loja.');
  await db.transaction(async q => {
    await setValor('sla', sla, q);
    await setValor('email_helpdesk', str(b.emailHelpdesk, 190), q);
    await setValor('tel_helpdesk', str(b.telHelpdesk, 30), q);
    await substituirLista(q, 'lojas', lojas);
  });
  res.json(await getConfig());
}));

r.put('/categorias', exigirAdmin, wrap(async (req, res) => {
  const categorias = listaLimpa(req.body && req.body.categorias);
  await db.transaction(q => substituirLista(q, 'categorias', categorias));
  res.json(await getConfig());
}));

// Cadastros simples usados como seletor no novo chamado
r.put('/listas/:tipo', exigirAdmin, wrap(async (req, res) => {
  const tipo = req.params.tipo;
  if (!['categorias', 'emissores', 'fornecedores'].includes(tipo)) fail(404, 'Cadastro não encontrado.');
  const itens = listaLimpa(req.body && req.body.itens);
  await db.transaction(q => substituirLista(q, tipo, itens));
  res.json(await getConfig());
}));

module.exports = r;
