/**
 * Manager boots-on-site visits — inspection scope, 24h tenant notice, multi-photo proof.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db/client');
const {
  parseNorfolkLocal,
  formatNorfolkDateTime,
  isAtLeast24HoursAhead,
  isWithinCheckInWindow,
  minPlannedVisitLocalString,
  norfolkNowLocalString,
} = require('../utils/norfolk-time');
const { loadInspectionAreas, normalizeCommonAreas } = require('./site-visits-catalog');
const {
  ROOM_PURPOSE,
  sendCommonAreaVisitAnnouncement,
  sendApprovedVisitNotices,
  sendCompletedVisitNotices,
  sendCancellationNotices,
  previewTenantsToNotify,
  previewCommonAreaAnnouncement,
  loadPropertyTenants,
} = require('./site-visits-notify.service');

const VISIT_AMOUNT_CENTS = 2000;
const MONTHLY_CAP_CENTS = 10000;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MIN_VIDEO_BYTES = 50 * 1024;
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/site-visits');

function monthWindow(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

async function resolveOrgIdForUser(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
     ) AS org_id`,
    [userId]
  );
  return rows[0]?.org_id ?? null;
}

async function getDefaultPropertyId(orgId) {
  const { rows } = await pool.query(
    `SELECT id FROM properties WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [orgId]
  );
  return rows[0]?.id ?? null;
}

async function getMonthlyUsage(orgId, db = pool) {
  const { start, end } = monthWindow();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS reserved_count,
            COALESCE(SUM(amount_cents), 0)::int AS reserved_cents
       FROM manager_site_visits
      WHERE org_id = $1
        AND status IN ('approved', 'completed')
        AND (
          (status = 'completed' AND visited_at >= $2 AND visited_at < $3)
          OR (status = 'approved' AND approved_at >= $2 AND approved_at < $3)
        )`,
    [orgId, start, end]
  );
  const reserved_cents = rows[0]?.reserved_cents ?? 0;
  const reserved_count = rows[0]?.reserved_count ?? 0;
  return {
    month: start.toISOString().slice(0, 7),
    reserved_cents,
    reserved_count,
    cap_cents: MONTHLY_CAP_CENTS,
    visit_amount_cents: VISIT_AMOUNT_CENTS,
    remaining_cents: Math.max(0, MONTHLY_CAP_CENTS - reserved_cents),
    visits_remaining: Math.max(0, Math.floor((MONTHLY_CAP_CENTS - reserved_cents) / VISIT_AMOUNT_CENTS)),
    at_cap: reserved_cents >= MONTHLY_CAP_CENTS,
  };
}

async function loadVisitTargets(visitId) {
  const { rows } = await pool.query(
    `SELECT t.unit_id, t.room_label, t.tenant_id, t.room_purpose,
            u.first_name, u.last_name, u.email AS tenant_email
       FROM site_visit_room_targets t
       LEFT JOIN users u ON u.id = t.tenant_id
      WHERE t.visit_id = $1
      ORDER BY t.room_label`,
    [visitId]
  );
  return rows.map((r) => ({
    unitId: r.unit_id,
    roomLabel: r.room_label,
    tenantId: r.tenant_id,
    tenantName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
    tenantEmail: r.tenant_email,
    occupied: !!r.tenant_id,
    roomPurpose: r.room_purpose || ROOM_PURPOSE.ROUTINE,
  }));
}

async function loadVisitPhotos(visitId) {
  const { rows } = await pool.query(
    `SELECT id, area_type, area_key, unit_id, photo_path, photo_mime, media_type, uploaded_at
       FROM site_visit_photos WHERE visit_id = $1 ORDER BY uploaded_at`,
    [visitId]
  );
  return rows.map((r) => {
    const mime = r.photo_mime || '';
    const isVideo = r.media_type === 'video' || mime.startsWith('video/');
    return {
      id: r.id,
      areaType: r.area_type,
      areaKey: r.area_key,
      unitId: r.unit_id,
      mediaType: isVideo ? 'video' : 'photo',
      photoUrl: `/uploads/site-visits/${visitId}/${path.basename(r.photo_path)}`,
      uploadedAt: r.uploaded_at,
    };
  });
}

async function loadVisitNotices(visitId) {
  const { rows } = await pool.query(
    `SELECT tenant_id, room_labels, channel, planned_visit_at, sent_at, cancelled_at
       FROM site_visit_tenant_notices
      WHERE visit_id = $1 AND channel = 'inbox'
      ORDER BY sent_at`,
    [visitId]
  );
  return rows;
}

function buildVisitWhen(row) {
  if (row.visited_at) {
    return { label: 'Occurred', at: formatNorfolkDateTime(row.visited_at) };
  }
  if (row.planned_visit_at) {
    let label = 'Scheduled for';
    if (row.status === 'pending_approval') label = 'Requested for';
    else if (row.status === 'cancelled' || row.status === 'rejected') label = 'Was scheduled for';
    return { label, at: formatNorfolkDateTime(row.planned_visit_at) };
  }
  if (row.status === 'approved') {
    return { label: 'Scheduled for', at: 'Same day — check in when on site' };
  }
  if (row.status === 'pending_approval') {
    return { label: 'Requested for', at: 'Date/time not set' };
  }
  return null;
}

function visitRowToJson(row, extras = {}) {
  if (!row) return null;
  const legacyPhoto = row.photo_path
    ? `/uploads/site-visits/${path.basename(row.photo_path)}`
    : null;
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    managerId: row.manager_id,
    managerName: row.manager_name,
    managerEmail: row.manager_email,
    status: row.status,
    requestedNote: row.requested_note,
    plannedVisitAt: row.planned_visit_at,
    plannedVisitAtFormatted: row.planned_visit_at
      ? formatNorfolkDateTime(row.planned_visit_at)
      : null,
    visitedAtFormatted: row.visited_at ? formatNorfolkDateTime(row.visited_at) : null,
    visitWhen: buildVisitWhen(row),
    scopeCommon: normalizeCommonAreas(row.scope_common),
    roomTargets: extras.roomTargets || [],
    photos: extras.photos || [],
    notices: extras.notices || [],
    approvedBy: row.approved_by,
    approverName: row.approver_name,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectorName: row.rejector_name,
    rejectedAt: row.rejected_at,
    rejectionNote: row.rejection_note,
    visitedAt: row.visited_at,
    photoUrl: legacyPhoto,
    amountCents: row.amount_cents,
    amountDollars: row.amount_cents / 100,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tenantsToNotify: extras.tenantsToNotify || [],
    commonAreaAnnouncement: extras.commonAreaAnnouncement || null,
  };
}

const LIST_SELECT = `
  SELECT v.*,
         TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS manager_name,
         m.email AS manager_email,
         TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS approver_name,
         TRIM(CONCAT(r.first_name, ' ', r.last_name)) AS rejector_name
    FROM manager_site_visits v
    JOIN users m ON m.id = v.manager_id
    LEFT JOIN users a ON a.id = v.approved_by
    LEFT JOIN users r ON r.id = v.rejected_by
`;

async function hydrateVisit(row) {
  if (!row) return null;
  const roomTargets = await loadVisitTargets(row.id);
  const photos = await loadVisitPhotos(row.id);
  const notices = row.status !== 'pending_approval' ? await loadVisitNotices(row.id) : [];
  const propertyTenants = row.property_id
    ? await loadPropertyTenants(row.property_id)
    : [];
  const tenantsToNotify = previewTenantsToNotify(roomTargets, propertyTenants);
  const commonAreaAnnouncement = previewCommonAreaAnnouncement(
    normalizeCommonAreas(row.scope_common),
    row.planned_visit_at
  );
  return visitRowToJson(row, {
    roomTargets,
    photos,
    notices,
    tenantsToNotify,
    commonAreaAnnouncement,
  });
}

async function listVisits({ orgId, managerId, limit = 50 }) {
  const params = [orgId];
  let where = 'v.org_id = $1';
  if (managerId) {
    params.push(managerId);
    where += ` AND v.manager_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `${LIST_SELECT} WHERE ${where} ORDER BY v.created_at DESC LIMIT $${params.length}`,
    params
  );
  const out = [];
  for (const row of rows) {
    out.push(await hydrateVisit(row));
  }
  return out;
}

async function getVisit(id, orgId) {
  const { rows } = await pool.query(
    `${LIST_SELECT} WHERE v.id = $1 AND v.org_id = $2`,
    [id, orgId]
  );
  return hydrateVisit(rows[0]);
}

function assertCanReserve(capUsage) {
  if (capUsage.reserved_cents + VISIT_AMOUNT_CENTS > MONTHLY_CAP_CENTS) {
    const err = new Error(
      `Approving this visit would exceed the $${MONTHLY_CAP_CENTS / 100}/month limit.`
    );
    err.code = 'MONTHLY_CAP';
    err.statusCode = 409;
    throw err;
  }
}

function defaultPurpose(room) {
  return room.occupied ? ROOM_PURPOSE.ROUTINE : ROOM_PURPOSE.VACANT_SHOWING;
}

function normalizeRoomPurpose(room, purpose) {
  const p = purpose || defaultPurpose(room);
  if (!room.occupied) {
    if (p === ROOM_PURPOSE.MAINTENANCE) {
      const err = new Error(`Maintenance follow-up cannot be scheduled for vacant room ${room.label}.`);
      err.statusCode = 400;
      throw err;
    }
    return ROOM_PURPOSE.VACANT_SHOWING;
  }
  if (p === ROOM_PURPOSE.VACANT_SHOWING) {
    const err = new Error(`Vacant showing purpose cannot be used for occupied room ${room.label}.`);
    err.statusCode = 400;
    throw err;
  }
  return p === ROOM_PURPOSE.MAINTENANCE ? ROOM_PURPOSE.MAINTENANCE : ROOM_PURPOSE.ROUTINE;
}

async function validateScope({ orgId, propertyId, commonAreas, unitIds, roomSelections }) {
  const catalog = await loadInspectionAreas(orgId, propertyId);
  const common = normalizeCommonAreas(commonAreas);
  const purposeByUnit = new Map();
  if (Array.isArray(roomSelections)) {
    for (const sel of roomSelections) {
      if (sel?.unitId) purposeByUnit.set(sel.unitId, sel.purpose);
    }
  }
  const unitSet = new Set(catalog.rooms.map((r) => r.unitId));
  const units = [...new Set((unitIds || []).filter((id) => unitSet.has(id)))];
  const roomRows = catalog.rooms
    .filter((r) => units.includes(r.unitId))
    .map((r) => ({
      ...r,
      purpose: normalizeRoomPurpose(r, purposeByUnit.get(r.unitId)),
    }));
  return { common, roomRows, catalog };
}

/** 24h notice applies to occupied-room inspections only — not vacant showings. */
function visitNeeds24hNotice(roomRows) {
  return (roomRows || []).some(
    (r) =>
      r.occupied
      && (r.purpose === ROOM_PURPOSE.ROUTINE || r.purpose === ROOM_PURPOSE.MAINTENANCE)
  );
}

