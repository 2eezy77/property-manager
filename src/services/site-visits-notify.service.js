/**
 * Site visit tenant comms:
 * - Common areas → property-wide in-app announcement (all tenants)
 * - Rooms → manager inbox message per affected tenant
 */

const pool = require('../db/client');
const { formatNorfolkDateTime } = require('../utils/norfolk-time');
const { COMMON_AREAS } = require('./site-visits-catalog');
const roomInspectionCancelled = require('./email-templates/roomInspectionCancelled');

const ROOM_PURPOSE = {
  ROUTINE: 'routine_inspection',
  MAINTENANCE: 'maintenance_followup',
  VACANT_SHOWING: 'vacant_showing',
};

const NOTICE_TYPE = {
  INSPECTION: 'room_inspection',
  MAINTENANCE: 'maintenance_followup',
  SHOWING: 'vacant_showing',
};

const COMMON_COPY = {
  scheduled: (when, areas) => ({
    title: `Common area walkthrough scheduled — ${when}`,
    body: [
      `A property manager will walk the shared common areas on ${when}.`,
      '',
      `Areas: ${areas}`,
      '',
      'This covers kitchen/living, parking, and porch only — not your private room unless you received a separate inbox message.',
      '',
      'You do not need to be present, but you may be home if you wish.',
    ].join('\n'),
  }),
  completed: (when, areas) => ({
    title: `Common area walkthrough completed — ${when}`,
    body: [
      `The scheduled common area walkthrough was completed on ${when}.`,
      '',
      `Areas covered: ${areas}`,
      '',
      'You did not need to be present. Thank you if you were home.',
    ].join('\n'),
  }),
  cancelled: (when, areas) => ({
    title: `Common area walkthrough cancelled`,
    body: [
      `The common area walkthrough scheduled for ${when} has been cancelled.`,
      '',
      `Areas: ${areas}`,
      '',
      'We will send a new announcement if it is rescheduled.',
    ].join('\n'),
  }),
};

function commonAreaLabels(keys) {
  const map = Object.fromEntries(COMMON_AREAS.map((a) => [a.key, a.label]));
  const list = keys?.length ? keys : COMMON_AREAS.map((a) => a.key);
  return list.map((k) => map[k] || k);
}

