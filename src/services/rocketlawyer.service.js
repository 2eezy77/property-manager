/**
 * rocketlawyer.service.js
 *
 * Rocket Lawyer REST API — sandbox + production.
 *
 * Auth:     POST /partners/v1/auth/accesstoken (+ /servicetoken for embedded UX)
 * Docs:     POST /rocketdoc/v2/interviews (RocketDocument v2.2)
 * Binders:  /document-manager/v1/binders  (RocketSign)
 * Events:   POST /events/v1/subscriptions → eventPulls → eventAcknowledgements
 *
 * Sign flow:
 *   1. POST binders (parties)
 *   2. PUT  binders/:id/documents/:docId  (HTML body)
 *   3. POST binders/:id/requests/finalisations
 *   4. POST binders/:id/requests/invitations  → binderUrl per signer
 *
 * Docs: https://developer.rocketlawyer.com
 */

const https = require('https');
const http  = require('http');
const { randomUUID } = require('crypto');
const pool  = require('../db/client');
const { ensureLeaseSigningFee } = require('./lease-signing-pay.service');

const RL_BASE = (process.env.RL_BASE_URL ?? 'https://api-sandbox.rocketlawyer.com').replace(/\/$/, '');
const RL_AUTH_PATH = process.env.RL_AUTH_PATH ?? '/partners/v1/auth/accesstoken';
const RL_SERVICE_TOKEN_PATH = process.env.RL_SERVICE_TOKEN_PATH ?? '/partners/v1/auth/servicetoken';
const RL_BINDER_PREFIX = process.env.RL_BINDER_PREFIX ?? '/document-manager/v1/binders';
const RL_ROCKETDOC_PREFIX = process.env.RL_ROCKETDOC_PREFIX ?? '/rocketdoc/v2';
const RL_EVENTS_PREFIX = process.env.RL_EVENTS_PREFIX ?? '/events/v1';
const RL_SERVICE_PURPOSE_BINDER = process.env.RL_SERVICE_TOKEN_PURPOSE_BINDER
  ?? 'api.rocketlawyer.com/binder-party-access';
const RL_SERVICE_PURPOSE_ROCKETDOC = process.env.RL_SERVICE_TOKEN_PURPOSE_ROCKETDOC
  ?? 'api.rocketlawyer.com/rocketdoc';

function apiKey() {
  return String(process.env.RL_API_KEY ?? process.env.RL_CLIENT_ID ?? '').trim();
}

function apiSecret() {
  return String(process.env.RL_API_SECRET ?? process.env.RL_CLIENT_SECRET ?? '').trim();
}

function templateConfigured() {
  const id = String(process.env.RL_LEASE_TEMPLATE_ID ?? '').trim();
  return Boolean(id && id !== 'REPLACE_ME' && !id.startsWith('your_'));
}

// ─── Token cache ─────────────────────────────────────────────────────────────

let _tokenCache = { token: null, expiresAt: 0, apiProducts: [] };
let _eventsPoller = null;

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const key = apiKey();
  const secret = apiSecret();
  if (!key || !secret) {
    throw Object.assign(new Error('Set RL_API_KEY + RL_API_SECRET (or RL_CLIENT_ID + RL_CLIENT_SECRET)'), { statusCode: 500 });
  }

  const body = JSON.stringify({
    grant_type:    'client_credentials',
    client_id:     key,
    client_secret: secret,
  });

  let res;
  try {
    res = await httpRequest('POST', RL_BASE, RL_AUTH_PATH, body, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  } catch (err) {
    const fault = String(err.body?.fault?.faultstring ?? err.message ?? '');
    if (err.statusCode === 403 && (fault.includes('api_client_id') || fault.includes('Invalid Client'))) {
      throw Object.assign(new Error(
        'Rocket Lawyer app is not fully provisioned yet. Authentication may show Enabled in the portal while your app is still approving. Email api@rocketlawyer.com with your app name.'
      ), { statusCode: 503, code: 'RL_APP_PENDING' });
    }
    throw err;
  }

  const token = res.access_token ?? res.accessToken;
  if (!token) {
    throw Object.assign(new Error(`Rocket Lawyer auth failed: ${JSON.stringify(res)}`), { statusCode: 502 });
  }

  const expiresIn = Number(res.expires_in ?? res.expiresIn ?? 3600);
  const apiProducts = Array.isArray(res.api_product_list)
    ? res.api_product_list
    : (Array.isArray(res.apiProductList) ? res.apiProductList : []);

  _tokenCache = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
    apiProducts,
  };
  return token;
}

function getCachedApiProducts() {
  return _tokenCache.apiProducts ?? [];
}

