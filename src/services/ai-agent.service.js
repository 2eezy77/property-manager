/**
 * ai-agent.service.js
 *
 * AI Communication Agent — powered by Claude (Anthropic API).
 *
 * Responsibilities:
 *   1. CLASSIFY  — read a new tenant message and determine:
 *                    category, urgency, triage_status, suggested_reply, should_auto_respond
 *   2. AUTO-RESPOND — if confidence is high and urgency is not emergency, post a
 *                    helpful AI reply so the tenant isn't left waiting
 *   3. ESCALATE  — if urgency=emergency or classification confidence is low,
 *                    flip triage_status to 'escalated' and notify managers
 *   4. CREATE MAINTENANCE — if category=maintenance and confidence is high,
 *                    auto-create a maintenance_request row
 *   5. LOG       — every AI action is recorded in ai_agent_logs for auditing
 *
 * ── Env vars needed ──────────────────────────────────────────────────────────
 *   ANTHROPIC_API_KEY  — from https://console.anthropic.com
 *   AI_AGENT_MODEL     — model string, e.g. claude-haiku-4-5-20251001 (default)
 *
 * ── How it's triggered ───────────────────────────────────────────────────────
 *   POST /api/messages  (messages.routes.js) calls processInboundMessage()
 *   after persisting the tenant's message to the DB.
 */

const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/client');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = process.env.AI_AGENT_MODEL ?? 'claude-haiku-4-5-20251001';

// ─── Prompt templates ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant for a residential property management company.
Your job is to read tenant messages and:
1. Classify the message category and urgency
2. Draft a helpful, professional reply if appropriate
3. Decide whether a human manager needs to be involved immediately

Tone: warm, professional, reassuring. Never promise specific timelines unless certain.
Always acknowledge the tenant's concern before giving information.`;

function buildClassifyPrompt(thread, messages, tenantName, propertyName, unitNumber) {
  const messageHistory = messages
    .slice(-6)  // last 6 messages for context
    .map(m => `[${m.sender_type === 'tenant' ? 'Tenant' : 'Manager'}]: ${m.body}`)
    .join('\n');

  return `You are processing a message in a property management system.

Property: ${propertyName}
Unit: ${unitNumber}
Tenant: ${tenantName}
Thread subject: ${thread.subject ?? '(none)'}
Prior category: ${thread.category ?? 'unknown'}

Message history (most recent last):
---
${messageHistory}
---

Respond with ONLY valid JSON in this exact schema — no markdown, no explanation:
{
  "category": "<maintenance|payment|lease|noise|general|emergency>",
  "urgency": "<low|medium|high|emergency>",
  "triage_status": "<pending|triaged|auto_responded|escalated>",
  "should_auto_respond": <true|false>,
  "confidence": <0.0-1.0>,
  "auto_reply": "<reply text, or empty string if should_auto_respond=false>",
  "escalation_reason": "<reason for escalation, or empty string>",
  "create_maintenance_request": <true|false>,
  "maintenance_title": "<short title if create_maintenance_request=true, else empty string>",
  "maintenance_category": "<plumbing|hvac|electrical|appliance|structural|pest|exterior|other>",
  "maintenance_priority": "<low|medium|high|emergency if create_maintenance_request=true, else empty string>"
}

Rules:
- urgency=emergency if: fire, flood, gas leak, break-in, no heat in winter, sewage backup
- should_auto_respond=false if urgency=emergency (always escalate to human)
- should_auto_respond=false if confidence < 0.75
- triage_status=escalated if urgency=emergency OR confidence < 0.6
- create_maintenance_request=true if category=maintenance AND confidence > 0.8
- auto_reply must be helpful, under 150 words, and NOT make specific promises about timing`;
}

// ─── Logging helper ───────────────────────────────────────────────────────────