async function loadPropertyTenants(propertyId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id AS tenant_id,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN users u ON u.id = l.tenant_id AND u.is_active = TRUE
      WHERE un.property_id = $1
        AND l.status = 'active'
      ORDER BY tenant_name`,
    [propertyId]
  );
  return rows;
}

function groupTargetsByTenant(targets) {
  const map = new Map();
  for (const t of targets) {
    if (!t.tenant_id) continue;
    const cur = map.get(t.tenant_id) || {
      tenantId: t.tenant_id,
      tenantName: t.tenant_name,
      unitIds: [],
      roomLabels: [],
    };
    cur.unitIds.push(t.unit_id);
    cur.roomLabels.push(t.room_label);
    map.set(t.tenant_id, cur);
  }
  return [...map.values()];
}

function occupiedTargets(targets) {
  return (targets || []).filter((t) => t.tenant_id);
}

function targetsByPurpose(targets, purpose) {
  return (targets || []).filter((t) => (t.room_purpose || ROOM_PURPOSE.ROUTINE) === purpose);
}

async function getTenantLeaseContext(tenantId) {
  const { rows } = await pool.query(
    `SELECT l.id AS lease_id, l.unit_id
       FROM leases l
      WHERE l.tenant_id = $1 AND l.status = 'active'
      ORDER BY l.start_date DESC
      LIMIT 1`,
    [tenantId]
  );
  return rows[0] || { lease_id: null, unit_id: null };
}

async function getOrCreateVisitThread({ tenantId, visitId, subject, managerId }) {
  const { rows: existing } = await pool.query(
    `SELECT mt.id
       FROM message_threads mt
       JOIN messages m ON m.thread_id = mt.id
      WHERE mt.tenant_id = $1
        AND m.metadata->>'site_visit_id' = $2
      ORDER BY mt.created_at DESC
      LIMIT 1`,
    [tenantId, visitId]
  );
  if (existing[0]) return existing[0].id;

  const lease = await getTenantLeaseContext(tenantId);
  const { rows } = await pool.query(
    `INSERT INTO message_threads
       (tenant_id, lease_id, unit_id, subject, category, urgency, triage_status)
     VALUES ($1, $2, $3, $4, 'lease', 'low', 'triaged')
     RETURNING id`,
    [tenantId, lease.lease_id, lease.unit_id, subject]
  );
  return rows[0].id;
}

async function postVisitInboxMessage({ threadId, managerId, body, visitId, noticeType }) {
  await pool.query(
    `INSERT INTO messages
       (thread_id, sender_type, sender_user_id, direction, channel, body, metadata)
     VALUES ($1, 'manager', $2, 'outbound', 'in_app', $3, $4::jsonb)`,
    [
      threadId,
      managerId,
      body,
      JSON.stringify({ site_visit_id: visitId, notice_type: noticeType }),
    ]
  );
  await pool.query(
    `UPDATE message_threads SET updated_at = NOW(), triage_status = 'triaged' WHERE id = $1`,
    [threadId]
  );
}

async function recordInboxNotice({
  visitId,
  tenantId,
  unitIds,
  roomLabels,
  noticeType,
  plannedVisitAt,
}) {
  await pool.query(
    `INSERT INTO site_visit_tenant_notices
       (visit_id, tenant_id, unit_ids, room_labels, channel, notice_type, planned_visit_at)
     VALUES ($1, $2, $3, $4, 'inbox', $5, $6)`,
    [visitId, tenantId, unitIds, roomLabels, noticeType, plannedVisitAt]
  );
}

/** Property-wide announcement for common area walkthroughs. */
async function sendCommonAreaVisitAnnouncement({
  visitId,
  orgId,
  propertyId,
  senderId,
  plannedVisitAt,
  scopeCommon,
  event,
}) {
  const tenants = await loadPropertyTenants(propertyId);
  if (!tenants.length) return { sent: 0, announcementId: null };

  const when = formatNorfolkDateTime(plannedVisitAt);
  const areas = commonAreaLabels(scopeCommon).join(', ');
  const copyFn = COMMON_COPY[event];
  if (!copyFn) return { sent: 0, announcementId: null };

  const { title, body } = copyFn(when, areas);

  const { rows: annRows } = await pool.query(
    `INSERT INTO announcements
       (org_id, property_id, sender_id, title, body, channel, recipient_count, sent_at, source_type, source_id)
     VALUES ($1, $2, $3, $4, $5, 'in_app', $6, NOW(), 'site_visit_common', $7)
     RETURNING id`,
    [orgId, propertyId, senderId, title, body, tenants.length, visitId]
  );
  const annId = annRows[0].id;

  const values = tenants
    .map((t, i) => `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4},$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`)
    .join(',');
  const params = tenants.flatMap((t) => [
    t.tenant_id,
    'announcement',
    title,
    body,
    'in_app',
    annId,
    new Date(),
  ]);
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, channel, related_entity_id, sent_at)
     VALUES ${values}`,
    params
  );

  return { sent: tenants.length, announcementId: annId };
}

async function sendInboxNotices({
  visitId,
  managerId,
  plannedVisitAt,
  groups,
  noticeType,
  bodyFn,
}) {
  if (!groups.length) return { sent: 0, groups: [] };

  const when = formatNorfolkDateTime(plannedVisitAt);
  const subject = `Property visit notice — ${when}`;
  const results = [];

  for (const g of groups) {
    if (!g.tenantId) continue;

    const threadId = await getOrCreateVisitThread({
      tenantId: g.tenantId,
      visitId,
      subject,
      managerId,
    });
    const body = bodyFn(g);
    await postVisitInboxMessage({
      threadId,
      managerId,
      body,
      visitId,
      noticeType,
    });
    await recordInboxNotice({
      visitId,
      tenantId: g.tenantId,
      unitIds: g.unitIds,
      roomLabels: g.roomLabels,
      noticeType,
      plannedVisitAt,
    });

    results.push({ tenantId: g.tenantId });
  }

  return { sent: results.length, groups: results };
}