function roomTargetsNeed24h(roomTargets) {
  return visitNeeds24hNotice(
    (roomTargets || []).map((t) => ({
      occupied: !!t.tenantId,
      purpose: t.roomPurpose || ROOM_PURPOSE.ROUTINE,
    }))
  );
}

async function insertRoomTargets(client, visitId, roomRows) {
  for (const room of roomRows) {
    await client.query(
      `INSERT INTO site_visit_room_targets (visit_id, unit_id, room_label, tenant_id, room_purpose)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (visit_id, unit_id) DO UPDATE
         SET room_label = EXCLUDED.room_label,
             tenant_id = EXCLUDED.tenant_id,
             room_purpose = EXCLUDED.room_purpose`,
      [visitId, room.unitId, room.label, room.tenantId || null, room.purpose]
    );
  }
}

async function requestVisit({
  managerId,
  note,
  plannedVisitAt,
  commonAreas,
  unitIds,
  roomSelections,
}) {
  const orgId = await resolveOrgIdForUser(managerId);
  if (!orgId) {
    const err = new Error('Manager is not linked to an organization.');
    err.statusCode = 400;
    throw err;
  }

  const propertyId = await getDefaultPropertyId(orgId);
  const { common, roomRows } = await validateScope({
    orgId,
    propertyId,
    commonAreas,
    unitIds,
    roomSelections,
  });

  const needs24h = visitNeeds24hNotice(roomRows);

  if (!plannedVisitAt) {
    const err = new Error('Planned visit date and time are required before owner approval.');
    err.statusCode = 400;
    throw err;
  }

  const planned = parseNorfolkLocal(plannedVisitAt);
  if (!planned) {
    const err = new Error('Invalid planned visit date/time.');
    err.statusCode = 400;
    throw err;
  }

  if (needs24h && !isAtLeast24HoursAhead(planned)) {
    const err = new Error(
      `Occupied-room visits require at least 24 hours notice (Norfolk time). Earliest: ${formatNorfolkDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))}.`
    );
    err.code = 'NOTICE_24H';
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO manager_site_visits
         (org_id, property_id, manager_id, requested_note, planned_visit_at, scope_common)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [orgId, propertyId, managerId, note?.trim() || null, planned, JSON.stringify(common)]
    );
    const visitId = rows[0].id;
    await insertRoomTargets(client, visitId, roomRows);
    await client.query('COMMIT');
    const visit = await getVisit(visitId, orgId);
    const { alertSiteVisitPendingApproval } = require('./ops-alert.service');
    alertSiteVisitPendingApproval(visit).catch((err) => {
      console.warn('[site-visits] pending-approval alert:', err.message);
    });
    return visit;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function loadRoomTargetsForNotify(visitId) {
  const { rows } = await pool.query(
    `SELECT t.unit_id, t.room_label, t.tenant_id, t.room_purpose,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM site_visit_room_targets t
       LEFT JOIN users u ON u.id = t.tenant_id
      WHERE t.visit_id = $1`,
    [visitId]
  );
  return rows.map((r) => ({
    unitId: r.unit_id,
    roomLabel: r.room_label,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    tenantEmail: r.tenant_email,
    roomPurpose: r.room_purpose || ROOM_PURPOSE.ROUTINE,
  }));
}

async function approveVisit({ visitId, ownerId }) {
  const orgId = await resolveOrgIdForUser(ownerId);
  const visit = await getVisit(visitId, orgId);
  if (!visit) {
    const err = new Error('Visit not found.');
    err.statusCode = 404;
    throw err;
  }
  if (visit.status !== 'pending_approval') {
    const err = new Error(`Visit is ${visit.status}, not pending approval.`);
    err.statusCode = 409;
    throw err;
  }

  const usage = await getMonthlyUsage(orgId);
  assertCanReserve(usage);

  const hasRooms = visit.roomTargets.length > 0;
  const needs24h = roomTargetsNeed24h(visit.roomTargets);
  let planned = visit.plannedVisitAt ? new Date(visit.plannedVisitAt) : null;

  // 24h notice is enforced when the manager submits the request, not when the owner approves.
  if (!planned) {
    const err = new Error(
      needs24h
        ? 'Planned visit time is missing for occupied-room inspection.'
        : 'Planned visit time is missing on this request.'
    );
    err.statusCode = 400;
    throw err;
  }

  await pool.query(
    `UPDATE manager_site_visits
        SET status = 'approved',
            approved_by = $1,
            approved_at = NOW(),
            planned_visit_at = COALESCE(planned_visit_at, $3),
            updated_at = NOW()
      WHERE id = $2`,
    [ownerId, visitId, planned]
  );

  await sendCommonAreaVisitAnnouncement({
    visitId,
    orgId,
    propertyId: visit.propertyId,
    senderId: ownerId,
    plannedVisitAt: planned,
    scopeCommon: visit.scopeCommon,
    event: 'scheduled',
  });

  if (hasRooms) {
    const roomTargets = await loadRoomTargetsForNotify(visitId);
    await sendApprovedVisitNotices({
      visitId,
      propertyId: visit.propertyId,
      managerId: visit.managerId,
      plannedVisitAt: planned,
      roomTargets,
    });
  }

  return getVisit(visitId, orgId);
}

async function rejectVisit({ visitId, ownerId, note }) {
  const orgId = await resolveOrgIdForUser(ownerId);
  const visit = await getVisit(visitId, orgId);
  if (!visit) {
    const err = new Error('Visit not found.');
    err.statusCode = 404;
    throw err;
  }
  if (visit.status !== 'pending_approval') {
    const err = new Error(`Visit is ${visit.status}, not pending approval.`);
    err.statusCode = 409;
    throw err;
  }

  await pool.query(
    `UPDATE manager_site_visits
        SET status = 'rejected',
            rejected_by = $1,
            rejected_at = NOW(),
            rejection_note = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [ownerId, note?.trim() || null, visitId]
  );
  return getVisit(visitId, orgId);
}

async function cancelVisit({ visitId, actorId, actorRole }) {
  const orgId = await resolveOrgIdForUser(actorId);
  const visit = await getVisit(visitId, orgId);
  if (!visit) {
    const err = new Error('Visit not found.');
    err.statusCode = 404;
    throw err;
  }

  const isOwner = actorRole === 'owner' || actorRole === 'super_admin';
  if (!isOwner && visit.managerId !== actorId) {
    const err = new Error('You can only cancel your own visit requests.');
    err.statusCode = 403;
    throw err;
  }
  if (!['pending_approval', 'approved'].includes(visit.status)) {
    const err = new Error(`Cannot cancel a visit that is ${visit.status}.`);
    err.statusCode = 409;
    throw err;
  }

  const wasApproved = visit.status === 'approved';

  await pool.query(
    `UPDATE manager_site_visits
        SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1`,
    [visitId]
  );

  if (wasApproved) {
    await sendCommonAreaVisitAnnouncement({
      visitId,
      orgId,
      propertyId: visit.propertyId,
      senderId: actorId,
      plannedVisitAt: visit.plannedVisitAt,
      scopeCommon: visit.scopeCommon,
      event: 'cancelled',
    });
    if (visit.roomTargets.length > 0) {
      await sendCancellationNotices({
        visitId,
        managerId: visit.managerId,
        plannedVisitAt: visit.plannedVisitAt,
      });
    }
  }

  return getVisit(visitId, orgId);
}

const VIDEO_MIME_RE = /^data:(video\/(?:mp4|webm|quicktime|3gpp|x-m4v));base64,(.+)$/i;

function parseVideoPayload(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    const err = new Error('Video proof is required for each area.');
    err.statusCode = 400;
    throw err;
  }
  const match = dataUrl.match(VIDEO_MIME_RE);
  if (!match) {
    const err = new Error('Each area needs a short video (MP4, WebM, or MOV — use your phone camera).');
    err.statusCode = 400;
    throw err;
  }
  const mime = match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > MAX_VIDEO_BYTES) {
    const err = new Error('Video is too large (max 25 MB per area — keep clips under ~30 seconds).');
    err.statusCode = 400;
    throw err;
  }
  if (buf.length < MIN_VIDEO_BYTES) {
    const err = new Error('Video file looks too small — record a few seconds of the area.');
    err.statusCode = 400;
    throw err;
  }
  let ext = 'mp4';
  if (mime.includes('webm')) ext = 'webm';
  else if (mime.includes('quicktime')) ext = 'mov';
  else if (mime.includes('3gpp')) ext = '3gp';
  return { mime, buf, ext, mediaType: 'video' };
}

function saveAreaMedia(visitId, areaSlug, { buf, ext }) {
  const dir = path.join(UPLOAD_DIR, visitId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${areaSlug}.${ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buf);
  return fullPath;
}

function slugForPhoto(item) {
  if (item.areaType === 'common') return `common-${item.areaKey}`;
  return `room-${item.unitId}`;
}

async function completeVisit({ visitId, managerId, photos }) {
  const orgId = await resolveOrgIdForUser(managerId);
  const visit = await getVisit(visitId, orgId);
  if (!visit) {
    const err = new Error('Visit not found.');
    err.statusCode = 404;
    throw err;
  }
  if (visit.managerId !== managerId) {
    const err = new Error('You can only complete your own approved visits.');
    err.statusCode = 403;
    throw err;
  }
  if (visit.status !== 'approved') {
    const err = new Error('Owner must approve this visit before check-in.');
    err.statusCode = 409;
    throw err;
  }

  const now = new Date();
  const hasRooms = visit.roomTargets.length > 0;
  const needs24h = roomTargetsNeed24h(visit.roomTargets);
  const planned = visit.plannedVisitAt ? new Date(visit.plannedVisitAt) : null;

  if (needs24h && planned) {
    if (!isWithinCheckInWindow(planned, now)) {
      const err = new Error(
        `Check-in opens 30 minutes before the scheduled time on inspection day (${visit.plannedVisitAtFormatted || 'see planned time'}).`
      );
      err.code = 'CHECKIN_WINDOW';
      err.statusCode = 409;
      throw err;
    }
  }

  const required = [];
  for (const key of visit.scopeCommon || []) {
    required.push({ areaType: 'common', areaKey: key, unitId: null });
  }
  for (const room of visit.roomTargets) {
    required.push({ areaType: 'tenant_room', areaKey: null, unitId: room.unitId });
  }

  if (!Array.isArray(photos) || !photos.length) {
    const err = new Error('Upload a video for each required area (3 common areas always, plus any rooms).');
    err.statusCode = 400;
    throw err;
  }

  const mediaMap = new Map();
  for (const p of photos) {
    const slug = slugForPhoto(p);
    mediaMap.set(slug, p);
  }

  for (const req of required) {
    const slug = slugForPhoto(req);
    if (!mediaMap.has(slug)) {
      const label = req.areaType === 'common'
        ? req.areaKey
        : visit.roomTargets.find((r) => r.unitId === req.unitId)?.roomLabel || 'room';
      const err = new Error(`Missing video for: ${label}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const req of required) {
      const slug = slugForPhoto(req);
      const payload = mediaMap.get(slug);
      const dataUrl = payload.videoDataUrl || payload.mediaDataUrl || payload.photoDataUrl;
      const parsed = parseVideoPayload(dataUrl);
      const photoPath = saveAreaMedia(visitId, slug, parsed);
      await client.query(
        `INSERT INTO site_visit_photos (visit_id, area_type, area_key, unit_id, photo_path, photo_mime, media_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [visitId, req.areaType, req.areaKey, req.unitId, photoPath, parsed.mime, parsed.mediaType]
      );
    }

    await client.query(
      `UPDATE manager_site_visits
          SET status = 'completed',
              visited_at = $1,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [now, visitId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await sendCommonAreaVisitAnnouncement({
    visitId,
    orgId,
    propertyId: visit.propertyId,
    senderId: managerId,
    plannedVisitAt: now,
    scopeCommon: visit.scopeCommon,
    event: 'completed',
  });

  if (hasRooms) {
    const roomTargets = await loadRoomTargetsForNotify(visitId);
    await sendCompletedVisitNotices({
      visitId,
      propertyId: visit.propertyId,
      managerId,
      visitedAt: now,
      roomTargets,
    });
  }

  return getVisit(visitId, orgId);
}

module.exports = {
  VISIT_AMOUNT_CENTS,
  MONTHLY_CAP_CENTS,
  resolveOrgIdForUser,
  getDefaultPropertyId,
  getMonthlyUsage,
  loadInspectionAreas,
  listVisits,
  getVisit,
  requestVisit,
  approveVisit,
  rejectVisit,
  cancelVisit,
  completeVisit,
  minPlannedVisitLocalString,
  norfolkNowLocalString,
  formatNorfolkDateTime,
};
