-- Units Real Estate Marketing Agent System schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS campaigns (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  channel       TEXT NOT NULL,              -- meta | google | email | portal
  objective     TEXT,
  budget_total  NUMERIC(12,2),
  budget_daily  NUMERIC(12,2),
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | recommended | live | paused | ended
  target_area   TEXT,
  property_type TEXT,
  external_id   TEXT,                       -- id on the ad platform
  recommended_by TEXT,                      -- agent that produced it
  launched_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id            SERIAL PRIMARY KEY,
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  source        TEXT NOT NULL,              -- meta | google | portal | website | referral
  external_id   TEXT,
  full_name     TEXT,
  email         TEXT,
  phone         TEXT,
  budget_min    NUMERIC(12,2),
  budget_max    NUMERIC(12,2),
  property_type TEXT,
  area          TEXT,
  intent        TEXT,                       -- buy | rent | sell | invest
  raw_payload   JSONB,
  status        TEXT NOT NULL DEFAULT 'new',    -- new | scored | contacted | qualified | closed | lost
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS lead_scores (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier        TEXT NOT NULL,                -- hot | warm | cold
  reasoning   TEXT,
  scored_by   TEXT NOT NULL DEFAULT 'leadScorer',
  scored_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,               -- email | sms | whatsapp | call
  subject      TEXT,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | replied
  scheduled_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status       ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign     ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scores_lead        ON lead_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_lead     ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_status   ON follow_ups(status);