async function sendInboxCompletedNotices({
  visitId,
  managerId,
  visitedAt,
  groups,
  noticeType,
  bodyFn,
}) {
  if (!groups.length) return { sent: 0, groups: [] };

  const when = formatNorfolkDateTime(visitedAt);
  const subject = `Property visit notice — ${when}`;
  const results = [];

  for (const g of groups) {
    if (!g.tenantId) continue;

    const threadId = await getOrCreateVisitThread({
      tenantId: g.tenantId,
      visitId,
      subject,
      managerId,
    });
    await postVisitInboxMessage({
      threadId,
      managerId,
      body: bodyFn(g),
      visitId,
      noticeType: `${noticeType}_completed`,
    });

    results.push({ tenantId: g.tenantId });
  }

  return { sent: results.length, groups: results };
}

/** Room-specific inbox notices on owner approve. */
async function sendApprovedVisitNotices({
  visitId,
  propertyId,
  managerId,
  plannedVisitAt,
  roomTargets,
}) {
  const targets = roomTargets.map((t) => ({
    unit_id: t.unitId,
    room_label: t.roomLabel,
    tenant_id: t.tenantId,
    tenant_name: t.tenantName,
    room_purpose: t.roomPurpose,
  }));

  const results = { sent: 0, breakdown: {} };

  const inspectionGroups = groupTargetsByTenant(
    occupiedTargets(targetsByPurpose(targets, ROOM_PURPOSE.ROUTINE))
  );
  const inspectionRes = await sendInboxNotices({
    visitId,
    managerId,
    plannedVisitAt,
    groups: inspectionGroups,
    noticeType: NOTICE_TYPE.INSPECTION,
    bodyFn: (g) =>
      [
        'Routine room inspection scheduled per your lease.',
        '',
        `Room(s): ${g.roomLabels.join(', ')}`,
        '',
        'You do not need to be present, but you may be home if you wish.',
        'Entry is limited to the room(s) listed above.',
      ].join('\n'),
  });
  results.breakdown.inspection = inspectionRes.sent;
  results.sent += inspectionRes.sent;

  const maintenanceGroups = groupTargetsByTenant(
    occupiedTargets(targetsByPurpose(targets, ROOM_PURPOSE.MAINTENANCE))
  );
  const maintenanceRes = await sendInboxNotices({
    visitId,
    managerId,
    plannedVisitAt,
    groups: maintenanceGroups,
    noticeType: NOTICE_TYPE.MAINTENANCE,
    bodyFn: (g) =>
      [
        'Maintenance follow-up visit scheduled.',
        '',
        `Room(s): ${g.roomLabels.join(', ')}`,
        '',
        'You do not need to be present, but you may be home if you wish.',
      ].join('\n'),
  });
  results.breakdown.maintenance = maintenanceRes.sent;
  results.sent += maintenanceRes.sent;

  const vacantRooms = targetsByPurpose(targets, ROOM_PURPOSE.VACANT_SHOWING);
  if (vacantRooms.length) {
    const vacantLabels = vacantRooms.map((r) => r.room_label);
    const propertyTenants = await loadPropertyTenants(propertyId);
    const showingGroups = propertyTenants.map((t) => ({
      tenantId: t.tenant_id,
      tenantName: t.tenant_name,
      unitIds: vacantRooms.map((r) => r.unit_id),
      roomLabels: vacantLabels,
    }));
    const showingRes = await sendInboxNotices({
      visitId,
      managerId,
      plannedVisitAt,
      groups: showingGroups,
      noticeType: NOTICE_TYPE.SHOWING,
      bodyFn: (g) =>
        [
          'A prospective tenant may tour a vacant room at the property.',
          '',
          `Vacant room(s): ${g.roomLabels.join(', ')}`,
          '',
          'You do not need to be present or prepare your room. You may be home if you wish.',
          'We will not enter your leased room unless it is listed above.',
        ].join('\n'),
    });
    results.breakdown.showing = showingRes.sent;
    results.sent += showingRes.sent;
  }

  return results;
}