function productEnabled(matchers) {
  const products = getCachedApiProducts().map(p => String(p).toLowerCase());
  if (!products.length) return null;
  return matchers.some(m => products.some(p => p.includes(String(m).toLowerCase())));
}

async function createServiceToken({ purpose, expirationTime, claims = {} }) {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const body = JSON.stringify({
    purpose,
    expirationTime: expirationTime ?? Math.floor(Date.now() / 1000) + 86400 * 365,
    ...claims,
  });
  return httpRequest('POST', RL_BASE, RL_SERVICE_TOKEN_PATH, body, headers);
}

async function authHeaders(extra = {}) {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra,
  };
}

// ─── RocketDocument v2 — interviews + documents (OpenAPI v2.2) ────────────────

function mapInterviewStatus(status) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'completed') return 'completed';
  if (['created', 'draft'].includes(s)) return 'draft';
  return s || 'unknown';
}

async function createInterview({
  templateId,
  partyEmailAddress,
  binderId,
  partnerEndUserId,
  inputData,
}) {
  if (!templateId) {
    throw Object.assign(new Error('templateId is required'), { statusCode: 400 });
  }
  if (!partyEmailAddress && !binderId) {
    throw Object.assign(new Error('partyEmailAddress or binderId is required'), { statusCode: 400 });
  }

  const body = { templateId };
  if (binderId) body.binderId = binderId;
  else body.partyEmailAddress = partyEmailAddress;
  if (partnerEndUserId) body.partnerEndUserId = String(partnerEndUserId);
  if (inputData) body.inputData = inputData;

  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const path = `${RL_ROCKETDOC_PREFIX}/interviews`;
  const res = await httpRequest('POST', RL_BASE, path, JSON.stringify(body), headers, { returnMeta: true });

  const interview = res.body ?? res;
  const interviewId = interview.interviewId ?? interview.id;
  if (!interviewId) {
    throw Object.assign(new Error(`RocketDocument interview create failed: ${JSON.stringify(interview)}`), { statusCode: 502 });
  }

  const serviceToken = res.headers?.['rl-rdoc-servicetoken'] ?? null;
  const rlBinderId = interview.binder?.binderId ?? null;
  const documentId = interview.binder?.documentId ?? interviewId;

  return {
    interviewId,
    documentId,
    binderId: rlBinderId,
    serviceToken,
    interviewUrl: serviceToken
      ? `${process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'}/manager/leases?rlInterview=${interviewId}`
      : null,
    status: mapInterviewStatus(interview.interviewStatus ?? interview.status),
  };
}

/** @deprecated alias — prefer createInterview */
async function createDocument(opts) {
  const { templateId, answers, locale, partyEmailAddress, partnerEndUserId, binderId } = opts;
  void locale;
  return createInterview({
    templateId,
    partyEmailAddress,
    binderId,
    partnerEndUserId,
    inputData: answers,
  });
}

async function getInterview(interviewId) {
  const headers = await authHeaders();
  const path = `${RL_ROCKETDOC_PREFIX}/interviews/${encodeURIComponent(interviewId)}`;
  const res = await httpRequest('GET', RL_BASE, path, null, headers);

  return {
    interviewId: res.interviewId ?? res.id ?? interviewId,
    documentId: res.binder?.documentId ?? null,
    binderId: res.binder?.binderId ?? null,
    status: mapInterviewStatus(res.interviewStatus ?? res.status),
    interviewUrl: null,
    pdfUrl: null,
    htmlUrl: null,
  };
}

async function fetchDocumentHtml(documentId) {
  const headers = await authHeaders({ Accept: 'text/html' });
  const path = `${RL_ROCKETDOC_PREFIX}/documents/${encodeURIComponent(documentId)}`;
  const html = await httpRequest('GET', RL_BASE, path, null, headers, { raw: true });
  return typeof html === 'string' ? html : null;
}

async function getDocument(documentOrInterviewId) {
  try {
    const interview = await getInterview(documentOrInterviewId);
    if (interview.documentId) {
      const html = await fetchDocumentHtml(interview.documentId).catch(() => null);
      return {
        ...interview,
        documentId: interview.documentId,
        status: interview.status === 'completed' ? 'completed' : interview.status,
        htmlUrl: html ? `inline:${interview.documentId}` : null,
        pdfUrl: null,
      };
    }
    return interview;
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  const html = await fetchDocumentHtml(documentOrInterviewId).catch(() => null);
  return {
    documentId: documentOrInterviewId,
    interviewId: null,
    status: html ? 'completed' : 'unknown',
    pdfUrl: null,
    htmlUrl: html ? `inline:${documentOrInterviewId}` : null,
    interviewUrl: null,
  };
}

async function listTemplates({ pageSize = 20, index, lookupValue, cursor } = {}) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (pageSize) params.set('pageSize', String(pageSize));
  if (index) params.set('index', index);
  if (lookupValue) params.set('lookupValue', lookupValue);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  const path = `${RL_ROCKETDOC_PREFIX}/templates${qs ? `?${qs}` : ''}`;
  const res = await httpRequest('GET', RL_BASE, path, null, headers);
  if (Array.isArray(res)) return res;
  return res.templates ?? res.items ?? [];
}

