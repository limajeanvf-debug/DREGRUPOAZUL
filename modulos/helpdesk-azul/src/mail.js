'use strict';
// Envio automático de e-mails pelo SMTP da hospedagem (ex.: Servhost).
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

let APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const definirUrl = u => { if (u) APP_URL = String(u).replace(/\/$/, ''); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function resumo(ch) {
  return [
    ['Chamado', `${ch.numero} — ${ch.titulo}`],
    ['Loja', ch.autor_loja || '—'],
    ['Solicitante', ch.autor_nome],
    ['Categoria', ch.categoria],
    ['Prioridade', ch.prioridade],
    ch.loc_aereo ? ['Localizador aéreo', ch.loc_aereo] : null,
    ch.loc_pacote ? ['Pacote/reserva', ch.loc_pacote] : null,
    ['Status', ch.status === 'Aberto' ? 'Novo' : ch.status],
  ].filter(Boolean);
}

/** Envia sem travar a requisição. Falhas vão só para o log. */
function enviar({ para, assunto, intro, chamado, texto }) {
  if (!transporter || !para) return;
  const linhas = resumo(chamado);
  const link = APP_URL ? `${APP_URL}/#chamado-${chamado.id}` : '';
  const text = [intro, '', ...linhas.map(([k, v]) => `${k}: ${v}`), texto ? `\n${texto}` : '', link ? `\nAbrir no sistema: ${link}` : ''].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0B1B2E;max-width:560px">
    <div style="background:#0B1B2E;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;font-weight:bold">Azul Viagens Shopping Recife · Help Desk</div>
    <div style="border:1px solid #D3E3F0;border-top:0;padding:16px;border-radius:0 0 8px 8px">
      <p>${esc(intro)}</p>
      <table style="border-collapse:collapse;font-size:13px">${linhas.map(([k, v]) => `<tr><td style="color:#5A6F86;padding:3px 12px 3px 0">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
      ${texto ? `<p style="background:#F3F8FC;border-left:3px solid #8FD0F5;padding:10px 12px;white-space:pre-wrap">${esc(texto)}</p>` : ''}
      ${link ? `<p><a href="${esc(link)}" style="background:#8FD0F5;color:#0B1B2E;padding:9px 14px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir chamado</a></p>` : ''}
    </div></div>`;
  transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: para, subject: assunto, text, html })
    .catch(err => console.error('[e-mail] falha ao enviar para', para, '-', err.message));
}

module.exports = { enviar, definirUrl, ativo: () => !!transporter };
