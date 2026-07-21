// Lead Follow-Up Agent
// Finds scored leads that have never been followed up, drafts a
// tier-matched email, and sends it via utils/email if SMTP is configured.
// Without SMTP config the drafts are queued as status 'pending' so you can
// review them (SELECT * FROM follow_ups WHERE status = 'pending').
//
// EU lead rules baked in: email-first, no pressure language, video-call
// offer before site-visit push.

const db = require('../utils/db');
const { sendEmail } = require('../utils/email');

const SIGNATURE = process.env.FOLLOWUP_SIGNATURE ||
  'Units Real Estate — Soma Bay\nyassinramy255@icloud.com';

function draftEmail(lead, tier) {
  const name = (lead.full_name || '').split(' ')[0] || 'there';
  if (tier === 'hot') {
    return {
      subject: 'Your Soma Bay apartment shortlist — 3 options',
      body:
`Hi ${name},

Thanks for your interest in Soma Bay. Based on what you told us, I've shortlisted three apartments that match your budget and goals — happy to send floor plans and current developer payment terms.

Would a 20-minute video call this week suit you? I can walk you through the units and the bay itself so you know exactly what to expect before considering a visit.

Best regards,
${SIGNATURE}`,
    };
  }
  if (tier === 'warm') {
    return {
      subject: 'Soma Bay apartments — catalogue and current prices',
      body:
`Hi ${name},

Thanks for requesting information about apartments in Soma Bay. I've attached our current catalogue with prices, floor plans, and payment plans from the developers we work with.

If any of them catch your eye, just reply and I'll answer any questions — no obligation at all.

Best regards,
${SIGNATURE}`,
    };
  }
  return {
    subject: 'Soma Bay — a short guide to buying on the Red Sea',
    body:
`Hi ${name},

Thanks for your interest in Soma Bay. Since you're still exploring, here's a short guide covering how buying property in Egypt works for international buyers, what the ownership process looks like, and what makes Soma Bay different from other Red Sea destinations.

I'll check in occasionally with new listings — and if you ever have questions, just reply to this email.

Best regards,
${SIGNATURE}`,
  };
}

const smtpConfigured = () => !!process.env.SMTP_HOST;

async function run(input = {}) {
  // Scored leads with an email address and no follow-up yet.
  // Latest score per lead resolved in JS — portable across pg and pg-mem.
  const { rows: candidates } = await db.query(
    `SELECT * FROM leads WHERE status = 'scored' AND email IS NOT NULL`);
  const { rows: done } = await db.query(`SELECT DISTINCT lead_id FROM follow_ups`);
  const alreadyFollowedUp = new Set(done.map(r => r.lead_id));

  const leads = [];
  for (const lead of candidates) {
    if (alreadyFollowedUp.has(lead.id)) continue;
    const { rows: scores } = await db.query(
      `SELECT tier, score FROM lead_scores
       WHERE lead_id = $1 ORDER BY scored_at DESC, id DESC LIMIT 1`,
      [lead.id]
    );
    if (!scores.length) continue;
    if (input.tier && scores[0].tier !== input.tier) continue;
    leads.push({ ...lead, tier: scores[0].tier, score: scores[0].score });
  }

  const results = [];
  for (const lead of leads) {
    const draft = draftEmail(lead, lead.tier);
    let status = 'pending', sentAt = null, error = null;

    if (smtpConfigured() && !input.dryRun) {
      try {
        await sendEmail({ to: lead.email, subject: draft.subject, text: draft.body });
        status = 'sent';
        sentAt = new Date();
      } catch (err) {
        status = 'failed';
        error = err.message;
      }
    }

    await db.query(
      `INSERT INTO follow_ups (lead_id, channel, subject, body, status, sent_at)
       VALUES ($1, 'email', $2, $3, $4, $5)`,
      [lead.id, draft.subject, draft.body, status, sentAt]
    );
    if (status === 'sent') {
      await db.query(`UPDATE leads SET status = 'contacted' WHERE id = $1`, [lead.id]);
    }
    results.push({ leadId: lead.id, tier: lead.tier, email: lead.email, status, error });
  }

  return {
    agent: 'leadFollowUp',
    status: 'ok',
    smtp: smtpConfigured() ? 'configured' : 'not configured — drafts queued as pending',
    processed: results.length,
    sent: results.filter(r => r.status === 'sent').length,
    queued: results.filter(r => r.status === 'pending').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  };
}

module.exports = { run, draftEmail };