// ─── RocketSign / Binders (document-manager v1) ────────────────────────────

function mapBinderStatus(status) {
  const s = String(status ?? '').toUpperCase();
  if (['COMPLETED', 'SIGNED', 'SIGNING_COMPLETE', 'SIGN_COMPLETED'].includes(s)) return 'completed';
  if (['SIGN_IN_PROGRESS', 'OUT_FOR_SIGNATURE', 'REVIEW_AND_SHARE'].includes(s)) return 'sent';
  if (['VOIDED', 'CANCELLED', 'BINDER_CANCELED'].includes(s)) return 'voided';
  if (['DECLINED', 'SIGNER_DECLINED_TO_SIGN'].includes(s)) return 'declined';
  if (['IN_PREPARATION', 'DRAFT'].includes(s)) return 'pending';
  return 'pending';
}

function binderDocumentSpec(signers) {
  const refs = signers.map((s, i) => ({
    reference: `signer_${i + 1}`,
    email: s.email,
  }));
  return [{
    name: 'Lease Agreement',
    order: 1,
    signable: true,
    inputs: refs.map(r => ({
      type: 'SIGNATURE_TEXT',
      partyReference: r.reference,
      position: { type: 'SIGNATURE_PAGE' },
    })),
  }];
}

function signerParties(signers, ownerEmail) {
  const parties = signers.map((s, i) => ({
    reference: `signer_${i + 1}`,
    email: s.email,
    legalName: s.name,
    jobTitle: s.role ?? 'Signer',
    roles: ['SIGNER'],
  }));

  if (ownerEmail && !parties.some(p => p.email?.toLowerCase() === ownerEmail.toLowerCase())) {
    parties.push({
      reference: 'owner',
      email: ownerEmail,
      jobTitle: 'Document Owner',
      roles: ['OWNER'],
    });
  }

  return parties;
}

async function createBinder({ name, signers, ownerEmail, documents }) {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const body = JSON.stringify({
    name,
    parties: signerParties(signers, ownerEmail),
    documents: documents ?? binderDocumentSpec(signers),
    configuration: { locale: { country: 'US', language: 'en' } },
  });

  const res = await httpRequest('POST', RL_BASE, RL_BINDER_PREFIX, body, headers);
  const binder = res.binder ?? res;
  const binderId = binder.id ?? res.id ?? res.binderId;
  if (!binderId) {
    throw Object.assign(new Error(`Binder create failed: ${JSON.stringify(res)}`), { statusCode: 502 });
  }

  const partyMap = (binder.parties ?? []).map(p => ({
    email: p.email,
    partyId: p.id,
    reference: p.reference,
    roles: p.roles,
  }));

  return {
    binderId,
    status: mapBinderStatus(binder.status ?? res.status),
    parties: partyMap,
    documents: binder.documents ?? [],
  };
}

async function getBinder(binderId) {
  const headers = await authHeaders();
  const path = `${RL_BINDER_PREFIX}/${encodeURIComponent(binderId)}`;
  return httpRequest('GET', RL_BASE, path, null, headers);
}

async function uploadBinderDocumentHtml(binderId, documentId, html) {
  const headers = await authHeaders({ 'Content-Type': 'text/html' });
  const path = `${RL_BINDER_PREFIX}/${encodeURIComponent(binderId)}/documents/${encodeURIComponent(documentId)}`;
  await httpRequest('PUT', RL_BASE, path, html, headers);
  return documentId;
}

async function finalizeBinder(binderId, { message, recipients = [] }) {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const path = `${RL_BINDER_PREFIX}/${encodeURIComponent(binderId)}/requests/finalisations`;
  const body = JSON.stringify({
    message: message ?? 'Please review and sign this document.',
    ...(recipients.length ? { recipients } : {}),
  });
  return httpRequest('POST', RL_BASE, path, body, headers);
}

async function sendBinderInvitations(binderId, { subject, message, recipients = [] }) {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const path = `${RL_BINDER_PREFIX}/${encodeURIComponent(binderId)}/requests/invitations`;
  const body = JSON.stringify({
    subject: subject ?? 'Document ready for signature',
    message: message ?? 'Please sign this document.',
    ...(recipients.length ? { recipients } : {}),
  });
  return httpRequest('POST', RL_BASE, path, body, headers);
}

