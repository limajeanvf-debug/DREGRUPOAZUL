'use strict';
/**
 * Importa os dados do Help Desk publicado no Claude (usuários, chamados, mensagens, prints e configurações).
 * Os arquivos ficam em ./dados-importacao (pastas hd_users, hd_tickets, hd_anexos, hd_config).
 * Pode ser executado mais de uma vez: o que já existe é ignorado.   →  npm run importar
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/db');
const { setValor } = require('../src/settings');

const DIR = path.join(__dirname, '..', 'dados-importacao');
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const ler = pasta => {
  const p = path.join(DIR, pasta);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')) }));
};
const data = v => (v ? new Date(v) : null);
const PERFIS = ['agente', 'suporte', 'admin'];

(async () => {
  db.configurar();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const t = new Date();
  const resumo = { usuarios: 0, chamados: 0, mensagens: 0, prints: 0 };

  // Configurações
  const cfg = ler('hd_config').find(c => c.id === 'geral');
  if (cfg) {
    if (cfg.sla) await setValor('sla', cfg.sla);
    if (cfg.emailHelpdesk) await setValor('email_helpdesk', cfg.emailHelpdesk);
    if (cfg.telHelpdesk) await setValor('tel_helpdesk', cfg.telHelpdesk);
    for (const [i, nome] of (cfg.lojas || []).entries()) await db.query('INSERT INTO lojas (nome, ordem) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING', [nome, i]);
    for (const [i, nome] of (cfg.categorias || []).entries()) await db.query('INSERT INTO categorias (nome, ordem) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING', [nome, i]);
  }

  // Usuários (sem senha: são vinculados pelo e-mail no primeiro acesso pelo sistema principal)
  const mapaUsuarios = {};
  for (const u of ler('hd_users')) {
    const email = String(u.email || '').toLowerCase();
    if (!email) continue;
    const existe = await db.one('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe) { mapaUsuarios[u.id] = existe.id; continue; }
    const r = await db.one(
      `INSERT INTO usuarios (nome, email, telefone, loja, perfil, admin_fixo, ativo, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.nome || email, email, u.tel || null, u.loja || u.setor || null, PERFIS.includes(u.perfil) ? u.perfil : 'agente',
        !!u.adminFixo, !u.inativo, data(u.criadoEm) || t, t]);
    mapaUsuarios[u.id] = r.id; resumo.usuarios++;
  }

  // Prints
  const anexosPorId = Object.fromEntries(ler('hd_anexos').map(a => [a.id, a]));

  // Chamados
  for (const c of ler('hd_tickets')) {
    if (await db.one('SELECT id FROM chamados WHERE numero = $1', [c.numero])) continue;
    const r = await db.one(
      `INSERT INTO chamados (numero, titulo, categoria, prioridade, status, loc_aereo, loc_pacote, descricao, autor_id, autor_nome, autor_email, autor_loja,
        responsavel_id, responsavel_nome, criado_em, atualizado_em, prazo_em, resolvido_em, ultima_msg_visao, ultima_msg_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [c.numero, c.titulo || '(sem título)', c.categoria || 'Geral', c.prioridade || 'Média', c.status || 'Aberto',
        (c.locAereo || '').slice(0, 10) || null, c.locPacote || c.localizador || null, c.descricao || '',
        mapaUsuarios[c.autorId] || null, c.autorNome || '—', c.autorEmail || null, c.autorLoja || c.autorSetor || null,
        mapaUsuarios[c.responsavelId] || null, c.responsavelNome || null,
        data(c.criadoEm) || t, data(c.atualizadoEm) || t, data(c.prazoEm) || data(c.criadoEm) || t, data(c.resolvidoEm),
        ['agente', 'suporte'].includes(c.ultimaMsgPerfil) ? c.ultimaMsgPerfil : null, data(c.ultimaMsgEm)]);
    const cid = r.id; resumo.chamados++;
    for (const m of c.mensagens || []) {
      if (m.sistema) await db.query('INSERT INTO mensagens (chamado_id, sistema, texto, criado_em) VALUES ($1, TRUE, $2, $3)', [cid, m.texto || '', data(m.em) || t]);
      else await db.query('INSERT INTO mensagens (chamado_id, autor_id, autor_nome, visao, texto, qtd_anexos, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [cid, mapaUsuarios[m.autorId] || null, m.autor || null, m.perfil === 'agente' ? 'agente' : 'suporte', m.texto || '', m.anexos || 0, data(m.em) || t]);
      resumo.mensagens++;
    }
    for (const ref of c.anexos || []) {
      const a = anexosPorId[ref.id];
      const match = a && /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(a.dataUrl || '');
      if (!match) continue;
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[match[1]];
      const buf = Buffer.from(match[2], 'base64');
      const arquivo = crypto.randomBytes(16).toString('hex') + ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buf);
      await db.query('INSERT INTO anexos (chamado_id, nome_original, arquivo, mime, tamanho, autor_id, autor_nome, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [cid, (ref.nome || a.nome || 'print.jpg').slice(0, 255), arquivo, match[1], buf.length, mapaUsuarios[a.autorId] || null, ref.autor || null, data(ref.em || a.em) || t]);
      resumo.prints++;
    }
  }
  await db.pool.end();
  console.log('Importação concluída:', resumo);
  console.log('Depois de conferir os dados, apague a pasta dados-importacao do servidor.');
})().catch(e => { console.error('Erro na importação:', e.message); process.exit(1); });