/** Room inbox completion messages after check-in. */
async function sendCompletedVisitNotices({
  visitId,
  propertyId,
  managerId,
  visitedAt,
  roomTargets,
}) {
  const targets = roomTargets.map((t) => ({
    unit_id: t.unitId,
    room_label: t.roomLabel,
    tenant_id: t.tenantId,
    tenant_name: t.tenantName,
    room_purpose: t.roomPurpose,
  }));

  const results = { sent: 0, breakdown: {} };

  const inspectionGroups = groupTargetsByTenant(
    occupiedTargets(targetsByPurpose(targets, ROOM_PURPOSE.ROUTINE))
  );
  const inspectionRes = await sendInboxCompletedNotices({
    visitId,
    managerId,
    visitedAt,
    groups: inspectionGroups,
    noticeType: NOTICE_TYPE.INSPECTION,
    bodyFn: (g) =>
      [
        'Routine room inspection completed.',
        '',
        `Room(s) inspected: ${g.roomLabels.join(', ')}`,
        '',
        'You did not need to be present. Thank you if you were home.',
      ].join('\n'),
  });
  results.breakdown.inspection = inspectionRes.sent;
  results.sent += inspectionRes.sent;

  const maintenanceGroups = groupTargetsByTenant(
    occupiedTargets(targetsByPurpose(targets, ROOM_PURPOSE.MAINTENANCE))
  );
  const maintenanceRes = await sendInboxCompletedNotices({
    visitId,
    managerId,
    visitedAt,
    groups: maintenanceGroups,
    noticeType: NOTICE_TYPE.MAINTENANCE,
    bodyFn: (g) =>
      [
        'Maintenance follow-up visit completed.',
        '',
        `Room(s): ${g.roomLabels.join(', ')}`,
        '',
        'Open a maintenance request in Messages if anything still needs attention.',
      ].join('\n'),
  });
  results.breakdown.maintenance = maintenanceRes.sent;
  results.sent += maintenanceRes.sent;

  const vacantRooms = targetsByPurpose(targets, ROOM_PURPOSE.VACANT_SHOWING);
  if (vacantRooms.length) {
    const vacantLabels = vacantRooms.map((r) => r.room_label);
    const propertyTenants = await loadPropertyTenants(propertyId);
    const showingGroups = propertyTenants.map((t) => ({
      tenantId: t.tenant_id,
      tenantName: t.tenant_name,
      unitIds: vacantRooms.map((r) => r.unit_id),
      roomLabels: vacantLabels,
    }));
    const showingRes = await sendInboxCompletedNotices({
      visitId,
      managerId,
      visitedAt,
      groups: showingGroups,
      noticeType: NOTICE_TYPE.SHOWING,
      bodyFn: (g) =>
        [
          'Vacant room showing completed.',
          '',
          `Vacant room(s) shown: ${g.roomLabels.join(', ')}`,
          '',
          'You did not need to be present.',
        ].join('\n'),
    });
    results.breakdown.showing = showingRes.sent;
    results.sent += showingRes.sent;
  }

  return results;
}