function buildRecipients(parties, signers, returnBaseUrl) {
  return signers.map(s => {
    const party = parties.find(p => p.email?.toLowerCase() === s.email?.toLowerCase());
    const rec = {
      partyId: party?.partyId,
      emailUsed: s.email,
      notification: false,
    };
    if (returnBaseUrl) {
      rec.binderUrl = `${returnBaseUrl}/tenant/lease?signed=1`;
    }
    return rec;
  }).filter(r => r.partyId);
}

async function getEmbeddedSigningUrl(binderId, signerEmail) {
  const binder = await getBinder(binderId);
  const party = (binder.parties ?? []).find(p => p.email?.toLowerCase() === signerEmail.toLowerCase());
  if (party?.binderUrl) return party.binderUrl;

  const requests = binder.requests ?? [];
  for (const req of requests) {
    for (const rec of req.recipients ?? []) {
      if (rec.emailUsed?.toLowerCase() === signerEmail.toLowerCase() && rec.binderUrl) {
        return rec.binderUrl;
      }
    }
  }

  const returnUrl = `${process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'}/tenant/lease?signed=1`;
  const parties = (binder.parties ?? []).map(p => ({
    partyId: p.id,
    email: p.email,
  }));
  const signers = [{ email: signerEmail, name: party?.legalName ?? signerEmail, role: 'Signer' }];
  const recipients = buildRecipients(parties, signers, returnUrl);

  await sendBinderInvitations(binderId, {
    subject: binder.name ?? 'Lease Agreement',
    message: 'Please sign your lease.',
    recipients,
  });

  const refreshed = await getBinder(binderId);
  const refreshedParty = (refreshed.parties ?? []).find(p => p.email?.toLowerCase() === signerEmail.toLowerCase());
  return refreshedParty?.binderUrl ?? null;
}

// ─── Lease signature facade ───────────────────────────────────────────────────

async function sendLeaseForSignature({
  leaseId, documentId, documentUrl, documentHtml,
  documentName, signers, subject, message, ownerEmail,
}) {
  const binderResult = await createBinder({
    name: subject ?? documentName ?? 'Lease Agreement',
    signers,
    ownerEmail,
  });

  const { binderId, parties, documents } = binderResult;

  let binderDocumentId = documents[0]?.id;
  if (!binderDocumentId) {
    binderDocumentId = randomUUID();
  }

  const html = documentHtml
    ?? (documentUrl?.startsWith('http') ? await fetchText(documentUrl).catch(() => null) : null)
    ?? (documentId ? await fetchDocumentHtml(documentId).catch(() => null) : null);

  if (html) {
    await uploadBinderDocumentHtml(binderId, binderDocumentId, html);
  } else if (documentId) {
    await uploadBinderDocumentHtml(
      binderId,
      binderDocumentId,
      `<html><body><p>Lease document ${documentId}. Complete in Rocket Lawyer interview before signing.</p></body></html>`
    );
  } else {
    throw Object.assign(new Error('No document HTML available. Complete the Rocket Lawyer interview first.'), { statusCode: 400 });
  }

  const returnUrl = `${process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'}/tenant/lease?signed=1`;
  const recipients = buildRecipients(parties, signers, returnUrl);

  await finalizeBinder(binderId, { message, recipients });
  const inviteRes = await sendBinderInvitations(binderId, { subject, message, recipients });

  const inviteRecipients = inviteRes?.recipients ?? recipients;

  const { rows: envelopeRows } = await pool.query(
    `INSERT INTO signature_envelopes
       (lease_id, provider, provider_envelope_id, status, subject, message, sent_at)
     VALUES ($1, 'rocket_lawyer', $2, 'sent', $3, $4, NOW())
     RETURNING id`,
    [leaseId, binderId, subject, message ?? null]
  );
  const envelopeId = envelopeRows[0].id;

  for (const signer of signers) {
    const party = parties.find(p => p.email?.toLowerCase() === signer.email?.toLowerCase());
    const inviteRec = inviteRecipients.find(r =>
      r.emailUsed?.toLowerCase() === signer.email?.toLowerCase()
      || r.partyId === party?.partyId
    );

    await pool.query(
      `INSERT INTO envelope_signers
         (envelope_id, user_id, signer_role, email, name,
          routing_order, status, provider_signer_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7)`,
      [
        envelopeId,
        signer.userId ?? null,
        signer.role ?? 'Signer',
        signer.email,
        signer.name,
        signer.routingOrder ?? 1,
        party?.partyId ?? inviteRec?.partyId ?? null,
      ]
    );
  }

  await pool.query(
    `UPDATE leases SET status = 'pending_signature', updated_at = NOW() WHERE id = $1`,
    [leaseId]
  );

  return { envelopeId, providerEnvelopeId: binderId, binderId };
}

