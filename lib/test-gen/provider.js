'use strict';
/**
 * AI provider abstraction with a hard allowlist gate: model usage is restricted to
 * the consumer's approved-model policy (DORA/GDPR/EBA governance).
 *
 * - The policy is read from <project>/ai/approved-models.json (override via
 *   QA_APPROVED_MODELS). If absent, a conservative empty allowlist is used so an
 *   unconfigured project cannot silently call a model.
 * - assertApproved(modelId) throws if the model is not on the allowlist.
 * - generate(prompt, {model}) calls the approved model when ANTHROPIC_API_KEY is
 *   set, else returns null so callers fall back to deterministic behaviour
 *   (keeps CI hermetic/offline-safe while proving the seam is real and gated).
 */
const fs = require('fs');
const path = require('path');

function loadPolicy() {
  const p = process.env.QA_APPROVED_MODELS || path.join(process.env.QA_PROJECT_DIR || process.cwd(), 'ai/approved-models.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { defaultModel: null, approved: [], dataHandlingPolicy: null }; }
}

const POLICY = loadPolicy();

function assertApproved(modelId) {
  const ok = (POLICY.approved || []).some((m) => m.id === modelId);
  if (!ok) {
    throw new Error(`[ai-policy] model '${modelId}' is NOT on the approved list ` +
      `(${(POLICY.approved || []).map((m) => m.id).join(', ') || 'none configured'}). Refusing to call it.`);
  }
  return (POLICY.approved || []).find((m) => m.id === modelId);
}

async function generate(prompt, { model = POLICY.defaultModel } = {}) {
  if (!model) throw new Error('[ai-policy] no model configured (ai/approved-models.json).');
  assertApproved(model);
  if (!process.env.ANTHROPIC_API_KEY) return null; // hermetic fallback for CI/offline
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content && data.content[0] && data.content[0].text) || null;
  } catch { return null; }
}

module.exports = { assertApproved, generate, POLICY };