async function sendCancellationNotices({ visitId, managerId, plannedVisitAt }) {
  const { rows: notices } = await pool.query(
    `SELECT tenant_id, room_labels, notice_type
       FROM site_visit_tenant_notices
      WHERE visit_id = $1 AND channel = 'inbox' AND cancelled_at IS NULL
        AND notice_type IN ('room_inspection', 'maintenance_followup', 'vacant_showing')
      ORDER BY sent_at`,
    [visitId]
  );
  if (!notices.length) return { sent: 0 };

  const plannedAtFormatted = formatNorfolkDateTime(plannedVisitAt);
  const when = formatNorfolkDateTime(plannedVisitAt);
  const subject = `Property visit notice — ${when}`;
  let sent = 0;
  const sentKeys = new Set();

  for (const n of notices) {
    const dedupeKey = `${n.tenant_id}:${n.notice_type}`;
    if (sentKeys.has(dedupeKey)) continue;
    sentKeys.add(dedupeKey);

    const cancelType = ['maintenance_followup', 'vacant_showing'].includes(n.notice_type)
      ? n.notice_type
      : 'room_inspection';
    const { inAppBody } = roomInspectionCancelled.render({
      tenantName: 'Tenant',
      propertyName: '',
      plannedAtFormatted,
      roomLabels: n.room_labels,
      noticeType: cancelType,
    });

    const threadId = await getOrCreateVisitThread({
      tenantId: n.tenant_id,
      visitId,
      subject,
      managerId,
    });
    await postVisitInboxMessage({
      threadId,
      managerId,
      body: inAppBody,
      visitId,
      noticeType: `${n.notice_type}_cancelled`,
    });

    await pool.query(
      `UPDATE site_visit_tenant_notices
          SET cancelled_at = NOW()
        WHERE visit_id = $1 AND tenant_id = $2 AND notice_type = $3 AND channel = 'inbox'`,
      [visitId, n.tenant_id, n.notice_type]
    );
    sent++;
  }

  return { sent };
}

function previewTenantsToNotify(roomTargets, propertyTenants = []) {
  const out = [];
  const seen = new Set();

  for (const purpose of [ROOM_PURPOSE.ROUTINE, ROOM_PURPOSE.MAINTENANCE]) {
    const groups = groupTargetsByTenant(
      occupiedTargets(
        roomTargets
          .filter((t) => t.roomPurpose === purpose)
          .map((t) => ({
            tenant_id: t.tenantId,
            tenant_name: t.tenantName,
            unit_id: t.unitId,
            room_label: t.roomLabel,
          }))
      )
    );
    for (const g of groups) {
      const key = `${g.tenantId}:${purpose}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tenantId: g.tenantId,
        tenantName: g.tenantName,
        roomLabels: g.roomLabels,
        scenario: purpose,
        channel: 'inbox',
      });
    }
  }

  const vacantLabels = roomTargets
    .filter((r) => r.roomPurpose === ROOM_PURPOSE.VACANT_SHOWING)
    .map((r) => r.roomLabel);
  if (vacantLabels.length) {
    for (const t of propertyTenants) {
      const key = `${t.tenant_id}:${ROOM_PURPOSE.VACANT_SHOWING}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tenantId: t.tenant_id,
        tenantName: t.tenant_name,
        roomLabels: vacantLabels,
        scenario: ROOM_PURPOSE.VACANT_SHOWING,
        channel: 'inbox',
      });
    }
  }

  return out;
}

function previewCommonAreaAnnouncement(scopeCommon, plannedVisitAt) {
  const when = plannedVisitAt ? formatNorfolkDateTime(plannedVisitAt) : 'TBD';
  const areas = commonAreaLabels(scopeCommon).join(', ');
  return {
    channel: 'announcement',
    title: `Common area walkthrough scheduled — ${when}`,
    areas,
    audience: 'All tenants at property',
  };
}

module.exports = {
  ROOM_PURPOSE,
  NOTICE_TYPE,
  sendCommonAreaVisitAnnouncement,
  sendApprovedVisitNotices,
  sendCompletedVisitNotices,
  sendCancellationNotices,
  groupTargetsByTenant,
  occupiedTargets,
  previewTenantsToNotify,
  previewCommonAreaAnnouncement,
  loadPropertyTenants,
};
