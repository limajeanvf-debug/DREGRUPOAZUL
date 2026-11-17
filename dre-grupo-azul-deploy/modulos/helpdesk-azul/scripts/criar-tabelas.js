'use strict';
// Cria o schema e as tabelas do help desk  →  npm run db:criar
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  db.configurar();
  let sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  sql = sql.replace('CREATE SCHEMA IF NOT EXISTS helpdesk;', `CREATE SCHEMA IF NOT EXISTS ${db.schema};`)
           .replace('SET search_path TO helpdesk, public;', `SET search_path TO ${db.schema}, public;`);
  await db.pool.query(sql);
  await db.pool.end();
  console.log(`Tabelas do help desk criadas/atualizadas no schema "${db.schema}".`);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