async function getSigningUrlForUser(leaseId, userId) {
  const { rows } = await pool.query(
    `SELECT se.provider_envelope_id, es.email, es.provider_signer_id
     FROM signature_envelopes se
     JOIN envelope_signers es ON es.envelope_id = se.id
     WHERE se.lease_id = $1
       AND es.user_id  = $2
       AND se.status   NOT IN ('completed', 'voided', 'declined')
       AND es.status   NOT IN ('signed', 'declined', 'voided')
     ORDER BY se.created_at DESC LIMIT 1`,
    [leaseId, userId]
  );

  if (!rows.length) return null;
  return getEmbeddedSigningUrl(rows[0].provider_envelope_id, rows[0].email);
}

// ─── Events API (pull subscriptions) ──────────────────────────────────────────

function eventsSubscriptionId() {
  return String(process.env.RL_EVENTS_SUBSCRIPTION_ID ?? '').trim();
}

async function getEventsSubscription(subscriptionId) {
  const headers = await authHeaders();
  const path = `${RL_EVENTS_PREFIX}/subscriptions/${encodeURIComponent(subscriptionId)}`;
  return httpRequest('GET', RL_BASE, path, null, headers, { allowEmpty: true });
}

async function createEventsSubscription() {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  return httpRequest('POST', RL_BASE, `${RL_EVENTS_PREFIX}/subscriptions`, '{}', headers);
}

async function pullEvents(subscriptionId, maxEvents = 20) {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const path = `${RL_EVENTS_PREFIX}/subscriptions/${encodeURIComponent(subscriptionId)}/eventPulls`;
  return httpRequest('POST', RL_BASE, path, JSON.stringify({ maxEvents: String(maxEvents) }), headers);
}

async function acknowledgeEvents(subscriptionId, eventHandles) {
  if (!eventHandles?.length) return null;
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const path = `${RL_EVENTS_PREFIX}/subscriptions/${encodeURIComponent(subscriptionId)}/eventAcknowledgements`;
  return httpRequest('POST', RL_BASE, path, JSON.stringify({ eventHandles }), headers);
}

function normalizeRlEvent(raw) {
  if (raw?.eventHandle && raw?.name) {
    return {
      event: raw.name,
      eventType: raw.name,
      eventUniqueId: raw.coreProperties?.eventUniqueId,
      data: raw.payload ?? {},
      payload: raw.payload ?? {},
      ...raw.payload,
      binderId: raw.payload?.binderId ?? raw.payload?.binder?.id,
      status: raw.payload?.status ?? raw.payload?.binderStatus ?? raw.name,
    };
  }
  return raw;
}

function isBinderCompletedEvent(eventType, payload = {}) {
  const name = String(eventType ?? '').toUpperCase();
  if (['BINDER_SIGN_COMPLETED', 'SIGN_COMPLETED', 'BINDER.SIGN.COMPLETED'].includes(name)) return true;
  if (name.includes('sign') && name.includes('complet')) return true;
  const status = String(payload.status ?? payload.binderStatus ?? '').toUpperCase();
  return status === 'SIGN_COMPLETED';
}

async function ensureEventsSubscription() {
  if (!String(process.env.RL_WEBHOOK_URL ?? '').trim()) {
    return { enabled: false, reason: 'RL_WEBHOOK_URL not set' };
  }

  const existing = eventsSubscriptionId();
  if (existing) {
    try {
      const sub = await getEventsSubscription(existing);
      if (sub?.subscriptionId) return { enabled: true, subscriptionId: sub.subscriptionId, created: false };
    } catch (err) {
      if (err.statusCode !== 204 && err.statusCode !== 404) throw err;
      console.warn('[rocket-lawyer] Stored RL_EVENTS_SUBSCRIPTION_ID invalid — creating new subscription');
    }
  }

  const created = await createEventsSubscription();
  const subscriptionId = created.subscriptionId;
  if (!subscriptionId) {
    throw Object.assign(new Error('Events subscription create returned no subscriptionId'), { statusCode: 502 });
  }
  console.log(`[rocket-lawyer] Created Events subscription ${subscriptionId}. Save RL_EVENTS_SUBSCRIPTION_ID=${subscriptionId} in .env.local`);
  return { enabled: true, subscriptionId, created: true };
}

