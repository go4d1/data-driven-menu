// Doctor credentialing routes ported from BonSecours into FOM's native http handler.
// All tables live in the `doctors` schema of the tenant DB (aaa).
// Email queue inserts and auto-send cron are intentionally removed — outbound
// email is driven by sendemail.html campaigns instead.

const crypto = require('crypto');
const { Client } = require('pg');

const STATES = ['DE', 'MD', 'VA'];

// ── tiny helpers ─────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function readJson(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); }
      catch { resolve({}); }
    });
  });
}

// Minimal CSV parser: handles quoted fields with commas, doubled-quote escape.
// Returns array of plain objects keyed by the header row.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  const s = String(text || '').replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1)
    .filter((r) => r.some((c) => c && c.trim().length))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function withTenant(dbConfig, fn) {
  const client = new Client(dbConfig);
  await client.connect();
  try { return await fn(client); }
  finally { await client.end().catch(() => {}); }
}

async function audit(client, actorId, actorType, entity, entityId, action, before, after) {
  await client.query(
    `INSERT INTO doctors.audit_log (actor_id, actor_type, entity, entity_id, action, before_value, after_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, actorType, entity, entityId, action,
     before == null ? null : JSON.stringify(before),
     after  == null ? null : JSON.stringify(after)],
  );
}

// ── URL pattern matcher ──────────────────────────────────────────────────────

function match(url, method, pat, m) {
  if (m !== method) return null;
  const re = new RegExp('^' + pat.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  const r = re.exec(url);
  return r ? (r.groups || {}) : null;
}

// ── main dispatch ────────────────────────────────────────────────────────────

async function handle(req, res, ctx) {
  const urlNoQuery = req.url.split('?')[0];
  if (!urlNoQuery.startsWith('/api/admin/') && !urlNoQuery.startsWith('/api/doctor/')) {
    return false;
  }

  const dbConfig = ctx.getTenantConfig(ctx.prefix);
  if (!dbConfig) {
    sendJson(res, 404, { error: 'Unknown tenant' });
    return true;
  }
  const session = ctx.getSession(req, res);
  const isAdminPath = urlNoQuery.startsWith('/api/admin/');

  // Admin paths require FOM login. Doctor paths use the doctor's token session.
  if (isAdminPath && !session.loggedIn) {
    sendJson(res, 401, { error: 'Login required' });
    return true;
  }
  const adminActor = session.userId || null;

  try {
    // ────── ADMIN: doctors ──────
    let p;

    if ((p = match(urlNoQuery, req.method, '/api/admin/doctors', 'GET'))) {
      const search = new URL(req.url, 'http://x').searchParams.get('search');
      await withTenant(dbConfig, async (client) => {
        const conds = ['deleted_at IS NULL'];
        const params = [];
        if (search && search.trim()) {
          params.push(`%${search.trim()}%`);
          conds.push(`(firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)`);
        }
        const r = await client.query(
          `SELECT id, firstname, lastname, email, phone, invitation_token,
                  last_response_at, last_attested_at,
                  follow_ups_sent, last_follow_up_at, created_at, updated_at
           FROM doctors.doctors
           WHERE ${conds.join(' AND ')}
           ORDER BY lastname, firstname`,
          params,
        );
        sendJson(res, 200, { data: r.rows });
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/doctors/:id', 'GET'))) {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(
          `SELECT id, firstname, lastname, email, phone, invitation_token,
                  last_response_at, last_attested_at,
                  follow_ups_sent, last_follow_up_at, created_at, updated_at
           FROM doctors.doctors WHERE id = $1 AND deleted_at IS NULL`,
          [p.id],
        );
        if (!r.rows[0]) { sendJson(res, 404, { error: 'Doctor not found' }); return; }
        sendJson(res, 200, { data: r.rows[0] });
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/doctors', 'POST'))) {
      const body = await readJson(req);
      const { firstname, lastname, email, phone } = body;
      if (!firstname || !lastname || !email) {
        sendJson(res, 400, { error: 'firstname, lastname, and email are required' });
        return true;
      }
      await withTenant(dbConfig, async (client) => {
        try {
          await client.query('BEGIN');
          const token = generateToken();
          const r = await client.query(
            `INSERT INTO doctors.doctors (firstname, lastname, email, phone, invitation_token)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, firstname, lastname, email, phone, invitation_token,
                       last_response_at, last_attested_at,
                       follow_ups_sent, last_follow_up_at, created_at, updated_at`,
            [firstname.trim(), lastname.trim(), email.trim(), phone ? phone.trim() : null, token],
          );
          const doctor = r.rows[0];
          await audit(client, adminActor, 'admin', 'profile', doctor.id, 'create', null, {
            firstname: doctor.firstname, lastname: doctor.lastname,
            email: doctor.email, phone: doctor.phone,
          });
          await client.query('COMMIT');
          sendJson(res, 201, { data: doctor });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          if (e.code === '23505') sendJson(res, 409, { error: 'A doctor with that invitation token already exists' });
          else sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/doctors/:id', 'PUT'))) {
      const body = await readJson(req);
      const { firstname, lastname, email, phone } = body;
      if (!firstname || !lastname || !email) {
        sendJson(res, 400, { error: 'firstname, lastname, and email are required' });
        return true;
      }
      await withTenant(dbConfig, async (client) => {
        const existing = await client.query(
          `SELECT id, firstname, lastname, email, phone FROM doctors.doctors
           WHERE id = $1 AND deleted_at IS NULL`,
          [p.id],
        );
        if (!existing.rows[0]) { sendJson(res, 404, { error: 'Doctor not found' }); return; }
        const before = existing.rows[0];
        const after = await client.query(
          `UPDATE doctors.doctors
           SET firstname = $1, lastname = $2, email = $3, phone = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5
           RETURNING id, firstname, lastname, email, phone, invitation_token,
                     last_response_at, last_attested_at,
                     follow_ups_sent, last_follow_up_at, created_at, updated_at`,
          [firstname.trim(), lastname.trim(), email.trim(), phone ? phone.trim() : null, p.id],
        );
        await audit(client, adminActor, 'admin', 'profile', p.id, 'update',
          { firstname: before.firstname, lastname: before.lastname, email: before.email, phone: before.phone },
          { firstname: after.rows[0].firstname, lastname: after.rows[0].lastname, email: after.rows[0].email, phone: after.rows[0].phone });
        sendJson(res, 200, { data: after.rows[0] });
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/doctors/:id', 'DELETE'))) {
      await withTenant(dbConfig, async (client) => {
        await client.query(
          `UPDATE doctors.doctors SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [p.id],
        );
        await audit(client, adminActor, 'admin', 'profile', p.id, 'delete', null, null);
        sendJson(res, 200, { deleted: true });
      });
      return true;
    }

    // CSV upload — multipart with `doctorsFile` field, columns: firstname,lastname,email,phone
    if (urlNoQuery === '/api/admin/doctors/upload' && req.method === 'POST') {
      const buf = await ctx.readRequestBuffer(req);
      const { files } = ctx.parseMultipart(buf, req.headers['content-type']);
      const file = files.find((f) => f.field === 'doctorsFile') || files[0];
      if (!file) { sendJson(res, 400, { error: 'No file uploaded' }); return true; }
      const rows = parseCsv(file.data.toString('utf8'));
      const doctors = [];
      for (const r of rows) {
        if (!r.firstname || !r.lastname || !r.email) {
          sendJson(res, 400, { error: `Missing required fields in row: ${JSON.stringify(r)}` });
          return true;
        }
        doctors.push({
          firstname: r.firstname, lastname: r.lastname,
          email: r.email, phone: r.phone || null,
        });
      }
      if (!doctors.length) { sendJson(res, 400, { error: 'No valid doctor records found in CSV' }); return true; }

      await withTenant(dbConfig, async (client) => {
        try {
          await client.query('BEGIN');
          // Reconcile by email (case-insensitive). client_id is gone in the new schema.
          const emails = doctors.map((d) => d.email.toLowerCase());
          const ex = await client.query(
            `SELECT id, firstname, lastname, email, phone, last_response_at
             FROM doctors.doctors WHERE LOWER(email) = ANY($1) AND deleted_at IS NULL`,
            [emails],
          );
          const byEmail = new Map(ex.rows.map((d) => [d.email.toLowerCase(), d]));
          let created = 0, updated = 0;
          for (const d of doctors) {
            const existing = byEmail.get(d.email.toLowerCase());
            if (!existing) {
              const ins = await client.query(
                `INSERT INTO doctors.doctors (firstname, lastname, email, phone, invitation_token)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [d.firstname, d.lastname, d.email, d.phone, generateToken()],
              );
              await audit(client, adminActor, 'admin', 'profile', ins.rows[0].id, 'create', null, d);
              created++;
            } else {
              const changed =
                existing.firstname !== d.firstname ||
                existing.lastname  !== d.lastname  ||
                existing.email     !== d.email     ||
                existing.phone     !== d.phone;
              if (changed) {
                await client.query(
                  `UPDATE doctors.doctors
                   SET firstname=$1, lastname=$2, email=$3, phone=$4, updated_at=CURRENT_TIMESTAMP
                   WHERE id=$5`,
                  [d.firstname, d.lastname, d.email, d.phone, existing.id],
                );
                await audit(client, adminActor, 'admin', 'profile', existing.id, 'update',
                  { firstname: existing.firstname, lastname: existing.lastname, email: existing.email, phone: existing.phone },
                  d);
                updated++;
              }
            }
          }
          // Soft-delete doctors not in this upload.
          const keepEmails = doctors.map((d) => d.email.toLowerCase());
          const toDel = await client.query(
            `SELECT id FROM doctors.doctors
             WHERE deleted_at IS NULL AND LOWER(email) <> ALL($1::text[])`,
            [keepEmails],
          );
          let deleted = 0;
          for (const row of toDel.rows) {
            await client.query(
              `UPDATE doctors.doctors SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`,
              [row.id],
            );
            await audit(client, adminActor, 'admin', 'profile', row.id, 'delete', null, null);
            deleted++;
          }
          await client.query('COMMIT');
          sendJson(res, 200, { created, updated, deleted, reconciled: true });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    // ────── ADMIN: offices ──────

    if ((p = match(urlNoQuery, req.method, '/api/admin/offices', 'GET'))) {
      const u = new URL(req.url, 'http://x');
      const state = u.searchParams.get('state');
      const search = u.searchParams.get('search');
      await withTenant(dbConfig, async (client) => {
        const conds = ['deleted_at IS NULL'];
        const params = [];
        if (state && STATES.includes(state)) {
          params.push(state);
          conds.push(`state = $${params.length}`);
        }
        if (search && search.trim()) {
          params.push(`%${search.trim()}%`);
          const i = params.length;
          conds.push(`(name ILIKE $${i} OR street ILIKE $${i} OR city ILIKE $${i} OR zip ILIKE $${i})`);
        }
        const r = await client.query(
          `SELECT id, name, street, city, state, zip, created_at, updated_at
           FROM doctors.offices WHERE ${conds.join(' AND ')}
           ORDER BY state, city, name`,
          params,
        );
        sendJson(res, 200, { data: r.rows });
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/offices/:id', 'GET'))) {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(
          `SELECT id, name, street, city, state, zip, created_at, updated_at
           FROM doctors.offices WHERE id = $1 AND deleted_at IS NULL`,
          [p.id],
        );
        if (!r.rows[0]) { sendJson(res, 404, { error: 'Office not found' }); return; }
        sendJson(res, 200, { data: r.rows[0] });
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/offices', 'POST'))) {
      const body = await readJson(req);
      const { name, street, city, state, zip } = body;
      if (!name || !street || !city || !state || !zip) {
        sendJson(res, 400, { error: 'name, street, city, state, and zip are required' });
        return true;
      }
      if (!STATES.includes(state)) { sendJson(res, 400, { error: 'state must be DE, MD, or VA' }); return true; }
      await withTenant(dbConfig, async (client) => {
        try {
          const r = await client.query(
            `INSERT INTO doctors.offices (name, street, city, state, zip)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, street, city, state, zip, created_at, updated_at`,
            [name.trim(), street.trim(), city.trim(), state.trim(), zip.trim()],
          );
          const office = r.rows[0];
          await audit(client, adminActor, 'admin', 'office', office.id, 'create', null, office);
          sendJson(res, 201, { data: office });
        } catch (e) {
          if (e.code === '23505') sendJson(res, 409, { error: 'An office already exists at this address' });
          else sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/offices/:id', 'PUT'))) {
      const body = await readJson(req);
      const { name, street, city, state, zip } = body;
      if (!name || !street || !city || !state || !zip) {
        sendJson(res, 400, { error: 'name, street, city, state, and zip are required' });
        return true;
      }
      if (!STATES.includes(state)) { sendJson(res, 400, { error: 'state must be DE, MD, or VA' }); return true; }
      await withTenant(dbConfig, async (client) => {
        const ex = await client.query(
          `SELECT id, name, street, city, state, zip FROM doctors.offices
           WHERE id = $1 AND deleted_at IS NULL`,
          [p.id],
        );
        if (!ex.rows[0]) { sendJson(res, 404, { error: 'Office not found' }); return; }
        const before = ex.rows[0];
        try {
          const r = await client.query(
            `UPDATE doctors.offices SET name=$1, street=$2, city=$3, state=$4, zip=$5,
             updated_at=CURRENT_TIMESTAMP WHERE id=$6
             RETURNING id, name, street, city, state, zip, created_at, updated_at`,
            [name.trim(), street.trim(), city.trim(), state.trim(), zip.trim(), p.id],
          );
          await audit(client, adminActor, 'admin', 'office', p.id, 'update', before, r.rows[0]);
          sendJson(res, 200, { data: r.rows[0] });
        } catch (e) {
          if (e.code === '23505') sendJson(res, 409, { error: 'An office already exists at this address' });
          else sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/admin/offices/:id', 'DELETE'))) {
      await withTenant(dbConfig, async (client) => {
        await client.query(
          `UPDATE doctors.offices SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
          [p.id],
        );
        await audit(client, adminActor, 'admin', 'office', p.id, 'delete', null, null);
        sendJson(res, 200, { deleted: true });
      });
      return true;
    }

    // Office CSV upload — multipart with `officesFile` field, columns: name,street,city,state,zip
    if (urlNoQuery === '/api/admin/offices/upload' && req.method === 'POST') {
      const buf = await ctx.readRequestBuffer(req);
      const { files } = ctx.parseMultipart(buf, req.headers['content-type']);
      const file = files.find((f) => f.field === 'officesFile') || files[0];
      if (!file) { sendJson(res, 400, { error: 'No file uploaded' }); return true; }
      const rows = parseCsv(file.data.toString('utf8'));
      const offices = [];
      for (const r of rows) {
        if (!r.name || !r.street || !r.city || !r.state || !r.zip) {
          sendJson(res, 400, { error: `Missing required fields in row: ${JSON.stringify(r)}` });
          return true;
        }
        if (!STATES.includes(r.state)) { sendJson(res, 400, { error: `Invalid state: ${r.state}` }); return true; }
        offices.push({ name: r.name, street: r.street, city: r.city, state: r.state, zip: r.zip });
      }
      if (!offices.length) { sendJson(res, 400, { error: 'No valid office records found in CSV' }); return true; }

      await withTenant(dbConfig, async (client) => {
        try {
          await client.query('BEGIN');
          let created = 0, updated = 0;
          for (const o of offices) {
            const find = await client.query(
              `SELECT id, name FROM doctors.offices
               WHERE street=$1 AND city=$2 AND state=$3 AND zip=$4 AND deleted_at IS NULL`,
              [o.street, o.city, o.state, o.zip],
            );
            if (!find.rows[0]) {
              await client.query(
                `INSERT INTO doctors.offices (name, street, city, state, zip)
                 VALUES ($1, $2, $3, $4, $5)`,
                [o.name, o.street, o.city, o.state, o.zip],
              );
              created++;
            } else if (find.rows[0].name !== o.name) {
              await client.query(
                `UPDATE doctors.offices SET name=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
                [o.name, find.rows[0].id],
              );
              updated++;
            }
          }
          // Soft-delete offices not present in the upload.
          const tuples = offices.map((o) => [o.street, o.city, o.state, o.zip]);
          if (tuples.length) {
            const placeholders = tuples.map(
              (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
            ).join(',');
            const params = tuples.flat();
            const toDel = await client.query(
              `SELECT id FROM doctors.offices
               WHERE deleted_at IS NULL AND (street, city, state, zip) NOT IN (${placeholders})`,
              params,
            );
            for (const row of toDel.rows) {
              await client.query(
                `UPDATE doctors.offices SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [row.id],
              );
            }
            await client.query('COMMIT');
            sendJson(res, 200, { created, updated, deleted: toDel.rows.length, reconciled: true });
          } else {
            await client.query('COMMIT');
            sendJson(res, 200, { created, updated, deleted: 0, reconciled: true });
          }
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    // ────── ADMIN: reports ──────

    if (urlNoQuery === '/api/admin/reports/non-responders' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`
          SELECT d.id, d.firstname, d.lastname, d.email,
                 pe.email_type, d.follow_ups_sent, d.last_follow_up_at
          FROM doctors.doctors d
          LEFT JOIN doctors.pending_emails pe ON d.id = pe.doctor_id AND pe.status = 'pending'
          WHERE d.deleted_at IS NULL
            AND (d.last_response_at IS NULL
                 OR (d.last_attested_at IS NULL AND pe.email_type = 're_attestation'))
          ORDER BY d.lastname, d.firstname`);
        sendJson(res, 200, { data: r.rows });
      });
      return true;
    }

    if (urlNoQuery === '/api/admin/reports/doctors-by-office-state' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`
          SELECT o.state, d.firstname, d.lastname, d.email,
                 ARRAY_AGG(DISTINCT o.name) AS offices
          FROM doctors.doctors d
          JOIN doctors.doctor_offices dof ON d.id = dof.doctor_id AND dof.deleted_at IS NULL
          JOIN doctors.offices o ON dof.office_id = o.id AND o.deleted_at IS NULL
          WHERE d.deleted_at IS NULL
          GROUP BY o.state, d.id, d.firstname, d.lastname, d.email
          ORDER BY o.state, d.lastname, d.firstname`);
        const grouped = {};
        for (const row of r.rows) {
          (grouped[row.state] ||= []).push({
            firstname: row.firstname, lastname: row.lastname,
            email: row.email, offices: row.offices,
          });
        }
        sendJson(res, 200, { data: grouped });
      });
      return true;
    }

    if (urlNoQuery === '/api/admin/reports/doctors-by-credential-state' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`
          SELECT c.state, d.firstname, d.lastname, d.email,
                 ARRAY_AGG(DISTINCT o.name) AS offices
          FROM doctors.doctors d
          JOIN doctors.credentials c ON d.id = c.doctor_id AND c.deleted_at IS NULL
          LEFT JOIN doctors.doctor_offices dof ON d.id = dof.doctor_id AND dof.deleted_at IS NULL
          LEFT JOIN doctors.offices o ON dof.office_id = o.id AND o.deleted_at IS NULL
          WHERE d.deleted_at IS NULL
          GROUP BY c.state, d.id, d.firstname, d.lastname, d.email
          ORDER BY c.state, d.lastname, d.firstname`);
        const grouped = {};
        for (const row of r.rows) {
          (grouped[row.state] ||= []).push({
            firstname: row.firstname, lastname: row.lastname,
            email: row.email, offices: row.offices || [],
          });
        }
        sendJson(res, 200, { data: grouped });
      });
      return true;
    }

    if (urlNoQuery === '/api/admin/reports/offices-by-doctor' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`
          SELECT d.firstname, d.lastname, d.email,
                 o.name AS office_name, o.street, o.city, o.state, o.zip
          FROM doctors.doctors d
          JOIN doctors.doctor_offices dof ON d.id = dof.doctor_id AND dof.deleted_at IS NULL
          JOIN doctors.offices o ON dof.office_id = o.id AND o.deleted_at IS NULL
          WHERE d.deleted_at IS NULL
          ORDER BY o.name, d.lastname, d.firstname`);
        sendJson(res, 200, { data: r.rows });
      });
      return true;
    }

    if (urlNoQuery === '/api/admin/reports/compliance-gaps' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`
          SELECT d.firstname, d.lastname, d.email, o.state,
                 STRING_AGG(DISTINCT o.name || ' (' || o.street || ', ' || o.city || ')',
                            ', ' ORDER BY o.name || ' (' || o.street || ', ' || o.city || ')') AS offices_in_state
          FROM doctors.doctors d
          JOIN doctors.doctor_offices dof ON d.id = dof.doctor_id AND dof.deleted_at IS NULL
          JOIN doctors.offices o ON dof.office_id = o.id AND o.deleted_at IS NULL
          WHERE d.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM doctors.credentials c
              WHERE c.doctor_id = d.id AND c.state = o.state AND c.deleted_at IS NULL
            )
          GROUP BY d.id, d.firstname, d.lastname, d.email, o.state
          ORDER BY d.lastname, d.firstname, o.state`);
        sendJson(res, 200, { data: r.rows });
      });
      return true;
    }

    // ────── ADMIN: settings ──────

    if (urlNoQuery === '/api/admin/settings' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(`SELECT key, value FROM doctors.settings`);
        const out = {};
        for (const row of r.rows) out[row.key] = row.value;
        sendJson(res, 200, { data: out });
      });
      return true;
    }

    if (urlNoQuery === '/api/admin/settings' && req.method === 'PUT') {
      const body = await readJson(req);
      const v = body.follow_up_interval_days;
      if (!v || Number(v) < 1) { sendJson(res, 400, { error: 'Invalid follow_up_interval_days' }); return true; }
      await withTenant(dbConfig, async (client) => {
        await client.query(
          `INSERT INTO doctors.settings (key, value) VALUES ('follow_up_interval_days', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [String(v)],
        );
        sendJson(res, 200, { updated: true });
      });
      return true;
    }

    // ────── DOCTOR PORTAL (token-gated) ──────

    if ((p = match(urlNoQuery, req.method, '/api/doctor/auth/:credential', 'GET'))) {
      const sep = p.credential.indexOf('~');
      if (sep <= 0 || sep === p.credential.length - 1) {
        sendJson(res, 401, { error: 'Invalid credential format' }); return true;
      }
      const doctorId = parseInt(p.credential.slice(0, sep), 10);
      const token = p.credential.slice(sep + 1);
      if (!Number.isInteger(doctorId) || doctorId <= 0) {
        sendJson(res, 401, { error: 'Invalid credential format' }); return true;
      }
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(
          `SELECT * FROM doctors.doctors WHERE id = $1 AND deleted_at IS NULL`,
          [doctorId],
        );
        if (!r.rows[0] || r.rows[0].invitation_token !== token) {
          sendJson(res, 401, { error: 'Invalid or expired credential' }); return;
        }
        const d = r.rows[0];
        session.doctorId = d.id;
        sendJson(res, 200, {
          success: true,
          doctor: { id: d.id, firstname: d.firstname, lastname: d.lastname, email: d.email, phone: d.phone },
        });
      });
      return true;
    }

    // From here on, doctor portal endpoints require session.doctorId.
    const isDoctorPath = urlNoQuery.startsWith('/api/doctor/');
    if (isDoctorPath && !session.doctorId) {
      sendJson(res, 401, { error: 'Doctor authentication required' });
      return true;
    }
    const doctorId = session.doctorId;

    if (urlNoQuery === '/api/doctor/profile' && req.method === 'GET') {
      await withTenant(dbConfig, async (client) => {
        const dr = await client.query(
          `SELECT id, firstname, lastname, email, phone, last_response_at, last_attested_at
           FROM doctors.doctors WHERE id = $1 AND deleted_at IS NULL`,
          [doctorId],
        );
        if (!dr.rows[0]) { sendJson(res, 404, { error: 'Doctor not found' }); return; }
        const cr = await client.query(
          `SELECT id, state, credential_number FROM doctors.credentials
           WHERE doctor_id = $1 AND deleted_at IS NULL ORDER BY state`,
          [doctorId],
        );
        const or = await client.query(
          `SELECT o.id, o.name, o.street, o.city, o.state, o.zip, dof.id AS doctor_office_id
           FROM doctors.offices o
           JOIN doctors.doctor_offices dof ON o.id = dof.office_id
           WHERE dof.doctor_id = $1 AND dof.deleted_at IS NULL
           ORDER BY o.name`,
          [doctorId],
        );
        sendJson(res, 200, { doctor: dr.rows[0], credentials: cr.rows, offices: or.rows });
      });
      return true;
    }

    if (urlNoQuery === '/api/doctor/profile' && req.method === 'PUT') {
      const body = await readJson(req);
      await withTenant(dbConfig, async (client) => {
        const before = await client.query(
          `SELECT firstname, lastname, email, phone FROM doctors.doctors WHERE id = $1`,
          [doctorId],
        );
        const sets = [];
        const params = [];
        for (const col of ['firstname', 'lastname', 'email', 'phone']) {
          if (body[col] !== undefined) { params.push(body[col]); sets.push(`${col} = $${params.length}`); }
        }
        if (!sets.length) { sendJson(res, 400, { error: 'No fields to update' }); return; }
        sets.push(`updated_at = CURRENT_TIMESTAMP`);
        sets.push(`last_response_at = CURRENT_TIMESTAMP`);
        params.push(doctorId);
        const r = await client.query(
          `UPDATE doctors.doctors SET ${sets.join(', ')} WHERE id = $${params.length}
           RETURNING id, firstname, lastname, email, phone`,
          params,
        );
        await audit(client, doctorId, 'doctor', 'profile', doctorId, 'update', before.rows[0], r.rows[0]);
        sendJson(res, 200, { updated: true, doctor: r.rows[0] });
      });
      return true;
    }

    if (urlNoQuery === '/api/doctor/credentials' && req.method === 'POST') {
      const body = await readJson(req);
      const { state, credential_number } = body;
      if (!state || !credential_number) { sendJson(res, 400, { error: 'state and credential_number required' }); return true; }
      if (!STATES.includes(state)) { sendJson(res, 400, { error: 'Invalid state' }); return true; }
      await withTenant(dbConfig, async (client) => {
        try {
          const r = await client.query(
            `INSERT INTO doctors.credentials (doctor_id, state, credential_number)
             VALUES ($1, $2, $3) RETURNING id, state, credential_number`,
            [doctorId, state, credential_number],
          );
          await client.query(
            `UPDATE doctors.doctors SET last_response_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [doctorId],
          );
          await audit(client, doctorId, 'doctor', 'credential', r.rows[0].id, 'create', null,
            { state, credential_number });
          sendJson(res, 201, { credential: r.rows[0] });
        } catch (e) {
          if (e.code === '23505') sendJson(res, 409, { error: 'Credential for this state already exists' });
          else sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/doctor/credentials/:id', 'DELETE'))) {
      await withTenant(dbConfig, async (client) => {
        const ex = await client.query(
          `SELECT id, state, credential_number FROM doctors.credentials
           WHERE id = $1 AND doctor_id = $2`,
          [p.id, doctorId],
        );
        if (!ex.rows[0]) { sendJson(res, 404, { error: 'Credential not found' }); return; }
        await client.query(
          `UPDATE doctors.credentials SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [p.id],
        );
        await client.query(
          `UPDATE doctors.doctors SET last_response_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [doctorId],
        );
        await audit(client, doctorId, 'doctor', 'credential', p.id, 'delete',
          { state: ex.rows[0].state, credential_number: ex.rows[0].credential_number }, null);
        sendJson(res, 200, { deleted: true });
      });
      return true;
    }

    if (urlNoQuery === '/api/doctor/offices' && req.method === 'POST') {
      const body = await readJson(req);
      const officeId = body.office_id;
      if (!officeId) { sendJson(res, 400, { error: 'office_id required' }); return true; }
      await withTenant(dbConfig, async (client) => {
        try {
          const link = await client.query(
            `INSERT INTO doctors.doctor_offices (doctor_id, office_id)
             VALUES ($1, $2) RETURNING id`,
            [doctorId, officeId],
          );
          const off = await client.query(
            `SELECT id, name, street, city, state, zip FROM doctors.offices WHERE id = $1`,
            [officeId],
          );
          await client.query(
            `UPDATE doctors.doctors SET last_response_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [doctorId],
          );
          await audit(client, doctorId, 'doctor', 'office', link.rows[0].id, 'create', null,
            { office_id: officeId, office_name: off.rows[0].name });
          sendJson(res, 201, {
            office: { ...off.rows[0], doctor_office_id: link.rows[0].id },
          });
        } catch (e) {
          if (e.code === '23505') sendJson(res, 409, { error: 'Office already assigned to this doctor' });
          else sendJson(res, 500, { error: e.message });
        }
      });
      return true;
    }

    if ((p = match(urlNoQuery, req.method, '/api/doctor/offices/:id', 'DELETE'))) {
      await withTenant(dbConfig, async (client) => {
        const ex = await client.query(
          `SELECT id, office_id FROM doctors.doctor_offices WHERE id = $1 AND doctor_id = $2`,
          [p.id, doctorId],
        );
        if (!ex.rows[0]) { sendJson(res, 404, { error: 'Office assignment not found' }); return; }
        await client.query(
          `UPDATE doctors.doctor_offices SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [p.id],
        );
        await client.query(
          `UPDATE doctors.doctors SET last_response_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [doctorId],
        );
        await audit(client, doctorId, 'doctor', 'office', p.id, 'delete',
          { office_id: ex.rows[0].office_id }, null);
        sendJson(res, 200, { deleted: true });
      });
      return true;
    }

    if (urlNoQuery === '/api/doctor/offices/autocomplete' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams.get('q');
      if (!q || !q.trim()) { sendJson(res, 200, { offices: [] }); return true; }
      await withTenant(dbConfig, async (client) => {
        const term = `%${q.toLowerCase()}%`;
        const r = await client.query(
          `SELECT id, name, street, city, state, zip FROM doctors.offices
           WHERE deleted_at IS NULL
             AND (LOWER(name) LIKE $1 OR LOWER(street) LIKE $1 OR LOWER(city) LIKE $1)
           LIMIT 20`,
          [term],
        );
        sendJson(res, 200, { offices: r.rows });
      });
      return true;
    }

    if (urlNoQuery === '/api/doctor/attestation/confirm' && req.method === 'POST') {
      await withTenant(dbConfig, async (client) => {
        const r = await client.query(
          `UPDATE doctors.doctors
           SET last_attested_at = CURRENT_TIMESTAMP,
               last_response_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING last_attested_at`,
          [doctorId],
        );
        await audit(client, doctorId, 'doctor', 'attestation', doctorId, 'confirm', null,
          { confirmed_at: r.rows[0].last_attested_at });
        sendJson(res, 200, { confirmed: true, last_attested_at: r.rows[0].last_attested_at });
      });
      return true;
    }

    sendJson(res, 404, { error: 'Unknown route' });
    return true;
  } catch (e) {
    sendJson(res, 500, { error: e.message });
    return true;
  }
}

module.exports = { handle };
