'use strict';
// Configurações gerais guardadas no banco: SLA, contatos do help desk, lojas e categorias.
const db = require('./db');

const SLA_PADRAO = { 'Urgente': 2, 'Alta': 4, 'Média': 8, 'Baixa': 24 };

async function getConfig() {
  const rows = await db.query('SELECT chave, valor, atualizado_em FROM configuracoes');
  const kv = {}; let versao = 0;
  for (const r of rows) {
    try { kv[r.chave] = JSON.parse(r.valor); } catch { kv[r.chave] = r.valor; }
    versao = Math.max(versao, new Date(r.atualizado_em).getTime());
  }
  const lojas = (await db.query('SELECT nome FROM lojas ORDER BY ordem, nome')).map(r => r.nome);
  const categorias = (await db.query('SELECT nome FROM categorias ORDER BY ordem, nome')).map(r => r.nome);
  const emissores = (await db.query('SELECT nome FROM emissores ORDER BY ordem, nome')).map(r => r.nome);
  const fornecedores = (await db.query('SELECT nome FROM fornecedores ORDER BY ordem, nome')).map(r => r.nome);
  return {
    sla: { ...SLA_PADRAO, ...(kv.sla || {}) },
    emailHelpdesk: kv.email_helpdesk || '',
    telHelpdesk: kv.tel_helpdesk || '',
    lojas, categorias, emissores, fornecedores,
    versao: String(versao),
  };
}

async function setValor(chave, valor, q = db.query) {
  await q(
    `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES ($1, $2, $3)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = EXCLUDED.atualizado_em`,
    [chave, JSON.stringify(valor), new Date()]
  );
}

const slaHoras = (cfg, prioridade) => Number(cfg.sla[prioridade]) || SLA_PADRAO[prioridade] || 8;
const prazoPara = (cfg, criadoEm, prioridade) => new Date(new Date(criadoEm).getTime() + slaHoras(cfg, prioridade) * 3600000);

module.exports = { getConfig, setValor, slaHoras, prazoPara, SLA_PADRAO };
