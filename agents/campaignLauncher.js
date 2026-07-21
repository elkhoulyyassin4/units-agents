// Campaign Launcher Agent
// Creates a Meta (Facebook) lead-generation campaign via the Marketing API.
//
// SAFETY BY DESIGN:
//   - Never handles secrets in code. The access token is read from the
//     environment (META_ACCESS_TOKEN), set by the owner in Railway/host.
//   - Everything is created with status 'PAUSED'. Nothing spends money until
//     the owner reviews it in Ads Manager and switches it on manually.
//
// Requires (all from env unless passed in input):
//   META_ACCESS_TOKEN     long-lived token with ads_management (owner sets this)
//   META_AD_ACCOUNT_ID    e.g. "act_186650726490228" (or just the digits)
//   META_PAGE_ID          the Facebook Page the ad runs from
//   META_LEAD_FORM_ID     an existing Instant Form id to collect leads
//
// Usage:
//   POST /agents/launch-campaign
//   { "name": "SomaBay-EU-Leads", "dailyBudget": 400, "countries": ["DE","AT","CH"],
//     "ageMin": 25, "ageMax": 65 }

const axios = require('axios');

const API_VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

function cfg(input, key, envKey, required = true) {
  const val = input[key] ?? process.env[envKey];
  if (required && !val) {
    throw new Error(`campaignLauncher: missing ${key} (set ${envKey} in the environment or pass it in)`);
  }
  return val;
}

function normalizeAccount(id) {
  return String(id).startsWith('act_') ? id : `act_${id}`;
}

async function fbPost(path, params, token) {
  try {
    const { data } = await axios.post(`${BASE}/${path}`, null, {
      params: { ...params, access_token: token },
    });
    return data;
  } catch (err) {
    const fb = err.response?.data?.error;
    throw new Error(`Meta API error on ${path}: ${fb ? fb.message : err.message}`);
  }
}

async function run(input = {}) {
  const token = cfg(input, 'accessToken', 'META_ACCESS_TOKEN');
  const account = normalizeAccount(cfg(input, 'adAccountId', 'META_AD_ACCOUNT_ID'));
  const pageId = cfg(input, 'pageId', 'META_PAGE_ID');
  const formId = cfg(input, 'leadFormId', 'META_LEAD_FORM_ID');

  const name = input.name || 'Units Lead Campaign';
  const dailyBudget = Math.round((input.dailyBudget ?? 400) * 100); // API wants minor units
  const countries = input.countries || ['DE', 'AT', 'CH'];
  const ageMin = input.ageMin ?? 25;
  const ageMax = input.ageMax ?? 65;

  // 1. Campaign (PAUSED — will not deliver until owner turns it on)
  const campaign = await fbPost(`${account}/campaigns`, {
    name,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(['HOUSING']),
  }, token);

  // 2. Ad set (PAUSED) — targeting, budget, and the lead form as the goal
  const adSet = await fbPost(`${account}/adsets`, {
    name: `${name} — Ad Set`,
    campaign_id: campaign.id,
    status: 'PAUSED',
    daily_budget: dailyBudget,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'ON_AD',
    promoted_object: JSON.stringify({ page_id: pageId }),
    targeting: JSON.stringify({
      geo_locations: { countries },
      age_min: ageMin,
      age_max: ageMax,
    }),
  }, token);

  return {
    agent: 'campaignLauncher',
    status: 'created_paused',
    message: 'Campaign and ad set created in PAUSED state. Review in Ads Manager and switch on to start delivery. Creative/ad still to be attached.',
    campaignId: campaign.id,
    adSetId: adSet.id,
    leadFormId: formId,
    reviewUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.replace('act_', '')}`,
  };
}

module.exports = { run, normalizeAccount };
