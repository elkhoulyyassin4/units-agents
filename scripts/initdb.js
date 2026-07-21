// Applies db/schema.sql on boot. Safe to run repeatedly — the schema uses
// CREATE TABLE IF NOT EXISTS throughout.
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('initdb: DATABASE_URL not set, skipping schema init');
    return;
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('initdb: schema applied');
}

main().catch(err => { console.error('initdb failed:', err.message); process.exit(1); });
