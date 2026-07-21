// Lead Aggregator Agent
// Ingests leads into the leads table with deduplication.
//
// Modes:
//   run({ csvPath })  — import a Meta Ads lead-form CSV export (Ads Manager
//                       → your form → Download leads). Column names are
//                       matched loosely, so custom question columns work.
//   run({ leads })    — ingest an array of lead objects directly (used by
//                       the future webhook endpoint and by tests).
//
// Dedup: UNIQUE(source, external_id) — re-importing the same CSV is safe.

const fs = require('fs');
const db = require('../utils/db');

/** Minimal CSV parser handling quoted fields, commas, and newlines in quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Find the first header whose lowercased name contains any of the needles. */
function col(headers, ...needles) {
  const idx = headers.findIndex(h => {
    const l = h.toLowerCase();
    return needles.some(n => l.includes(n));
  });
  return idx; // -1 if not found
}

/** Map a budget answer like "€150–250k" / "3–6M EGP" / "500k+" to a number. */
function parseBudget(answer) {
  if (!answer) return null;
  const s = String(answer).toLowerCase().replace(/,/g, '');
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  let n = parseFloat(nums[nums.length - 1]); // upper bound of a range
  if (s.includes('m')) n *= 1_000_000;
  else if (s.includes('k')) n *= 1_000;
  return n;
}

/** Map a purpose/intent answer to our intent enum. */
function parseIntent(answer) {
  if (!answer) return null;
  const s = String(answer).toLowerCase();
  if (s.includes('invest') || s.includes('rental')) return 'invest';
  if (s.includes('holiday') || s.includes('vacation') || s.includes('live') ||
      s.includes('retire') || s.includes('reloc') || s.includes('buy')) return 'buy';
  if (s.includes('rent')) return 'rent';
  if (s.includes('sell')) return 'sell';
  return null;
}

/** Convert one Meta CSV row (as object) to a leads-table record. */
function mapMetaRow(obj) {
  const keys = Object.keys(obj);
  // Needles are checked in priority order so 'full_name' wins over
  // 'campaign_name' when the needle list ends with a loose match like 'name'.
  const get = (...needles) => {
    for (const n of needles) {
      const k = keys.find(k => k.toLowerCase().includes(n));
      if (k) return obj[k];
    }
    return null;
  };
  return {
    source: 'meta',
    external_id: get('lead_id', 'id') || null,
    full_name: get('full_name', 'full name', 'name'),
    email: get('email'),
    phone: get('phone'),
    budget_max: parseBudget(get('budget')),
    intent: parseIntent(get('purpose', 'buying to', 'intent')),
    property_type: 'apartment',
    area: 'Soma Bay',
    raw_payload: obj,
  };
}

async function insertLead(l) {
  // Explicit duplicate pre-check: portable across pg and pg-mem, and gives
  // an accurate inserted/skipped count (ON CONFLICT stays as a safety net).
  if (l.external_id) {
    const dup = await db.query(
      `SELECT 1 FROM leads WHERE source = $1 AND external_id = $2`,
      [l.source, l.external_id]
    );
    if (dup.rows.length) return null;
  }
  const { rows } = await db.query(
    `INSERT INTO leads (campaign_id, source, external_id, full_name, email, phone,
                        budget_min, budget_max, property_type, area, intent, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (source, external_id) DO NOTHING
     RETURNING id`,
    [l.campaign_id ?? null, l.source, l.external_id ?? null, l.full_name ?? null,
     l.email ?? null, l.phone ?? null, l.budget_min ?? null, l.budget_max ?? null,
     l.property_type ?? null, l.area ?? null, l.intent ?? null,
     JSON.stringify(l.raw_payload ?? l)]
  );
  return rows.length ? rows[0].id : null; // null = duplicate skipped
}

async function run(input = {}) {
  let candidates = [];

  if (input.csvPath) {
    const text = fs.readFileSync(input.csvPath, 'utf8');
    const rows = parseCsv(text);
    if (rows.length < 2) return { agent: 'leadAggregator', status: 'ok', inserted: 0, skipped: 0, note: 'CSV empty' };
    const headers = rows[0];
    for (const r of rows.slice(1)) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      candidates.push(mapMetaRow(obj));
    }
  } else if (Array.isArray(input.leads)) {
    candidates = input.leads;
  } else {
    return { agent: 'leadAggregator', status: 'ok', inserted: 0, skipped: 0, note: 'nothing to ingest — pass csvPath or leads[]' };
  }

  let inserted = 0, skipped = 0;
  const errors = [];
  for (const c of candidates) {
    try {
      const id = await insertLead(c);
      if (id) inserted++; else skipped++;
    } catch (err) {
      errors.push({ lead: c.full_name || c.email, error: err.message });
    }
  }
  return { agent: 'leadAggregator', status: 'ok', inserted, skipped, failed: errors.length, errors };
}

module.exports = { run, parseCsv, parseBudget, parseIntent, mapMetaRow };