async function pullAndProcessEvents({ maxEvents = 20 } = {}) {
  let subscriptionId = eventsSubscriptionId();
  if (!subscriptionId) {
    const ensured = await ensureEventsSubscription().catch(err => ({ enabled: false, error: err.message }));
    if (!ensured.enabled || !ensured.subscriptionId) {
      return { processed: 0, skipped: true, reason: ensured.reason ?? ensured.error ?? 'no subscription' };
    }
    subscriptionId = ensured.subscriptionId;
  }

  const pull = await pullEvents(subscriptionId, maxEvents);
  const events = pull.events ?? [];
  const handles = [];

  for (const evt of events) {
    try {
      await processWebhookEvent(normalizeRlEvent(evt));
    } catch (err) {
      console.error('[rocket-lawyer events] process error:', err.message);
    }
    if (evt.eventHandle) handles.push(evt.eventHandle);
  }

  if (handles.length) {
    await acknowledgeEvents(subscriptionId, handles).catch(err => {
      console.warn('[rocket-lawyer events] acknowledge failed:', err.message);
    });
  }

  return { processed: events.length, subscriptionId, eventPullId: pull.eventPullId };
}

function startEventsPoller() {
  if (_eventsPoller) return;
  if (!String(process.env.RL_WEBHOOK_URL ?? '').trim()) return;

  const intervalMs = Number(process.env.RL_POLL_EVENTS_MS ?? 60_000);
  _eventsPoller = setInterval(() => {
    pullAndProcessEvents().catch(err => {
      console.warn('[rocket-lawyer events] poll failed:', err.message);
    });
  }, intervalMs);
  if (_eventsPoller.unref) _eventsPoller.unref();

  pullAndProcessEvents().catch(err => {
    console.warn('[rocket-lawyer events] initial poll failed:', err.message);
  });
}

// ─── Webhooks / event processing ──────────────────────────────────────────────

