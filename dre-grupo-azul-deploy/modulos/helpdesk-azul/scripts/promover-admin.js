'use strict';
// Torna alguém administrador do help desk (pelo e-mail usado no sistema principal).
// Uso: npm run promover-admin -- email@dominio.com.br ["Nome Completo"] [--fixo]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db');

(async () => {
  const args = process.argv.slice(2).filter(a => a !== '--fixo');
  const fixo = process.argv.includes('--fixo');
  const [emailRaw, nome] = args;
  if (!emailRaw || !emailRaw.includes('@')) {
    console.log('Uso: npm run promover-admin -- email@dominio.com.br ["Nome Completo"] [--fixo]');
    process.exit(1);
  }
  db.configurar();
  const email = emailRaw.toLowerCase(), t = new Date();
  const u = await db.one('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (u) {
    await db.query(`UPDATE usuarios SET perfil = 'admin', admin_fixo = (admin_fixo OR $1), ativo = TRUE, atualizado_em = $2 WHERE id = $3`, [fixo, t, u.id]);
    console.log(`${email} agora é administrador do help desk.`);
  } else {
    await db.query(`INSERT INTO usuarios (nome, email, perfil, admin_fixo, criado_em, atualizado_em) VALUES ($1, $2, 'admin', $3, $4, $4)`, [nome || email, email, fixo, t]);
    console.log(`${email} pré-cadastrado como administrador. A ficha é vinculada no primeiro acesso pelo sistema principal.`);
  }
  await db.pool.end();
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
