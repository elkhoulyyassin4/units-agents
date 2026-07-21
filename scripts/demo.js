// Full pipeline demo: aggregate → score → follow-up, against an in-memory
// Postgres (pg-mem). No database installation, no SMTP needed.
// Usage: npm run demo

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { newDb } = require('pg-mem');

// 1. In-memory Postgres with the real schema
const mem = newDb();
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
mem.public.none(schema);

// 2. Make require('pg') resolve to the in-memory adapter
const pgAdapter = mem.adapters.createPg();
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return pgAdapter;
  return origLoad.call(this, request, ...rest);
};

const db = require('../utils/db');
const leadAggregator = require('../agents/leadAggregator');
const leadScorer = require('../agents/leadScorer');
const leadFollowUp = require('../agents/leadFollowUp');

async function main() {
  console.log('=== STEP 1: leadAggregator — import Meta CSV export ===');
  const csvPath = path.join(__dirname, '..', 'data', 'sample-meta-leads.csv');
  const agg = await leadAggregator.run({ csvPath });
  console.log(`inserted=${agg.inserted} duplicates_skipped=${agg.skipped} failed=${agg.failed}\n`);

  console.log('=== STEP 2: leadScorer — score new leads ===');
  const scored = await leadScorer.run();
  console.log(`scored=${scored.scored} failed=${scored.failed}`);
  const { rows } = await db.query(`
    SELECT l.full_name, s.score, s.tier
    FROM lead_scores s JOIN leads l ON l.id = s.lead_id
    ORDER BY s.score DESC`);
  for (const r of rows) console.log(`  ${String(r.score).padStart(3)}  ${r.tier.toUpperCase().padEnd(5)} ${r.full_name}`);
  console.log('');

  console.log('=== STEP 3: leadFollowUp — draft tier-matched emails ===');
  const fu = await leadFollowUp.run({ dryRun: false }); // no SMTP → queued as pending
  console.log(`processed=${fu.processed} sent=${fu.sent} queued=${fu.queued} (${fu.smtp})\n`);

  const { rows: drafts } = await db.query(`
    SELECT l.full_name, f.subject, f.status
    FROM follow_ups f JOIN leads l ON l.id = f.lead_id`);
  for (const d of drafts) console.log(`  [${d.status}] to ${d.full_name}: "${d.subject}"`);

  const { rows: sample } = await db.query(`
    SELECT f.body FROM follow_ups f
    JOIN leads l ON l.id = f.lead_id
    JOIN lead_scores s ON s.lead_id = l.id
    WHERE s.tier = 'hot' LIMIT 1`);
  if (sample.length) {
    console.log('\n--- Sample HOT-tier email draft ---\n' + sample[0].body);
  }

  const { rows: statuses } = await db.query(`SELECT status, count(*) FROM leads GROUP BY status`);
  console.log('\nLead statuses: ' + statuses.map(s => `${s.status}=${s.count}`).join(', '));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