async function processWebhookEvent(payload) {
  const normalized = normalizeRlEvent(payload);
  const eventType = normalized?.event ?? normalized?.eventType ?? normalized?.type ?? payload?.name;
  if (!eventType) return;

  console.log(`[rocket-lawyer webhook] event=${eventType}`);

  const interviewComplete = ['interview.completed', 'INTERVIEW_COMPLETED', 'interview-completed'];
  if (interviewComplete.includes(String(eventType).toLowerCase())
      || String(eventType).toUpperCase() === 'INTERVIEW_COMPLETED') {
    const interviewId = normalized?.data?.interviewId ?? normalized?.interviewId ?? payload?.payload?.interviewId;
    const docId = normalized?.data?.documentId ?? normalized?.documentId ?? payload?.payload?.documentId;
    if (interviewId || docId) {
      await pool.query(
        `UPDATE leases
            SET rl_document_id = COALESCE($1, rl_document_id),
                document_url = COALESCE($2, document_url),
                updated_at = NOW()
          WHERE rl_document_id = $3 OR rl_document_id = $4`,
        [docId, docId ? `rl-doc-${docId}` : null, interviewId, docId]
      ).catch(() => {});
    }
    return;
  }

  if (String(eventType).toUpperCase() === 'DOCUMENT.COMPLETED' || eventType === 'document.completed') {
    const docId = normalized?.data?.documentId ?? normalized?.documentId ?? payload?.payload?.documentId;
    const pdfUrl = normalized?.data?.pdfUrl ?? normalized?.pdfUrl;
    if (docId) {
      await pool.query(
        `UPDATE leases
            SET document_url = COALESCE($1, document_url),
                rl_document_id = COALESCE(rl_document_id, $2),
                updated_at = NOW()
          WHERE rl_document_id = $2 OR document_url = $3 OR document_url LIKE $4`,
        [pdfUrl, docId, `rl-doc-${docId}`, `rl-doc-${docId}%`]
      ).catch(() => {});
    }
    return;
  }

  const binderId = normalized?.data?.binderId ?? normalized?.binderId ?? normalized?.data?.binder?.id
    ?? payload?.payload?.binderId;
  if (!binderId) return;

  const rawStatus = normalized?.data?.status ?? normalized?.status ?? eventType;
  const newStatus = isBinderCompletedEvent(eventType, normalized?.data ?? normalized)
    ? 'completed'
    : mapBinderStatus(rawStatus);

  const { rows } = await pool.query(
    `SELECT id, lease_id FROM signature_envelopes WHERE provider_envelope_id = $1`,
    [binderId]
  );
  if (!rows.length) {
    console.warn(`[rocket-lawyer] Unknown binder: ${binderId}`);
    return;
  }

  const { id: envelopeId, lease_id: leaseId } = rows[0];

  await pool.query(
    `UPDATE signature_envelopes
        SET status = $1,
            completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
            voided_at    = CASE WHEN $1 = 'voided'    THEN NOW() ELSE voided_at    END,
            raw_webhook_payload = $3,
            updated_at = NOW()
      WHERE id = $2`,
    [newStatus, envelopeId, JSON.stringify(payload)]
  );

  const signerEmail = normalized?.data?.signer?.email ?? normalized?.data?.party?.email
    ?? normalized?.signerEmail ?? payload?.payload?.partyEmail;
  if (signerEmail && ['sent', 'delivered', 'completed'].includes(newStatus)) {
    await pool.query(
      `UPDATE envelope_signers
          SET status = CASE WHEN $3 = 'completed' THEN 'signed' ELSE 'sent' END,
              signed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE signed_at END,
              updated_at = NOW()
        WHERE envelope_id = $1 AND email = $2`,
      [envelopeId, signerEmail, newStatus]
    );
  }

  if (newStatus === 'completed') {
    await pool.query(
      `UPDATE envelope_signers SET status = 'signed', signed_at = NOW() WHERE envelope_id = $1`,
      [envelopeId]
    );
    await pool.query(
      `UPDATE leases SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [leaseId]
    );

    const { rows: tenantRows } = await pool.query(`SELECT tenant_id FROM leases WHERE id = $1`, [leaseId]);
    if (tenantRows.length) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, channel, action_url)
         VALUES ($1, 'lease_signed', 'Lease Fully Signed',
                 'Your lease has been fully executed and is now active. Welcome home!',
                 'in_app', '/tenant/lease')`,
        [tenantRows[0].tenant_id]
      ).catch(() => {});
    }
    await ensureLeaseSigningFee(leaseId, { signedAt: new Date() }).catch((err) => {
      console.warn('[rocket-lawyer] lease signing fee:', err.message);
    });
    console.log(`[rocket-lawyer] Binder ${binderId} completed → lease ${leaseId} activated`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function parseHost(baseUrl) {
  const u = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
  return { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), protocol: u.protocol };
}

function httpRequest(method, baseUrl, path, body, headers, requestOpts = {}) {
  const { returnMeta = false, raw = false, allowEmpty = false } = requestOpts;
  return new Promise((resolve, reject) => {
    const { hostname, port, protocol } = parseHost(baseUrl);
    const lib = protocol === 'http:' ? http : https;

    const reqOpts = {
      hostname,
      port,
      path,
      method,
      headers: {
        ...headers,
        ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };

    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 204 && allowEmpty) {
          resolve(returnMeta ? { body: null, statusCode: 204, headers: res.headers } : null);
          return;
        }
        if (!data) {
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`RL API ${res.statusCode}`), { statusCode: res.statusCode }));
          } else {
            resolve(returnMeta ? { body: {}, statusCode: res.statusCode, headers: res.headers } : {});
          }
          return;
        }
        if (raw) {
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`RL API ${res.statusCode}: ${data.slice(0, 200)}`), { statusCode: res.statusCode }));
            return;
          }
          resolve(data);
          return;
        }
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode >= 400) {
          reject(Object.assign(
            new Error(`RL API ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`),
            { statusCode: res.statusCode, body: parsed }
          ));
          return;
        }
        if (returnMeta) {
          resolve({ body: parsed, statusCode: res.statusCode, headers: res.headers });
        } else {
          resolve(parsed);
        }
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    lib.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`Fetch ${res.statusCode}`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    }).on('error', reject);
  });
}

/**
 * Health check for manager UI — safe to call before Docs/Sign APIs are approved.
 */
