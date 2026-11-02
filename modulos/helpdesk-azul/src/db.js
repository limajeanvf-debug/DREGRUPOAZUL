'use strict';
/**
 * Conexão com o PostgreSQL.
 * As tabelas do help desk ficam num schema próprio (padrão: "helpdesk"), então podem
 * morar no mesmo banco do sistema principal sem conflitar com tabelas de mesmo nome.
 */
const { Pool, types } = require('pg');

// COUNT(*) e outros BIGINT chegam como texto; convertemos para número
types.setTypeParser(20, v => (v === null ? null : Number(v)));

let pool = null;
let schema = 'helpdesk';

function configurar(cfg = {}) {
  if (pool) return pool;
  schema = cfg.schema || process.env.DB_SCHEMA || 'helpdesk';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Nome de schema inválido: ${schema}`);
  const useSsl = cfg.ssl !== undefined ? cfg.ssl : String(process.env.DB_SSL || 'false') === 'true';
  pool = new Pool({
    connectionString: cfg.connectionString || process.env.DATABASE_URL || undefined,
    host: cfg.host || process.env.DB_HOST || 'localhost',
    port: Number(cfg.port || process.env.DB_PORT || 5432),
    user: cfg.user || process.env.DB_USER,
    password: cfg.password || process.env.DB_PASSWORD,
    database: cfg.database || process.env.DB_NAME,
    max: Number(cfg.max || process.env.DB_POOL || 8),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    // Todas as consultas do help desk usam o schema próprio
    options: `-c TimeZone=UTC -c search_path=${schema},public`,
  });
  pool.on('error', err => console.error('[help desk/postgres] erro em conexão ociosa:', err.message));
  return pool;
}

const p = () => pool || configurar();

async function query(sql, params) {
  const { rows } = await p().query(sql, params);
  return rows;
}

async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function transaction(fn) {
  const client = await p().connect();
  try {
    await client.query('BEGIN');
    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { configurar, query, one, transaction, get pool() { return p(); }, get schema() { return schema; } };
