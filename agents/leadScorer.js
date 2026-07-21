// Lead Scorer Agent
// Scores every lead with status 'new' from 0-100, assigns a tier
// (hot >= 70, warm >= 40, cold < 40), writes a row to lead_scores,
// and moves the lead to status 'scored'.
//
// Deterministic, rule-based scoring — auditable and free. Swap in an
// Anthropic API call inside scoreLead() later if you want reasoning-based
// scoring; the persistence flow stays the same.

const db = require('../utils/db');

const SOURCE_QUALITY = {
  referral: 25,
  website: 20,
  portal: 15,
  google: 12,
  meta: 8,
};

const INTENT_VALUE = {
  buy: 25,
  invest: 22,
  sell: 20,
  rent: 10,
};

/**
 * Pure scoring function — no I/O, unit-testable.
 * @param {object} lead row from the leads table
 * @returns {{score: number, tier: 'hot'|'warm'|'cold', reasoning: string}}
 */
function scoreLead(lead) {
  let score = 0;
  const reasons = [];

  // Contact completeness (max 25): can we actually reach them?
  if (lead.phone) { score += 15; reasons.push('has phone (+15)'); }
  if (lead.email) { score += 10; reasons.push('has email (+10)'); }

  // Budget signal (max 25): a stated budget is strong intent
  if (lead.budget_max != null || lead.budget_min != null) {
    score += 15; reasons.push('stated budget (+15)');
    const budget = Number(lead.budget_max ?? lead.budget_min);
    if (budget >= 1000000) { score += 10; reasons.push('budget >= 1M (+10)'); }
    else if (budget >= 500000) { score += 5; reasons.push('budget >= 500k (+5)'); }
  }

  // Intent (max 25)
  const intentPts = INTENT_VALUE[lead.intent] ?? 0;
  if (intentPts) { score += intentPts; reasons.push(`intent ${lead.intent} (+${intentPts})`); }

  // Source quality (max 25)
  const srcPts = SOURCE_QUALITY[lead.source] ?? 5;
  score += srcPts; reasons.push(`source ${lead.source || 'unknown'} (+${srcPts})`);

  // Specificity bonus: knows what and where they want
  if (lead.property_type && lead.area) { score += 5; reasons.push('specific property type + area (+5)'); }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
  return { score, tier, reasoning: reasons.join('; ') };
}

/**
 * Score all 'new' leads (or specific ids via input.leadIds).
 */
async function run(input = {}) {
  const params = [];
  let where = "status = 'new'";
  if (Array.isArray(input.leadIds) && input.leadIds.length) {
    where = 'id = ANY($1::int[])';
    params.push(input.leadIds);
  }
  const { rows: leads } = await db.query(`SELECT * FROM leads WHERE ${where}`, params);

  const results = [];
  for (const lead of leads) {
    const { score, tier, reasoning } = scoreLead(lead);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO lead_scores (lead_id, score, tier, reasoning, scored_by)
         VALUES ($1, $2, $3, $4, 'leadScorer')`,
        [lead.id, score, tier, reasoning]
      );
      await client.query(
        `UPDATE leads SET status = 'scored' WHERE id = $1`,
        [lead.id]
      );
      await client.query('COMMIT');
      results.push({ leadId: lead.id, score, tier });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`leadScorer: failed on lead ${lead.id}`, err);
      results.push({ leadId: lead.id, error: err.message });
    } finally {
      client.release();
    }
  }

  return {
    agent: 'leadScorer',
    status: 'ok',
    scored: results.filter(r => !r.error).length,
    failed: results.filter(r => r.error).length,
    results,
  };
}

module.exports = { run, scoreLead };