async function checkConnection() {
  const key = apiKey();
  const secret = apiSecret();
  const baseUrl = RL_BASE;
  const status = {
    configured: Boolean(key && secret),
    templateConfigured: templateConfigured(),
    baseUrl,
    auth: 'unknown',
    authMessage: null,
    apiProducts: [],
    products: {
      auth: null,
      rocketDocument: null,
      binders: null,
      events: null,
    },
    rocketDocument: 'pending_approval',
    rocketSign: 'pending_approval',
    events: 'not_configured',
    webhookConfigured: Boolean(String(process.env.RL_WEBHOOK_URL ?? '').trim()),
    eventsSubscriptionId: eventsSubscriptionId() || null,
    nextSteps: [],
  };

  if (!status.configured) {
    status.auth = 'missing_credentials';
    status.authMessage = 'Add RL_API_KEY and RL_API_SECRET to .env.local';
    status.nextSteps.push('Copy App Key and App Secret from developer.rocketlawyer.com → your app.');
    return status;
  }

  if (!status.templateConfigured) {
    status.nextSteps.push('Set RL_LEASE_TEMPLATE_ID in .env.local (GET /rocketdoc/v2/templates after approval).');
  }

  try {
    await getAccessToken();
    status.auth = 'ok';
    status.authMessage = 'Access token obtained.';
    status.apiProducts = getCachedApiProducts();
    status.products.auth = productEnabled(['partner-auth', 'auth']) ?? true;
    status.products.rocketDocument = productEnabled(['rocketdoc']);
    status.products.binders = productEnabled(['binders', 'document-manager']);
    status.products.events = productEnabled(['event']);
  } catch (err) {
    status.auth = err.code === 'RL_APP_PENDING' ? 'app_pending' : 'failed';
    status.authMessage = err.message;
    if (status.auth === 'app_pending') {
      status.nextSteps.push('Wait for app approval, then email api@rocketlawyer.com if it stays blocked.');
    } else {
      status.nextSteps.push('Verify RL_API_KEY / RL_API_SECRET match the sandbox app exactly (no trailing spaces).');
    }
    status.nextSteps.push('RocketDocument v2 and RocketSign must show Enabled (not Pending) before Create in Rocket Lawyer works.');
    return status;
  }

  if (status.products.rocketDocument === false) {
    status.nextSteps.push('Auth token lacks rocketdoc-api product — enable RocketDocument v2 in the developer portal.');
  }
  if (status.products.binders === false) {
    status.nextSteps.push('Auth token lacks binders/document-manager product — enable RocketSign in the developer portal.');
  }

  try {
    await listTemplates({ pageSize: 1 });
    status.rocketDocument = 'ok';
    if (status.templateConfigured) {
      const templates = await listTemplates({ pageSize: 50 });
      const match = templates.find(t =>
        String(t.templateId).toLowerCase() === String(process.env.RL_LEASE_TEMPLATE_ID).toLowerCase()
      );
      status.templateFound = Boolean(match);
      if (!match && templates.length) {
        status.nextSteps.push('RL_LEASE_TEMPLATE_ID not in first page of templates — verify UUID from GET /rocketdoc/v2/templates.');
      }
    }
  } catch (err) {
    status.rocketDocument = err.statusCode === 403 || err.statusCode === 401 ? 'pending_approval' : 'error';
    if (status.rocketDocument === 'pending_approval') {
      status.nextSteps.push('Enable RocketDocument v2 API in the developer portal (currently pending approval).');
    }
  }

  try {
    await httpRequest('GET', RL_BASE, `${RL_BINDER_PREFIX}?pageSize=1`, null, await authHeaders());
    status.rocketSign = 'ok';
  } catch (err) {
    status.rocketSign = err.statusCode === 403 || err.statusCode === 401 ? 'pending_approval' : 'error';
    if (status.rocketSign === 'pending_approval') {
      status.nextSteps.push('Enable RocketSign & Binders API in the developer portal (currently pending approval).');
    }
  }

  if (status.webhookConfigured) {
    try {
      if (status.eventsSubscriptionId) {
        const sub = await getEventsSubscription(status.eventsSubscriptionId);
        status.events = sub?.subscriptionId ? 'ok' : 'missing';
      } else {
        status.events = 'needs_subscription';
        status.nextSteps.push('Run npm run rocketlawyer:probe to create Events subscription; save RL_EVENTS_SUBSCRIPTION_ID.');
      }
    } catch (err) {
      status.events = err.statusCode === 403 ? 'pending_approval' : 'error';
      if (status.events === 'pending_approval') {
        status.nextSteps.push('Enable Partner Events API in the developer portal.');
      }
    }
  } else {
    status.nextSteps.push('Set RL_WEBHOOK_URL (public app URL) to enable Events API polling for signed-lease activation.');
  }

  if (status.rocketDocument === 'ok' && status.rocketSign === 'ok' && status.templateConfigured) {
    status.nextSteps.push('Open a lease → Create in Rocket Lawyer → Send via Rocket Lawyer.');
  }

  return status;
}

module.exports = {
  createDocument,
  createInterview,
  getInterview,
  getDocument,
  fetchDocumentHtml,
  listTemplates,
  createServiceToken,
  createBinder,
  getBinder,
  uploadBinderDocumentHtml,
  finalizeBinder,
  sendBinderInvitations,
  getEmbeddedSigningUrl,
  sendLeaseForSignature,
  getSigningUrlForUser,
  processWebhookEvent,
  normalizeRlEvent,
  pullAndProcessEvents,
  ensureEventsSubscription,
  startEventsPoller,
  mapBinderStatus,
  mapInterviewStatus,
  checkConnection,
};