async function logAction({ threadId, messageId, action, inputContext, outputResult,
                           inputTokens, outputTokens, latencyMs }) {
  try {
    await pool.query(
      `INSERT INTO ai_agent_logs
         (thread_id, message_id, action, model_used, input_tokens, output_tokens,
          latency_ms, input_context, output_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [threadId, messageId, action, MODEL,
       inputTokens ?? null, outputTokens ?? null, latencyMs ?? null,
       JSON.stringify(inputContext), JSON.stringify(outputResult)]
    );
  } catch (err) {
    console.error('[ai-agent] Failed to write log:', err.message);
  }
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Call Claude to classify the inbound message and get a draft reply.
 * Returns parsed classification or null on error.
 */
async function classify(thread, messages, tenantName, propertyName, unitNumber) {
  const prompt = buildClassifyPrompt(thread, messages, tenantName, propertyName, unitNumber);
  const startMs = Date.now();

  let response;
  try {
    response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('[ai-agent] Anthropic API error:', err.message);
    return null;
  }

  const latencyMs   = Date.now() - startMs;
  const rawText     = response.content[0]?.text ?? '';
  const inputTokens = response.usage?.input_tokens;
  const outputTokens = response.usage?.output_tokens;

  let parsed;
  try {
    // Strip potential markdown fences if the model slips
    const jsonText = rawText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[ai-agent] Failed to parse classification JSON:', rawText.slice(0, 200));
    return null;
  }

  return { parsed, inputTokens, outputTokens, latencyMs, rawText };
}

// ─── Notify managers of escalation ───────────────────────────────────────────

async function notifyEscalation(thread, tenantName, reason, propertyId) {
  // Find managers assigned to this property
  const { rows: staff } = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN property_assignments pa ON pa.user_id = u.id
     WHERE pa.property_id = $1
       AND u.is_active = TRUE
       AND u.role IN ('property_manager', 'owner')`,
    [propertyId]
  );

  if (!staff.length) return;

  const title = `Escalated message from ${tenantName}`;
  const body  = reason
    ? `A message has been escalated: ${reason}`
    : `A tenant message requires your attention.`;
  const actionUrl = `/manager/messages/${thread.id}`;

  const placeholders = staff.map((_, i) => {
    const b = i * 5;
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`;
  }).join(', ');

  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, channel, action_url)
     VALUES ${placeholders}`,
    staff.flatMap(s => [s.id, 'message_escalation', title, body, 'in_app', actionUrl])
  );
}

// ─── Auto-create maintenance request ─────────────────────────────────────────

async function createMaintenanceRequest(thread, classification, tenantId, unitId) {
  if (!unitId) return null;  // need a unit to attach the request to

  const { rows } = await pool.query(
    `INSERT INTO maintenance_requests
       (unit_id, tenant_id, thread_id, title, description,
        status, priority, category, is_ai_triaged,
        ai_priority_suggestion, ai_category_suggestion)
     VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, TRUE, $6, $7)
     RETURNING id`,
    [
      unitId, tenantId, thread.id,
      classification.maintenance_title || 'Maintenance Request',
      `Auto-created by AI agent from tenant message.`,
      classification.maintenance_priority || 'medium',
      classification.maintenance_category || 'other',
    ]
  );

  // Link the thread back to the maintenance request
  await pool.query(
    `UPDATE message_threads SET maintenance_request_id = $1 WHERE id = $2`,
    [rows[0].id, thread.id]
  );

  return rows[0].id;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Called after a tenant message is persisted.
 * Runs async — the HTTP response has already been sent.
 *
 * @param {string} messageId   UUID of the newly inserted message
 * @param {string} threadId    UUID of the message thread
 */
async function processInboundMessage(messageId, threadId) {
  // 1. Load thread, recent messages, tenant info, property context
  const { rows: threadRows } = await pool.query(
    `SELECT mt.*,
            (u.first_name || ' ' || u.last_name) AS tenant_name,
            u.id        AS tenant_user_id,
            l.unit_id,
            un.unit_number,
            p.id   AS property_id,
            p.name AS property_name
     FROM message_threads mt
     JOIN users      u  ON u.id = mt.tenant_id
     LEFT JOIN leases l  ON l.id = mt.lease_id
     LEFT JOIN units  un ON un.id = l.unit_id
     LEFT JOIN properties p ON p.id = un.property_id
     WHERE mt.id = $1`,
    [threadId]
  );

  if (!threadRows.length) {
    console.error('[ai-agent] Thread not found:', threadId);
    return;
  }

  const thread = threadRows[0];

  const { rows: messages } = await pool.query(
    `SELECT sender_type, body, is_internal, created_at
     FROM messages
     WHERE thread_id = $1 AND is_internal = FALSE
     ORDER BY created_at ASC
     LIMIT 20`,
    [threadId]
  );

  // 2. Classify
  const result = await classify(
    thread, messages,
    thread.tenant_name ?? 'Tenant',
    thread.property_name ?? 'the property',
    thread.unit_number   ?? 'your unit'
  );

  if (!result) {
    // Claude unavailable or unparseable — silently leave for human triage
    await pool.query(
      `UPDATE message_threads SET triage_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [threadId]
    );
    return;
  }

  const { parsed: cls, inputTokens, outputTokens, latencyMs } = result;

  await logAction({
    threadId, messageId, action: 'classify',
    inputContext: { messageCount: messages.length },
    outputResult: cls,
    inputTokens, outputTokens, latencyMs,
  });

  // 3. Update thread with AI classification
  await pool.query(
    `UPDATE message_threads
     SET category      = $1,
         urgency       = $2,
         triage_status = $3,
         updated_at    = NOW()
     WHERE id = $4`,
    [cls.category, cls.urgency, cls.triage_status, threadId]
  );

  // 4. Auto-respond if confidence is high and not an emergency
  if (cls.should_auto_respond && cls.auto_reply && cls.urgency !== 'emergency') {
    const { rows: replyRows } = await pool.query(
      `INSERT INTO messages
         (thread_id, sender_type, direction, channel, body,
          is_internal, is_ai_generated, ai_model_version, ai_confidence_score)
       VALUES ($1, 'ai_agent', 'outbound', 'in_app', $2, FALSE, TRUE, $3, $4)
       RETURNING id`,
      [threadId, cls.auto_reply, MODEL, cls.confidence]
    );

    await logAction({
      threadId, messageId: replyRows[0].id, action: 'auto_respond',
      inputContext: { confidence: cls.confidence },
      outputResult: { reply: cls.auto_reply },
    });

    // Mark triage as auto_responded if not already escalated
    if (cls.triage_status !== 'escalated') {
      await pool.query(
        `UPDATE message_threads
         SET triage_status = 'auto_responded', updated_at = NOW()
         WHERE id = $1`,
        [threadId]
      );
    }
  }

  // 5. Escalate emergencies and low-confidence messages
  if (cls.triage_status === 'escalated' || cls.urgency === 'emergency') {
    if (thread.property_id) {
      await notifyEscalation(
        thread,
        thread.tenant_name ?? 'Tenant',
        cls.escalation_reason,
        thread.property_id
      );
    }

    await logAction({
      threadId, messageId, action: 'escalate',
      inputContext: { urgency: cls.urgency, confidence: cls.confidence },
      outputResult: { reason: cls.escalation_reason },
    });
  }

  // 6. Auto-create maintenance request
  if (cls.create_maintenance_request && thread.unit_id) {
    const maintenanceId = await createMaintenanceRequest(
      thread, cls, thread.tenant_user_id, thread.unit_id
    );

    if (maintenanceId) {
      await logAction({
        threadId, messageId, action: 'create_maintenance',
        inputContext: { title: cls.maintenance_title },
        outputResult: { maintenance_request_id: maintenanceId },
      });
    }
  }
}

/**
 * Summarise a thread for the manager dashboard.
 * Returns a 2-3 sentence summary of the conversation.
 */
async function summariseThread(threadId) {
  const { rows: messages } = await pool.query(
    `SELECT sender_type, body, created_at
     FROM messages
     WHERE thread_id = $1 AND is_internal = FALSE
     ORDER BY created_at ASC
     LIMIT 30`,
    [threadId]
  );

  if (!messages.length) return null;

  const history = messages
    .map(m => `[${m.sender_type}]: ${m.body}`)
    .join('\n');

  const startMs = Date.now();
  let response;
  try {
    response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 200,
      system:     SYSTEM_PROMPT,
      messages:   [{
        role:    'user',
        content: `Summarise this property management message thread in 2-3 sentences for a property manager. Be concise and factual.\n\n${history}`,
      }],
    });
  } catch (err) {
    console.error('[ai-agent] summarise error:', err.message);
    return null;
  }

  const summary   = response.content[0]?.text ?? '';
  const latencyMs = Date.now() - startMs;

  // Persist summary to thread
  await pool.query(
    `UPDATE message_threads SET ai_summary = $1, updated_at = NOW() WHERE id = $2`,
    [summary, threadId]
  );

  await logAction({
    threadId, messageId: null, action: 'summarize',
    inputContext: { messageCount: messages.length },
    outputResult: { summary },
    inputTokens:  response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    latencyMs,
  });

  return summary;
}

module.exports = { processInboundMessage, summariseThread };
