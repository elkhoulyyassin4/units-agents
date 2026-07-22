require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const campaignRecommender = require('./agents/campaignRecommender');
const campaignLauncher = require('./agents/campaignLauncher');
const leadAggregator = require('./agents/leadAggregator');
const leadScorer = require('./agents/leadScorer');
const leadFollowUp = require('./agents/leadFollowUp');

const app = express();
app.use(express.json());

// ---- Health ----
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ---- Agent endpoints ----
app.post('/agents/recommend-campaign', async (req, res, next) => {
  try { res.json(await campaignRecommender.run(req.body)); } catch (e) { next(e); }
});

app.post('/agents/launch-campaign', async (req, res, next) => {
  try { res.json(await campaignLauncher.run(req.body)); } catch (e) { next(e); }
});

app.post('/agents/aggregate-leads', async (req, res, next) => {
  try { res.json(await leadAggregator.run(req.body)); } catch (e) { next(e); }
});

app.post('/agents/score-leads', async (req, res, next) => {
  try { res.json(await leadScorer.run(req.body)); } catch (e) { next(e); }
});

app.post('/agents/follow-up', async (req, res, next) => {
  try { res.json(await leadFollowUp.run(req.body)); } catch (e) { next(e); }
});

// ---- Scheduled jobs ----
// Aggregate new leads every 15 minutes
cron.schedule('*/15 * * * *', () => leadAggregator.run().catch(console.error));
// Score leads hourly
cron.schedule('0 * * * *', () => leadScorer.run().catch(console.error));
// Follow-up pass every morning at 9:00
cron.schedule('0 9 * * *', () => leadFollowUp.run().catch(console.error));

// ---- Test email (sends ONLY to the configured owner address, to verify SMTP) ----
const { sendEmail } = require('./utils/email');
app.get('/test-email', async (_req, res, next) => {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      return res.status(400).json({ ok: false, error: 'SMTP not configured yet. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.' });
    }
    const to = process.env.TEST_EMAIL_TO || process.env.SMTP_USER; // configured owner address only
    await sendEmail({
      to,
      subject: 'Units Agents — test email',
      text: 'This is a test from your Units lead pipeline. If you received this, follow-up emails can send automatically.',
    });
    res.json({ ok: true, sentTo: to });
  } catch (e) { next(e); }
});

// ---- Error handler ----
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Units Marketing Agent System listening on :${PORT}`));
