require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
console.log('Loading server modules...');

// ── SMTP transport (Gmail by default; creds from .env) ───────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// console.log(mailer);

async function sendMail({ to, subject, html, text }) {
  return mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
}
// ── Password helpers ──────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashVerify = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(hashVerify, 'hex'),
  );
}

// ── Tenant-isolated files (served via /file?html=…) ──────────────────────────
// Lives OUTSIDE __dirname so the static handler at the bottom of this file
// can't reach it. Override the location with TENANT_FILES_DIR in .env.
const TENANT_FILES_DIR =
  process.env.TENANT_FILES_DIR || path.resolve(__dirname, '..', 'tenant-files');

// Make sure every tenant has its own subdirectory under TENANT_FILES_DIR so
// files can be dropped in without a manual mkdir. Called once at startup.
function ensureTenantFileDirs() {
  try {
    const registry = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'tenants.json'), 'utf8'),
    );
    for (const prefix of Object.keys(registry.tenants || {})) {
      fs.mkdirSync(path.join(TENANT_FILES_DIR, prefix), { recursive: true });
    }
    console.log('Tenant files dir:', TENANT_FILES_DIR);
  } catch (e) {
    console.error('ensureTenantFileDirs failed:', e.message);
  }
}

// ── Photo thumbnails (sharp) ──────────────────────────────────────────────────
const THUMB_WIDTH = 400;

// Where a photo's thumbnail lives — always a JPEG, in a thumbs/ subfolder of
// the tenant's photo directory. basename() strips any path parts for safety.
function thumbPathFor(prefix, filename) {
  const base = path.basename(filename, path.extname(filename));
  return path.join(
    __dirname,
    'uploads',
    'photos',
    prefix,
    'thumbs',
    base + '.jpg',
  );
}

// Generate a downscaled JPEG thumbnail from srcPath into thumbPath. The source
// may be PNG/JPEG/TIFF/etc — sharp normalises everything to a viewable JPEG.
async function makeThumb(srcPath, thumbPath) {
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  await sharp(srcPath)
    .rotate() // honour EXIF orientation before resizing
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toFile(thumbPath);
}

// ── Widget renderers (port of VFP tabgenerator/accordion, no Wijmo) ───────────
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}

// A widget's jscript field should hold raw JS, but legacy rows sometimes wrap it
// in <script> tags — strip a leading <script…> and/or trailing </script> so
// new Function() can run it. Both are stripped independently (some legacy rows
// have only the opening tag). Neither is ever valid at the edge of real JS.
function unwrapScript(js) {
  return String(js || '')
    .replace(/^\s*<script\b[^>]*>/i, '')
    .replace(/<\/script\s*>\s*$/i, '')
    .trim();
}

async function renderTabs(client, group) {
  const r = await client.query(
    'SELECT id, chead, cbody, jscript FROM widgets WHERE igroup = $1 ORDER BY id',
    [group],
  );
  const rootId = 'fomtabs';
  const btns = r.rows
    .map(
      (row, i) =>
        `<button type="button" class="fom-tab-btn${i === 0 ? ' active' : ''}" data-target="${rootId}-p${row.id}">${escapeHtml(row.chead || '')}</button>`,
    )
    .join('');
  const panels = r.rows
    .map(
      (row, i) =>
        `<div class="fom-tab-panel${i === 0 ? ' active' : ''}" id="${rootId}-p${row.id}">${row.cbody || ''}</div>`,
    )
    .join('');
  // Per-tab jscript keyed by panel id; each runs once, lazily, the first time
  // its tab is shown. Inside it, `spreadsheet` is bound to that tab's panel and
  // `panel` is the panel element itself.
  const tabScripts = {};
  for (const row of r.rows) {
    const js = unwrapScript(row.jscript);
    if (js) tabScripts[`${rootId}-p${row.id}`] = js;
  }
  const html =
    `<style>` +
    `#${rootId}{font-family:Arial,sans-serif;}` +
    `#${rootId} .fom-tab-bar{display:flex;gap:4px;border-bottom:2px solid #d6dce2;}` +
    `#${rootId} .fom-tab-btn{padding:9px 18px;border:none;border-bottom:3px solid transparent;margin-bottom:-2px;background:transparent;color:#5a6b7b;cursor:pointer;font:inherit;font-size:14px;border-radius:6px 6px 0 0;transition:color .15s,background .15s,border-color .15s;}` +
    `#${rootId} .fom-tab-btn:hover{color:#2c3e50;background:#eef1f4;}` +
    `#${rootId} .fom-tab-btn.active{color:#2c3e50;font-weight:bold;border-bottom-color:#2c3e50;}` +
    `#${rootId} .fom-tab-panel{display:none;padding:16px;border:1px solid #d6dce2;border-top:none;background:#fff;border-radius:0 0 6px 6px;}` +
    `#${rootId} .fom-tab-panel.active{display:block;}` +
    `</style>` +
    `<div id="${rootId}" class="fom-tabs"><div class="fom-tab-bar">${btns}</div>${panels}</div>`;
  const jscript =
    `(function(){var r=document.getElementById('${rootId}');if(!r)return;` +
    `var scripts=${JSON.stringify(tabScripts)};var ran={};` +
    `function runTab(p){if(!p||ran[p.id]||!scripts[p.id])return;ran[p.id]=true;` +
    `var ss=function(t,f){return spreadsheet(t,f,p);};` +
    `try{new Function('spreadsheet','panel',scripts[p.id])(ss,p);}` +
    `catch(e){console.error('tab jscript error ('+p.id+'):',e);}}` +
    `r.querySelectorAll('.fom-tab-btn').forEach(function(b){b.addEventListener('click',function(){` +
    `r.querySelectorAll('.fom-tab-btn').forEach(function(x){x.classList.remove('active');});` +
    `r.querySelectorAll('.fom-tab-panel').forEach(function(x){x.classList.remove('active');});` +
    `b.classList.add('active');var p=document.getElementById(b.dataset.target);` +
    `p.classList.add('active');runTab(p);` +
    `});});` +
    `runTab(r.querySelector('.fom-tab-panel.active'));})();`;
  return { html, jscript };
}

async function renderAccordion(client, group) {
  const r = await client.query(
    'SELECT id, chead, cbody FROM widgets WHERE igroup = $1 ORDER BY id',
    [group],
  );
  const rootId = 'fomaccordion';
  const items = r.rows
    .map(
      (row, i) =>
        `<details${i === 0 ? ' open' : ''}><summary>${escapeHtml(row.chead || '')}</summary><div class="fom-acc-body">${row.cbody || ''}</div></details>`,
    )
    .join('');
  const html =
    `<style>` +
    `#${rootId} details{border:1px solid #999;margin-bottom:2px;}` +
    `#${rootId} summary{padding:6px 10px;background:#eee;cursor:pointer;font-weight:bold;list-style:none;}` +
    `#${rootId} summary::-webkit-details-marker{display:none;}` +
    `#${rootId} summary::before{content:'\\25B6';display:inline-block;margin-right:6px;transition:transform .15s;}` +
    `#${rootId} details[open] summary::before{transform:rotate(90deg);}` +
    `#${rootId} .fom-acc-body{padding:10px;}` +
    `</style>` +
    `<div id="${rootId}" class="fom-accordion">${items}</div>`;
  return { html, jscript: '' };
}

// Parse cfunction like `tabgenerator('1')` or `accordion(2)` → { name, arg }
function parseWidgetCall(cfunction) {
  const m = cfunction.match(
    /^\s*(tabgenerator|accordion)\s*\(\s*['"]?(\d+)['"]?\s*\)\s*$/i,
  );
  return m ? { name: m[1].toLowerCase(), arg: parseInt(m[2], 10) } : null;
}

// ── Saved-query registry (server-side, parameterized — safer than raw SQL) ───
// Each entry: { label, sql (with $1,$2…), params: [{ name, label, type }] }
// Queries MUST return a column named "email"; any other columns become
// {{placeholder}} substitutions in the letter body.
// Core saved queries available to every tenant. Apps contribute their own via
// their savedQueries.js module — see loadTenantApps() and getSavedQueries(prefix).
const CORE_SAVED_QUERIES = {
  active_users: {
    label: 'All active users',
    sql: 'SELECT email, firstname FROM users WHERE active = true',
    params: [],
  },
  users_by_role: {
    label: 'Active users by role code',
    sql: "SELECT email, firstname FROM users WHERE active = true AND role LIKE '%' || $1 || '%'",
    params: [{ name: 'role', label: 'Role code (single char)', type: 'text' }],
  },
};

// ── Tenant app loader (Pattern B) ────────────────────────────────────────────
// Each tenant in tenants.json can declare an `apps` array. For each app name,
// we require `tenants/<prefix>/<app>/app.js` which exports { name, routes,
// savedQueries, seed }. Loaded once at boot; restart to pick up changes.
// (App code can't live in `<prefix>/` itself — that's the tenant's Postgres
// data directory, which initdb requires to be empty.)
function loadTenantApps() {
  const registry = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'tenants.json'), 'utf8'),
  );
  const byPrefix = {};
  for (const [prefix, t] of Object.entries(registry.tenants)) {
    byPrefix[prefix] = (t.apps || []).map((appName) => {
      const appDir = path.join('tenants', prefix, appName);
      const mod = require(path.join(__dirname, appDir, 'app.js'));
      return { ...mod, _appDir: appDir };
    });
  }
  return byPrefix;
}
const TENANT_APPS = loadTenantApps();

function getSavedQueries(prefix) {
  const merged = { ...CORE_SAVED_QUERIES };
  for (const app of TENANT_APPS[prefix] || []) {
    Object.assign(merged, app.savedQueries || {});
  }
  return merged;
}

// Global defaults available to every letter as {{placeholder}}s. A campaign's
// SQL row can shadow any of these by selecting a column of the same name —
// useful when one campaign needs to point at a different host.
function letterGlobals() {
  return {
    base_url: process.env.BASE_URL || 'http://aaa.localhost:3000',
  };
}

// Substitute {{col}} placeholders in a letter using a recipient row's columns.
// letterGlobals() fills any placeholder the row doesn't define or has null for.
function fillLetter(template, row) {
  const globals = letterGlobals();
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = row && row[k] != null ? row[k] : globals[k];
    return v == null ? '' : String(v);
  });
}

// Raw-SQL access guard. The required role is read from fommenu.crole of the
// raw-page row (pk 101215) so it tracks whatever's set in menubuilder.html.
// Falls back to 'd' if the menu row is missing. Tenant-keyed 30s cache.
const SENDEMAIL_RAW_PK = 101215;
const rawRoleCache = new Map(); // prefix -> { role, expires }
async function getRequiredRawRole(prefix, client) {
  const now = Date.now();
  const cached = rawRoleCache.get(prefix);
  if (cached && cached.expires > now) return cached.role;
  let role = 'd';
  try {
    const r = await client.query('SELECT crole FROM fommenu WHERE pk = $1', [
      SENDEMAIL_RAW_PK,
    ]);
    if (r.rows[0] && r.rows[0].crole) role = r.rows[0].crole;
  } catch {
    // table missing or query failed → fall back to default
  }
  rawRoleCache.set(prefix, { role, expires: now + 30000 });
  return role;
}
async function hasRawAccess(prefix, client, session) {
  if (!session || !session.loggedIn) return false;
  const required = await getRequiredRawRole(prefix, client);
  return (session.role || '').includes(required);
}

// ── Startup migration: create sendemail table per tenant ─────────────────────
async function migrateSendemail() {
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  for (const [subdomain, tenant] of Object.entries(registry.tenants)) {
    const client = new Client({
      host: 'localhost',
      user: process.env.USER,
      database: tenant.database,
      port: tenant.port,
    });
    try {
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS sendemail (
          id      SERIAL PRIMARY KEY,
          name    TEXT NOT NULL,
          qtype   TEXT NOT NULL CHECK (qtype IN ('raw','saved')),
          query   TEXT,
          qname   TEXT,
          qparams JSONB,
          letter  TEXT NOT NULL DEFAULT ''
        )
      `);
    } catch (e) {
      console.log(
        `  sendemail migration skipped for ${subdomain}: ${e.message}`,
      );
    } finally {
      await client.end().catch(() => {});
    }
  }
}

// ── Startup seed: register fommenu rows for sendemail pages ───────────────────
// pk=101216 → sendemail.html (saved queries, all users)
// pk=101215 → sendemail-raw.html (raw SQL, developer role only)
// HTML is loaded from the file via chref; the inline <script> body is copied to
// the row's jscript column so runJscript() executes it after innerHTML injection.
async function seedSendemailMenu() {
  const fragments = {
    101216: {
      file: 'sendemail.html',
      cprompt: 'Send Email',
      isort: 999,
      ilevel: 0,
      crole: '',
    },
    101215: {
      file: 'sendemail-raw.html',
      cprompt: 'Send Email — Raw SQL',
      isort: 998,
      ilevel: 0,
      crole: 'd',
    },
  };
  function extractInlineScript(filePath) {
    const txt = fs.readFileSync(filePath, 'utf8');
    const m = txt.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    return m ? m[1] : '';
  }
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  for (const [subdomain, tenant] of Object.entries(registry.tenants)) {
    const client = new Client({
      host: 'localhost',
      user: process.env.USER,
      database: tenant.database,
      port: tenant.port,
    });
    try {
      await client.connect();
      for (const [pkStr, cfg] of Object.entries(fragments)) {
        const pk = Number(pkStr);
        const filePath = path.join(__dirname, cfg.file);
        if (!fs.existsSync(filePath)) {
          console.log(
            `  sendemail menu seed: ${cfg.file} not found, skipping pk ${pk}`,
          );
          continue;
        }
        const jscript = extractInlineScript(filePath);
        await client.query(
          `INSERT INTO fommenu (pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, chtml, jscript, jqclass)
           VALUES ($1, 0, $2, $3, $4, $5, $6, '', '', $7, '')
           ON CONFLICT (pk) DO UPDATE SET
             cprompt = EXCLUDED.cprompt,
             isort   = EXCLUDED.isort,
             ilevel  = EXCLUDED.ilevel,
             crole   = EXCLUDED.crole,
             chref   = EXCLUDED.chref,
             jscript = EXCLUDED.jscript`,
          [
            pk,
            cfg.cprompt,
            cfg.isort,
            cfg.ilevel,
            cfg.crole,
            cfg.file,
            jscript,
          ],
        );
      }
    } catch (e) {
      console.log(
        `  sendemail menu seed skipped for ${subdomain}: ${e.message}`,
      );
    } finally {
      await client.end().catch(() => {});
    }
  }
}

// ── Per-tenant app seeding (Pattern B) ────────────────────────────────────────
// For each tenant that declares one or more apps, open a connection and run
// every app's seed() against it. Each app's seed is responsible for its own
// fommenu rows, sendemail campaigns, and any other per-tenant setup.
async function seedTenantApps() {
  for (const [prefix, apps] of Object.entries(TENANT_APPS)) {
    if (!apps.length) continue;
    const dbCfg = getTenantConfig(prefix);
    if (!dbCfg) continue;
    const client = new Client(dbCfg);
    try {
      await client.connect();
      for (const app of apps) {
        try {
          await app.seed(client, { prefix, app });
        } catch (e) {
          console.log(`  ${app.name} seed skipped for ${prefix}: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  tenant ${prefix} seed connection failed: ${e.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
}

// ── Startup migration: add password column + set default password ─────────────
async function migratePasswords() {
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  const defaultHash = hashPassword('6Yhhhnnn!23');
  for (const [subdomain, tenant] of Object.entries(registry.tenants)) {
    const config = {
      host: 'localhost',
      user: process.env.USER,
      database: tenant.database,
      port: tenant.port,
    };
    const client = new Client(config);
    try {
      await client.connect();
      await client.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS password varchar(200)`,
      );
      await client.query(
        `UPDATE users SET password = $1 WHERE password IS NULL`,
        [defaultHash],
      );
      console.log(`  Password migration done for tenant: ${subdomain}`);
    } catch (e) {
      console.log(
        `  Password migration skipped for ${subdomain}: ${e.message}`,
      );
    } finally {
      await client.end().catch(() => {});
    }
  }
}

console.log('Starting server.nnnn..');

const TENANTS_FILE = path.join(__dirname, 'tenants.json');

// Simple in-memory session store
const sessions = new Map();

function parseCookies(cookieStr) {
  if (!cookieStr) return {};
  return Object.fromEntries(
    cookieStr.split(';').map((c) =>
      c
        .trim()
        .split('=')
        .map((s) => decodeURIComponent(s.trim())),
    ),
  );
}

function getSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies.sid;
  if (!sid || !sessions.has(sid)) {
    sid = Math.random().toString(36).substring(2, 18);
    sessions.set(sid, { level: '0', role: '', loggedIn: false });
    res.setHeader('Set-Cookie', `sid=${sid}; Path=/`);
  }
  return sessions.get(sid);
}

function getTenantConfig(subdomain) {
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  const tenant = registry.tenants[subdomain];
  if (!tenant) return null;
  return {
    host: 'localhost',
    user: process.env.USER,
    database: tenant.database,
    port: tenant.port,
  };
}

function getAdminConfig() {
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  return {
    host: 'localhost',
    user: process.env.USER,
    database: registry.admin.database,
    port: registry.admin.port,
  };
}

// ── Multipart/form-data parser (no external deps) ────────────────────────────
function readRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: [] };
  const boundary = '--' + (m[1] || m[2]).trim();
  const boundaryBuf = Buffer.from(boundary);
  const fields = {};
  const files = [];

  let start = buffer.indexOf(boundaryBuf);
  if (start < 0) return { fields, files };
  start += boundaryBuf.length;

  while (start < buffer.length) {
    // Skip CRLF after boundary
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
    // End of body marker is "--"
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;

    const next = buffer.indexOf(boundaryBuf, start);
    if (next < 0) break;
    // Part ends with CRLF before boundary
    let partEnd = next;
    if (buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a)
      partEnd -= 2;

    // Split headers and body at first CRLFCRLF
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0 || headerEnd > partEnd) {
      start = next + boundaryBuf.length;
      continue;
    }
    const headerStr = buffer.slice(start, headerEnd).toString('utf8');
    const body = buffer.slice(headerEnd + 4, partEnd);

    const dispo = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(
      headerStr,
    );
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(headerStr);
    if (dispo) {
      const nameMatch = /name="([^"]*)"/i.exec(dispo[1]);
      const fileMatch = /filename="([^"]*)"/i.exec(dispo[1]);
      const name = nameMatch ? nameMatch[1] : '';
      if (fileMatch) {
        if (fileMatch[1]) {
          files.push({
            field: name,
            filename: fileMatch[1],
            contentType: ctype ? ctype[1].trim() : 'application/octet-stream',
            data: body,
          });
        }
      } else {
        fields[name] = body.toString('utf8');
      }
    }

    start = next + boundaryBuf.length;
  }

  return { fields, files };
}

async function getRex(prefix) {
  const client = new Client(getAdminConfig());
  try {
    await client.connect();
    const res = await client.query(
      'SELECT settings FROM rex_path WHERE prefix = $1',
      [prefix],
    );
    return res.rows[0]?.settings ?? {};
  } finally {
    await client.end().catch(() => {});
  }
}

async function buildUL(parentPK, client, ulId = '', role = '', level = 0) {
  const res = await client.query(
    `SELECT * FROM fommenu WHERE "parentpk" = $1
     AND (
       ("crole" IS NOT NULL AND "crole" <> '' AND $3 LIKE '%' || "crole" || '%')
       OR (COALESCE("crole",'') = '' AND "ilevel" <= $2)
     )
     ORDER BY "isort"`,
    [parentPK, level, role],
  );
  if (res.rows.length === 0) return '';

  let s = parentPK === 0 ? `<ul id="${ulId}">\n` : '<ul>\n';

  for (const row of res.rows) {
    const prompt = (row.cprompt || '').trim();
    const href = (row.chref || '').trim();
    const jqClass = (row.jqclass || '').trim().toUpperCase();
    const spanClass = row.class ? ` class="${row.class.trim()}"` : '';
    const id = row.pk;

    const children = await buildUL(id, client, '', role, level);

    if (children) {
      s += `<li><a href="#">${prompt}</a>\n${children}</li>\n`;
    } else {
      let anchor;
      if (jqClass === 'BLANK' || jqClass === 'FOM_BLANK') {
        anchor = `<a target="_blank" href="${href}" id="id${id}" name="id${id}" class="${row.jqclass}"><span${spanClass}>${prompt}</span></a>`;
      } else if (jqClass === 'SELF' || jqClass === 'FOM_SELF') {
        anchor = `<a href="${href}" id="id${id}" name="id${id}" class="${row.jqclass}"><span${spanClass}>${prompt}</span></a>`;
      } else if (jqClass === 'FOM-JS') {
        anchor = `<a href="javascript:${href}" id="id${id}" name="id${id}" class="${row.jqclass}"><span${spanClass}>${prompt}</span></a>`;
      } else if (jqClass === 'FOM-LC') {
        anchor = `<a href="#" id="id${id}" name="id${id}" class="${row.jqclass}"><span${spanClass}>${prompt}</span></a>`;
      } else if (href) {
        anchor = `<a href="${href}" id="id${id}" name="id${id}"><span>${prompt}</span></a>`;
      } else {
        anchor = `<a href="#" class="fom-lc" id="id${id}" name="id${id}"><span>${prompt}</span></a>`;
      }
      s += `<li>${anchor}</li>\n`;
    }
  }

  s += parentPK === 0 ? '</ul>\n' : '</ul>\n';
  return s;
}

const server = http.createServer(async (req, res) => {
  var xx = req.url;
  console.log('Received request for URL:', xx);
  const prefix = req.headers.host.split('.')[0];

  if (req.url.split('?')[0] === '/displaytools') {
    const session = getSession(req, res);
    const rexSettings = await getRex(prefix);
    const levels = (rexSettings.permissionLevels || []).filter(
      (p) => p.label !== 'Role Specific',
    );
    const roles = rexSettings.roles || [];

    const levelOptions = levels
      .map(
        (p) =>
          `<option value="${p.level}"${session.level == p.level ? ' selected' : ''}>${p.label}</option>`,
      )
      .join('\n');

    const roleCheckboxes = roles
      .map(
        (r) =>
          `<input class="setRole" type="checkbox" id="chkRole${r.code}" name="${r.code}" value="${r.code}"${session.role.includes(r.code) ? ' checked' : ''}> ${r.label}&nbsp;&nbsp;`,
      )
      .join('\n');

    const html =
      `<a target="_blank" href="./menubuilder.html" style="color:red;font-weight:bold">Open the Menu Builder</a>` +
      `&nbsp;&nbsp;&nbsp;&nbsp;Set Permission Level: ` +
      `<select id="cmbLevel" onchange="setPermissionLevel(this.value)">\n${levelOptions}\n</select>` +
      `&nbsp;&nbsp;&nbsp;&nbsp;Set Roles: ${roleCheckboxes}`;

    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    });
    res.end(html);
    return;
  }

  if (req.url.split('?')[0] === '/setPermissionLevel') {
    const session = getSession(req, res);
    const level = new URL(req.url, 'http://localhost').searchParams.get(
      'level',
    );
    session.level = level;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Saved: ' + new Date().toLocaleTimeString());
    return;
  }

  if (req.url.split('?')[0] === '/setRole') {
    const session = getSession(req, res);
    const params = new URL(req.url, 'http://localhost').searchParams;
    const value = params.get('value');
    const checked = params.get('checked') === 'true';
    if (checked && !session.role.includes(value)) {
      session.role = session.role + value;
    } else if (!checked) {
      session.role = session.role.replace(value, '');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Saved: ' + new Date().toLocaleTimeString());
    return;
  }

  // Doctor portal landing — clean URL for the emailed invitation link.
  // Forwards to the portal HTML with the credential carried in the query string.
  {
    const m = /^\/doctor\/auth\/([^/?]+)$/.exec(req.url.split('?')[0]);
    if (m) {
      res.writeHead(302, {
        Location: `/tenants/aaa/doctors/pages/portal.html?credential=${encodeURIComponent(m[1])}`,
      });
      res.end();
      return;
    }
  }

  if (req.url.split('?')[0] === '/fom') {
    const data = fs.readFileSync(path.join(__dirname, 'fom.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
    return;
  }

  if (req.url.split('?')[0] === '/getTable') {
    const raw =
      new URL(req.url, 'http://localhost').searchParams.get('name') || '';
    const parts = raw.split('.');
    const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    let schema, tableName;
    if (parts.length === 2 && ident.test(parts[0]) && ident.test(parts[1])) {
      schema = parts[0];
      tableName = parts[1];
    } else if (parts.length === 1 && ident.test(parts[0])) {
      schema = null;
      tableName = parts[0];
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid table name' }));
      return;
    }
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      if (!schema) {
        // No schema given — search all user schemas
        const found = await client.query(
          `SELECT table_schema FROM information_schema.tables
           WHERE table_name=$1 AND table_schema NOT IN ('pg_catalog','information_schema')`,
          [tableName],
        );
        if (!found.rows.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Table not found: ' + tableName }));
          return;
        }
        if (found.rows.length > 1) {
          const schemas = found.rows.map((r) => r.table_schema).join(', ');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Ambiguous — "${tableName}" exists in: ${schemas}. Use schema.table format.`,
            }),
          );
          return;
        }
        schema = found.rows[0].table_schema;
      } else {
        const exists = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
          [schema, tableName],
        );
        if (!exists.rows.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Table not found: ' + raw }));
          return;
        }
      }
      const fieldsParam = new URL(req.url, 'http://localhost').searchParams.get(
        'fields',
      );
      let selectCols = '*';
      if (fieldsParam) {
        const valid = fieldsParam
          .split(',')
          .map((f) => f.trim())
          .filter((f) => ident.test(f));
        if (valid.length) selectCols = valid.map((f) => `"${f}"`).join(', ');
      }
      const result = await client.query(
        `SELECT ${selectCols} FROM "${schema}"."${tableName}" LIMIT 2000`,
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          columns: result.fields.map((f) => f.name),
          rows: result.rows,
        }),
      );
    } finally {
      await client.end();
    }
    return;
  }

  if (req.url.split('?')[0] === '/loadPage') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        'SELECT pk, cprompt, chtml, cfunction, jscript, chref, private, objective FROM fommenu WHERE pk = $1',
        [id],
      );
      const row = result.rows[0];
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Menu item not found' }));
        return;
      }

      // Mirror widgetHTML() priority logic from minimumsupport.prg
      let html;
      const chtml = (row.chtml || '').trim();
      const cfunction = (row.cfunction || '').trim();
      let jscript = (row.jscript || '').trim();
      const chref = (row.chref || '').trim();
      // Tenant-isolated fragment name; wins over chref so a row with both
      // still resolves predictably.
      const privateName = (row.private || '').trim();
      const cprompt = (row.cprompt || '').trim();
      const objective = (row.objective || 'Objective not stated').trim();

      if (row.pk == 0) {
        html = '<p>Welcome</p>';
      } else if (privateName) {
        // Same guards as the /file route — reject path separators, parent-dir
        // traversal, and non-HTML extensions, then resolve under the tenant
        // folder inside TENANT_FILES_DIR.
        if (
          privateName.includes('/') ||
          privateName.includes('\\') ||
          privateName.includes('..') ||
          !/\.html?$/i.test(privateName)
        ) {
          html = `<p style="color:red">Invalid private filename: ${escapeHtml(privateName)}</p>`;
        } else {
          const tenantDir = path.join(TENANT_FILES_DIR, prefix);
          const filePath = path.join(tenantDir, privateName);
          if (
            !path
              .resolve(filePath)
              .startsWith(path.resolve(tenantDir) + path.sep)
          ) {
            html = `<p style="color:red">Invalid private path</p>`;
          } else {
            try {
              html = fs.readFileSync(filePath, 'utf8');
            } catch (e) {
              html = `<p style="color:red">Could not load private file: ${escapeHtml(privateName)}</p>`;
            }
          }
        }
      } else if (chref) {
        const fileName = chref.replace(/^\.\//, '');
        const filePath = path.join(__dirname, fileName);
        try {
          html = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
          html = `<p style="color:red">Could not load file: ${fileName}</p>`;
        }
      } else if (chtml && !cfunction) {
        html = chtml;
      } else if (cfunction) {
        const call = parseWidgetCall(cfunction);
        if (call && call.name === 'tabgenerator') {
          const out = await renderTabs(client, call.arg);
          html = out.html;
          jscript = out.jscript;
        } else if (call && call.name === 'accordion') {
          const out = await renderAccordion(client, call.arg);
          html = out.html;
          jscript = out.jscript;
        } else {
          html = `<p><em>Function not yet implemented: ${cfunction}</em></p>`;
        }
      } else if (jscript) {
        html = '';
      } else {
        html =
          `<h3>You selected <span style="color:red">${cprompt}</span>.<br><br>` +
          `The function for item #${row.pk} has not yet been defined.</h3>`;
      }

      // Build breadcrumbs by walking up parentpk chain (mirrors menuItemStats)
      const bcResult = await client.query(
        `
        WITH RECURSIVE bc AS (
          SELECT pk, parentpk, cprompt FROM fommenu WHERE pk = $1
          UNION ALL
          SELECT m.pk, m.parentpk, m.cprompt FROM fommenu m JOIN bc ON m.pk = bc.parentpk
        )
        SELECT cprompt FROM bc ORDER BY parentpk
      `,
        [id],
      );
      const breadcrumbs = bcResult.rows
        .map((r) => r.cprompt)
        .reverse()
        .join(', ');

      // Build status bar (mirrors menuItemStats)
      const session = getSession(req, res);
      const rexSettings = await getRex(prefix);
      const levels = rexSettings.permissionLevels || [];
      const roles = rexSettings.roles || [];
      const levelMatch = levels.find((p) => p.level == session.level);
      const levelLabel = levelMatch
        ? levelMatch.label
        : `Level ${session.level}`;
      const activeRoles = roles
        .filter((r) => session.role.includes(r.code))
        .map((r) => r.label);
      const rolesLabel = activeRoles.length
        ? activeRoles.join(', ')
        : 'No Roles Assigned';

      const status =
        `<b>Selected Menu:</b> ${breadcrumbs}` +
        `<span style="float:right"><b>Current User:</b> Guest User</span>` +
        `&nbsp;&nbsp;|&nbsp;&nbsp;<b>Permission Level:</b> ${levelLabel}` +
        `&nbsp;&nbsp;|&nbsp;&nbsp;<b>Roles:</b> ${rolesLabel}` +
        `&nbsp;&nbsp;|&nbsp;&nbsp;<b>Objective:</b> ${objective}`;

      await client.end();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(JSON.stringify({ html, jscript: jscript || null, status }));
    } catch (err) {
      await client.end().catch(() => {});
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.url.split('?')[0] === '/getSettings') {
    const rexSettings = await getRex(prefix);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(rexSettings));
    console.log('Sent settings for prefix', prefix, rexSettings);
    return;
  }

  if (req.url.split('?')[0] === '/saveSettings' && req.method === 'POST') {
    const colors = [
      'black',
      'dodgerblue',
      'crimson',
      'forestgreen',
      'fuchsia',
      'purple',
      'goldenrod',
      'navy',
    ];
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
    });
    const { permissionLevels, roles } = JSON.parse(body);
    const levelsWithColors = permissionLevels
      .slice()
      .sort((a, b) => a.level - b.level)
      .map((p, i) => ({
        level: p.level,
        label: p.label,
        color: colors[i % colors.length],
      }));
    const settings = JSON.stringify({
      permissionLevels: levelsWithColors,
      roles,
    });
    const client = new Client(getAdminConfig());
    try {
      await client.connect();
      await client.query(
        'UPDATE rex_path SET settings = $1 WHERE prefix = $2',
        [settings, prefix],
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/addMenu' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
    });
    const { text } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();

      // Parse text format: no prefix = top-level, . = second level, : = leaf
      const lines = text.split('\n');
      const items = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith(':')) {
          items.push({ prompt: trimmed.slice(1).trim(), level: 2 });
        } else if (trimmed.startsWith('.')) {
          items.push({ prompt: trimmed.slice(1).trim(), level: 1 });
        } else {
          items.push({ prompt: trimmed, level: 0 });
        }
      }

      const maxRes = await client.query(
        'SELECT COALESCE(MAX(pk), 0) + 1 AS next FROM fommenu',
      );
      let nextPk = parseInt(maxRes.rows[0].next);

      const isortMap = new Map();
      async function nextIsort(parentpk) {
        if (!isortMap.has(parentpk)) {
          const r = await client.query(
            'SELECT COALESCE(MAX(isort), 0) AS m FROM fommenu WHERE parentpk = $1',
            [parentpk],
          );
          isortMap.set(parentpk, parseInt(r.rows[0].m));
        }
        const val = isortMap.get(parentpk) + 10;
        isortMap.set(parentpk, val);
        return val;
      }

      let level0pk = 0,
        level1pk = 0;
      for (const item of items) {
        let parentpk;
        if (item.level === 0) {
          parentpk = 0;
          level0pk = nextPk;
          level1pk = 0;
        } else if (item.level === 1) {
          parentpk = level0pk || 0;
          level1pk = nextPk;
        } else {
          parentpk = level1pk || level0pk || 0;
        }
        const isort = await nextIsort(parentpk);
        await client.query(
          "INSERT INTO fommenu (pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, chtml, jscript, jqclass) VALUES ($1,$2,$3,$4,0,'','','','','','')",
          [nextPk, parentpk, item.prompt, isort],
        );
        nextPk++;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: items.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/getMenuBuilderData') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404);
      res.end('Unknown tenant');
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        'SELECT pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, jqclass FROM fommenu ORDER BY parentpk, isort',
      );
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.rows));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/fetchMenuNode') {
    console.log('Fetching menu node with URL:', req.url);
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404);
      res.end('Unknown tenant');
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const result = await client.query('SELECT * FROM fommenu WHERE pk = $1', [
        id,
      ]);
      if (!result.rows[0]) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const node = result.rows[0];
      // If parentpk points to a row that no longer exists, this node is an
      // orphan — buildUL never recurses into it, so it's invisible in every
      // menu. Reattach it at the top level (parentpk = 0, the virtual root)
      // and persist the fix so the node stays reachable.
      if (node.parentpk != null && node.parentpk !== 0) {
        const parentExists = await client.query(
          'SELECT 1 FROM fommenu WHERE pk = $1',
          [node.parentpk],
        );
        if (parentExists.rowCount === 0) {
          console.log(
            `fetchMenuNode: pk=${node.pk} had dangling parentpk=${node.parentpk}; resetting to 0`,
          );
          await client.query('UPDATE fommenu SET parentpk = 0 WHERE pk = $1', [
            node.pk,
          ]);
          node.parentpk = 0;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(node));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/updateMenuNode' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const {
      pk,
      cprompt,
      parentpk,
      ilevel,
      crole,
      chref,
      private: privateName, // rename: `private` is reserved in JS strict mode
      cfunction,
      chtml,
      jscript,
      jqclass,
    } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      await client.query(
        'UPDATE fommenu SET cprompt=$1, parentpk=$2, ilevel=$3, crole=$4, chref=$5, cfunction=$6, chtml=$7, jscript=$8, jqclass=$9, private=$10 WHERE pk=$11',
        [
          cprompt,
          parentpk ?? null,
          ilevel,
          crole || '',
          chref || '',
          cfunction || '',
          chtml || '',
          jscript || '',
          jqclass || '',
          privateName || '',
          pk,
        ],
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/moveMenuNode' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { child, parent, previous } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const siblingsRes = await client.query(
        'SELECT pk FROM fommenu WHERE parentpk=$1 AND pk<>$2 ORDER BY isort',
        [parent, child],
      );
      const siblings = siblingsRes.rows.map((r) => r.pk);
      let insertAt = previous ? Math.max(0, siblings.indexOf(previous) + 1) : 0;
      siblings.splice(insertAt, 0, child);
      for (let i = 0; i < siblings.length; i++) {
        await client.query(
          'UPDATE fommenu SET parentpk=$1, isort=$2 WHERE pk=$3',
          [parent, (i + 1) * 10, siblings[i]],
        );
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/deleteMenuNode' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { pk } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const delRes = await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT pk FROM fommenu WHERE pk = $1
           UNION ALL
           SELECT m.pk FROM fommenu m JOIN descendants d ON m.parentpk = d.pk
         )
         DELETE FROM fommenu WHERE pk IN (SELECT pk FROM descendants)`,
        [pk],
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deleted: delRes.rowCount }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/addMenuNode' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { parentpk, cprompt } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const pkRes = await client.query(
        'SELECT COALESCE(MAX(pk), 0) + 1 AS next FROM fommenu',
      );
      const newPk = parseInt(pkRes.rows[0].next);
      const sortRes = await client.query(
        'SELECT COALESCE(MAX(isort), 0) + 10 AS next FROM fommenu WHERE parentpk = $1',
        [parentpk],
      );
      const isort = parseInt(sortRes.rows[0].next);
      await client.query(
        "INSERT INTO fommenu (pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, chtml, jscript, jqclass) VALUES ($1,$2,$3,$4,0,'','','','','','')",
        [newPk, parentpk, cprompt, isort],
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pk: newPk }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  // ── Users CRUD ──────────────────────────────────────────────────────────────

  if (req.url.split('?')[0] === '/saveUser' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { id, firstname, lastname, email, phone, role, permission, active } =
      JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      if (id) {
        await client.query(
          `UPDATE users SET firstname=$1, lastname=$2, email=$3, phone=$4, role=$5, permission=$6, active=$7 WHERE id=$8`,
          [
            firstname,
            lastname,
            email || null,
            phone || null,
            role || 'user',
            permission || 0,
            active !== false,
            id,
          ],
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: parseInt(id) }));
      } else {
        const result = await client.query(
          `INSERT INTO users (firstname, lastname, email, phone, role, permission, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            firstname,
            lastname,
            email || null,
            phone || null,
            role || 'user',
            permission || 0,
            active !== false,
          ],
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: result.rows[0].id }));
      }
    } finally {
      await client.end();
    }
    return;
  }

  if (req.url.split('?')[0] === '/deleteUser' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { id } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      await client.query('DELETE FROM users WHERE id=$1', [id]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } finally {
      await client.end();
    }
    return;
  }

  if (req.url.split('?')[0] === '/importCSV' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { rows } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    const client = new Client(dbConfig);
    try {
      await client.connect();
      let inserted = 0;
      for (const r of rows) {
        const fn = (r.firstname || r.first_name || r.first || '').trim();
        const ln = (r.lastname || r.last_name || r.last || '').trim();
        if (!fn && !ln) continue;
        await client.query(
          `INSERT INTO users (firstname, lastname, email, phone, role, active)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT DO NOTHING`,
          [
            fn,
            ln,
            r.email || null,
            r.phone || null,
            r.role || 'user',
            r.active !== 'false',
          ],
        );
        inserted++;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ inserted }));
    } finally {
      await client.end();
    }
    return;
  }

  // ── End Users CRUD ──────────────────────────────────────────────────────────

  // ── Auth endpoints ────────────────────────────────────────────────────────

  if (req.url.split('?')[0] === '/menuClick') {
    const session = getSession(req, res);
    const pk = new URL(req.url, 'http://x').searchParams.get('pk');
    if (!pk) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing pk' }));
      return;
    }
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const { rows } = await client.query(
        'SELECT pk, chref, cfunction, chtml, jscript, ilevel, crole FROM fommenu WHERE pk = $1',
        [pk],
      );
      const row = rows[0];
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Menu item not found' }));
        return;
      }
      const hasRole = !!(row.crole && row.crole.length);
      const ilevel = Number(row.ilevel) || 0;
      const sessionLevel = Number(session.level) || 0;
      const roleOk =
        hasRole && session.role && session.role.includes(row.crole);
      const levelOk = !hasRole && sessionLevel >= ilevel;
      const guestOk = !hasRole && ilevel === 0;

      if (!guestOk && !roleOk && !levelOk) {
        if (!session.loggedIn) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ needsLogin: true, pk: Number(pk) }));
          return;
        }
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Insufficient permission',
            required: hasRole ? `role:${row.crole}` : ilevel,
            have: hasRole ? session.role || '' : sessionLevel,
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          pk: row.pk,
          chref: row.chref || '',
          cfunction: row.cfunction || '',
          chtml: row.chtml || '',
          jscript: row.jscript || '',
        }),
      );
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/checkLogin') {
    const session = getSession(req, res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        loggedIn: !!session.loggedIn,
        name: session.name || '',
        level: session.level || '',
        role: session.role || '',
        userId: session.userId || null,
      }),
    );
    return;
  }

  if (req.url.split('?')[0] === '/login' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { email, password } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const result = await client.query(
        'SELECT * FROM users WHERE email = $1 AND active = true',
        [email],
      );
      const user = result.rows[0];
      if (!user || !user.password || !verifyPassword(password, user.password)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid email or password' }));
        return;
      }
      const session = getSession(req, res);
      session.loggedIn = true;
      session.userId = user.id;
      session.name = user.firstname;
      session.level = String(user.permission ?? 0);
      session.role = user.role || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: user.firstname }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/signup' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { firstname, lastname, email, password } = JSON.parse(body);
    if (!firstname || !lastname || !email || !password) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'All fields are required' }));
      return;
    }
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const exists = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [email],
      );
      if (exists.rows.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email already registered' }));
        return;
      }
      const pw = hashPassword(password);
      const ins = await client.query(
        `INSERT INTO users (firstname, lastname, email, password, permission, role, active)
         VALUES ($1, $2, $3, $4, 0, '', true) RETURNING id`,
        [firstname, lastname, email, pw],
      );
      const session = getSession(req, res);
      session.loggedIn = true;
      session.userId = ins.rows[0].id;
      session.name = firstname;
      session.level = '0';
      session.role = '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: firstname }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/logout') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.sid) sessions.delete(cookies.sid);
    res.writeHead(302, { Location: '/login.html?loggedOut=1' });
    res.end();
    return;
  }

  // ── End Auth ──────────────────────────────────────────────────────────────

  if (req.url.split('?')[0] === '/getMenu') {
    const data = fs.readFileSync(path.join(__dirname, 'getMenu.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
    return;
  }

  if (req.url.split('?')[0] === '/get3Versions') {
    const data = fs.readFileSync(path.join(__dirname, 'get3Versions.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
    return;
  }

  if (req.url.split('?')[0] === '/getTreeView') {
    const data = fs.readFileSync(path.join(__dirname, 'getTreeView.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
    return;
  }

  if (req.url.split('?')[0] === '/getMenuData') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Unknown tenant: ${prefix}`);
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const session = getSession(req, res);
      const ul = await buildUL(
        0,
        client,
        'flyoutmenu',
        session.role,
        session.level,
      );
      await client.end();
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(ul);
    } catch (err) {
      await client.end().catch(() => {});
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + err.message);
    }
    return;
  }

  if (req.url.split('?')[0] === '/getRawMenuData') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Unknown tenant: ${prefix}`);
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const session = getSession(req, res);
      const ul = await buildUL(
        0,
        client,
        'rawmenu',
        session.role,
        session.level,
      );
      await client.end();
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(ul);
    } catch (err) {
      await client.end().catch(() => {});
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + err.message);
    }
    return;
  }

  if (req.url.split('?')[0] === '/getTreeViewData') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Unknown tenant: ${prefix}`);
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const session = getSession(req, res);
      const ul = await buildUL(
        0,
        client,
        'treeview',
        session.role,
        session.level,
      );
      await client.end();
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(ul);
    } catch (err) {
      await client.end().catch(() => {});
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + err.message);
    }
    return;
  }

  if (req.url.split('?')[0] === '/runQuery' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    const { sql } = JSON.parse(body);
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown tenant: ${prefix}` }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const t0 = Date.now();
      const result = await client.query(sql);
      const ms = Date.now() - t0;
      const columns = (result.fields || []).map((f) => f.name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          columns,
          rows: result.rows,
          rowCount: result.rowCount,
          ms,
        }),
      );
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/uploadPhotos' && req.method === 'POST') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unknown tenant' }));
      return;
    }
    try {
      const buf = await readRequestBuffer(req);
      const { fields, files } = parseMultipart(
        buf,
        req.headers['content-type'],
      );
      if (!files.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No files received' }));
        return;
      }

      const uploadDir = path.join(__dirname, 'uploads', 'photos', prefix);
      fs.mkdirSync(uploadDir, { recursive: true });

      const session = getSession(req, res);
      const userId = session.userId || null;
      const title = (fields.title || '').slice(0, 100);
      const caption = fields.caption || '';
      const igroup = parseInt(fields.igroup, 10) || 0;

      const client = new Client(dbConfig);
      const saved = [];
      try {
        await client.connect();
        await client.query(`
          CREATE TABLE IF NOT EXISTS photos (
            id SERIAL PRIMARY KEY,
            title VARCHAR(100),
            caption TEXT,
            igroup INT DEFAULT 0,
            filename TEXT,
            originalname TEXT,
            mimetype VARCHAR(100),
            sizebytes INT,
            uploaded_by INT,
            uploaded_at TIMESTAMP DEFAULT NOW()
          )
        `);

        for (const f of files) {
          if (!/^image\//i.test(f.contentType)) continue;
          const ext = path.extname(f.filename).slice(0, 10) || '.bin';
          const safeBase =
            crypto.randomBytes(8).toString('hex') + '_' + Date.now();
          const storedName = safeBase + ext;
          const fullPath = path.join(uploadDir, storedName);
          fs.writeFileSync(fullPath, f.data);

          // Best-effort thumbnail — a failure here must not fail the upload.
          try {
            await makeThumb(fullPath, thumbPathFor(prefix, storedName));
          } catch (e) {
            console.error(
              'uploadPhotos: thumbnail failed for',
              storedName,
              '-',
              e.message,
            );
          }

          const ins = await client.query(
            `INSERT INTO photos (title, caption, igroup, filename, originalname, mimetype, sizebytes, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              title,
              caption,
              igroup,
              storedName,
              f.filename,
              f.contentType,
              f.data.length,
              userId,
            ],
          );
          saved.push({
            id: ins.rows[0].id,
            filename: storedName,
            originalname: f.filename,
            size: f.data.length,
          });
        }
      } finally {
        await client.end().catch(() => {});
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: saved.length, files: saved }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.url.split('?')[0] === '/photo-meta') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const id = params.get('id');
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id parameter required' }));
      return;
    }

    const client = new Client(dbConfig);
    try {
      await client.connect();
      const r = await client.query(
        'SELECT title, caption FROM photos WHERE id = $1',
        [id],
      );
      if (r.rows[0]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            title: r.rows[0].title || '',
            caption: r.rows[0].caption || '',
          }),
        );
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Photo not found' }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/photo') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const id = params.get('id');
    const nameParam = params.get('name');
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Unknown tenant');
      return;
    }

    const mimeByExt = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };

    let filename = null;
    let mimetype = null;

    if (id) {
      const client = new Client(dbConfig);
      try {
        await client.connect();
        const r = await client.query(
          'SELECT filename, mimetype FROM photos WHERE id = $1',
          [id],
        );
        if (r.rows[0]) {
          filename = r.rows[0].filename;
          mimetype = r.rows[0].mimetype;
        }
      } catch (e) {
        // Table may not exist yet
      } finally {
        await client.end().catch(() => {});
      }
    } else if (nameParam) {
      // Reject anything that tries to escape the tenant folder
      if (
        nameParam.includes('/') ||
        nameParam.includes('\\') ||
        nameParam.includes('..')
      ) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid filename');
        return;
      }
      filename = nameParam;
    }

    if (!filename) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Photo not found');
      return;
    }

    const fullPath = path.join(
      __dirname,
      'uploads',
      'photos',
      prefix,
      filename,
    );
    // Final guard: resolved path must stay inside the tenant folder
    const tenantDir = path.join(__dirname, 'uploads', 'photos', prefix);
    if (
      !path.resolve(fullPath).startsWith(path.resolve(tenantDir) + path.sep)
    ) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      const ext = path.extname(filename).toLowerCase();
      const ct = mimetype || mimeByExt[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(data);
    });
    return;
  }

  if (req.url.split('?')[0] === '/photo-thumb') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Unknown tenant');
      return;
    }
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('id parameter required');
      return;
    }

    // Look up the stored filename for this photo id.
    let filename = null;
    let mimetype = null;
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const r = await client.query(
        'SELECT filename, mimetype FROM photos WHERE id = $1',
        [id],
      );
      if (r.rows[0]) {
        filename = r.rows[0].filename;
        mimetype = r.rows[0].mimetype;
      }
    } catch (e) {
      // photos table may not exist yet — fall through to 404
    } finally {
      await client.end().catch(() => {});
    }
    if (!filename) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Photo not found');
      return;
    }

    const srcPath = path.join(__dirname, 'uploads', 'photos', prefix, filename);
    const thumbPath = thumbPathFor(prefix, filename);

    // Serve the cached thumbnail; build it on first miss so photos uploaded
    // before thumbnails existed are covered too. If resizing fails (corrupt or
    // unsupported source), fall back to the original so the gallery still
    // shows something.
    try {
      if (!fs.existsSync(thumbPath)) {
        await makeThumb(srcPath, thumbPath);
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(fs.readFileSync(thumbPath));
    } catch (e) {
      console.error('photo-thumb failed for id', id, '-', e.message);
      fs.readFile(srcPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Thumbnail unavailable');
          return;
        }
        res.writeHead(200, {
          'Content-Type': mimetype || 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
      });
    }
    return;
  }

  if (req.url.split('?')[0] === '/photo-update' && req.method === 'POST') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unknown tenant' }));
      return;
    }
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      return;
    }
    const id = parseInt(payload.id, 10);
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'id required' }));
      return;
    }
    // title is varchar(100); caption is text. Mirror the upload route's clamp.
    const title = String(payload.title || '').slice(0, 100);
    const caption = String(payload.caption || '');
    const client = new Client(dbConfig);
    try {
      await client.connect();
      const r = await client.query(
        'UPDATE photos SET title = $1, caption = $2 WHERE id = $3',
        [title, caption, id],
      );
      if (r.rowCount === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Photo not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, title, caption }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/photo-delete' && req.method === 'POST') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unknown tenant' }));
      return;
    }
    const body = await new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      return;
    }
    const id = parseInt(payload.id, 10);
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'id required' }));
      return;
    }
    const client = new Client(dbConfig);
    try {
      await client.connect();
      // Read the filename first so the files can be removed after the row.
      const r = await client.query(
        'SELECT filename FROM photos WHERE id = $1',
        [id],
      );
      if (!r.rows[0]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Photo not found' }));
        return;
      }
      await client.query('DELETE FROM photos WHERE id = $1', [id]);
      // Remove the image file and its cached thumbnail (best-effort).
      const filename = r.rows[0].filename;
      if (filename) {
        try {
          fs.unlinkSync(
            path.join(__dirname, 'uploads', 'photos', prefix, filename),
          );
        } catch (e) {}
        try {
          fs.unlinkSync(thumbPathFor(prefix, filename));
        } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  if (req.url.split('?')[0] === '/file') {
    // Tenant-isolated HTML fragment server. Files live under
    // TENANT_FILES_DIR/<prefix>/ which sits OUTSIDE __dirname, so the static
    // handler at the bottom of this file cannot reach them — every read goes
    // through this gated route and resolves to the requesting tenant only.
    const name = new URL(req.url, 'http://localhost').searchParams.get('html');
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('html parameter required');
      return;
    }
    // Reject path separators, parent-dir traversal, and non-HTML extensions.
    if (
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('..') ||
      !/\.html?$/i.test(name)
    ) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const tenantDir = path.join(TENANT_FILES_DIR, prefix);
    const fullPath = path.join(tenantDir, name);
    // Belt-and-braces guard: resolved path must stay inside the tenant folder.
    if (
      !path.resolve(fullPath).startsWith(path.resolve(tenantDir) + path.sep)
    ) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
    return;
  }

  // Widget endpoints: POST /widget (create), GET /widget/:id, PUT /widget/:id, DELETE /widget/:id
  if (req.url.split('?')[0] === '/widget' && req.method === 'POST') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      const client = new Client(dbConfig);
      try {
        const data = JSON.parse(body);
        await client.connect();
        const result = await client.query(
          'INSERT INTO widgets (chead, cbody, igroup, jscript) VALUES ($1, $2, $3, $4) RETURNING id',
          [
            data.chead || '',
            data.cbody || '',
            data.igroup || 0,
            data.jscript || '',
          ],
        );
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: result.rows[0].id, success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
    });
    return;
  }

  const widgetMatch = req.url.match(/^\/widget\/(\d+)(\?.*)?$/);
  if (widgetMatch) {
    const widgetId = widgetMatch[1];
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return;
    }
    const client = new Client(dbConfig);

    if (req.method === 'GET') {
      try {
        await client.connect();
        const result = await client.query(
          'SELECT id, chead, cbody, igroup, jscript FROM widgets WHERE id = $1',
          [widgetId],
        );
        if (!result.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Widget not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.rows[0]));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          await client.connect();
          const result = await client.query(
            'UPDATE widgets SET chead = $1, cbody = $2, igroup = $3, jscript = $4 WHERE id = $5 RETURNING id',
            [
              data.chead || '',
              data.cbody || '',
              data.igroup || 0,
              data.jscript || '',
              widgetId,
            ],
          );
          if (!result.rows[0]) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Widget not found' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: widgetId, success: true }));
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          await client.end().catch(() => {});
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      try {
        await client.connect();
        const result = await client.query(
          'DELETE FROM widgets WHERE id = $1 RETURNING id',
          [widgetId],
        );
        if (!result.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Widget not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: widgetId, success: true }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }
  }

  // Movie endpoints: POST /movie (create), GET /movie/:id, PUT /movie/:id, DELETE /movie/:id
  // List is served by the generic /getTable?name=movies route.
  const numOrNull = (v) =>
    v === '' || v === null || v === undefined ? null : v;
  if (req.url.split('?')[0] === '/movie' && req.method === 'POST') {
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      const client = new Client(dbConfig);
      try {
        const data = JSON.parse(body);
        await client.connect();
        const result = await client.query(
          'INSERT INTO movies (performer_name, movie_name, character_name, rating, box_office) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [
            data.performer_name || '',
            data.movie_name || '',
            data.character_name || '',
            numOrNull(data.rating),
            numOrNull(data.box_office),
          ],
        );
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: result.rows[0].id, success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
    });
    return;
  }

  const movieMatch = req.url.match(/^\/movie\/(\d+)(\?.*)?$/);
  if (movieMatch) {
    const movieId = movieMatch[1];
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return;
    }
    const client = new Client(dbConfig);

    if (req.method === 'GET') {
      try {
        await client.connect();
        const result = await client.query(
          'SELECT id, performer_name, movie_name, character_name, rating, box_office FROM movies WHERE id = $1',
          [movieId],
        );
        if (!result.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Movie not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.rows[0]));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          await client.connect();
          const result = await client.query(
            'UPDATE movies SET performer_name = $1, movie_name = $2, character_name = $3, rating = $4, box_office = $5 WHERE id = $6 RETURNING id',
            [
              data.performer_name || '',
              data.movie_name || '',
              data.character_name || '',
              numOrNull(data.rating),
              numOrNull(data.box_office),
              movieId,
            ],
          );
          if (!result.rows[0]) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Movie not found' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: movieId, success: true }));
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          await client.end().catch(() => {});
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      try {
        await client.connect();
        const result = await client.query(
          'DELETE FROM movies WHERE id = $1 RETURNING id',
          [movieId],
        );
        if (!result.rows[0]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Movie not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: movieId, success: true }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }
  }

  // ── /api/sendemail/* routes ────────────────────────────────────────────────
  if (req.url.split('?')[0].startsWith('/api/sendemail/')) {
    const session = getSession(req, res);
    const dbConfig = getTenantConfig(prefix);
    if (!dbConfig) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown tenant' }));
      return;
    }
    const sub = req.url.split('?')[0].slice('/api/sendemail/'.length);

    const readJson = () =>
      new Promise((resolve) => {
        let d = '';
        req.on('data', (c) => (d += c));
        req.on('end', () => {
          try {
            resolve(d ? JSON.parse(d) : {});
          } catch {
            resolve({});
          }
        });
      });

    const sendJson = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    // Resolve a campaign row + its effective SQL + bind values.
    async function resolveCampaign(client, id) {
      const r = await client.query('SELECT * FROM sendemail WHERE id = $1', [
        id,
      ]);
      const row = r.rows[0];
      if (!row) return { error: 'Campaign not found' };
      if (row.qtype === 'raw') {
        return { row, sql: row.query, values: [] };
      }
      const sq = getSavedQueries(prefix)[row.qname];
      if (!sq)
        return {
          error: `Saved query "${row.qname}" is not registered for tenant "${prefix}"`,
        };
      const values = (sq.params || []).map(
        (p) => (row.qparams || {})[p.name] ?? null,
      );
      return { row, sql: sq.sql, values };
    }

    try {
      // GET /api/sendemail/savedQueries  → registry metadata for the UI
      if (sub === 'savedQueries' && req.method === 'GET') {
        const out = Object.entries(getSavedQueries(prefix)).map(
          ([name, q]) => ({
            name,
            label: q.label,
            params: q.params || [],
          }),
        );
        sendJson(200, out);
        return;
      }

      // GET /api/sendemail/list?qtype=raw|saved
      if (sub === 'list' && req.method === 'GET') {
        const qtype = new URL(req.url, 'http://localhost').searchParams.get(
          'qtype',
        );
        const client = new Client(dbConfig);
        try {
          await client.connect();
          if (
            qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          const r = qtype
            ? await client.query(
                'SELECT id, name, qtype, qname, qparams FROM sendemail WHERE qtype = $1 ORDER BY name',
                [qtype],
              )
            : await client.query(
                'SELECT id, name, qtype, qname, qparams FROM sendemail ORDER BY qtype, name',
              );
          sendJson(200, r.rows);
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // GET /api/sendemail/load?id=X  → full row (raw rows require developer)
      if (sub === 'load' && req.method === 'GET') {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        const client = new Client(dbConfig);
        try {
          await client.connect();
          const r = await client.query(
            'SELECT * FROM sendemail WHERE id = $1',
            [id],
          );
          const row = r.rows[0];
          if (!row) {
            sendJson(404, { error: 'Not found' });
            return;
          }
          if (
            row.qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          sendJson(200, row);
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // POST /api/sendemail/recipients  body: { id }
      if (sub === 'recipients' && req.method === 'POST') {
        const { id } = await readJson();
        const client = new Client(dbConfig);
        try {
          await client.connect();
          const c = await resolveCampaign(client, id);
          if (c.error) {
            sendJson(400, c);
            return;
          }
          if (
            c.row.qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          const r = await client.query(c.sql, c.values);
          const preview = r.rows.length
            ? fillLetter(c.row.letter, r.rows[0])
            : '';
          sendJson(200, {
            count: r.rows.length,
            rows: r.rows,
            letter: c.row.letter,
            preview,
            name: c.row.name,
          });
        } catch (e) {
          sendJson(400, { error: e.message });
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // POST /api/sendemail/test  body: { id }
      // Sends the rendered letter (using first row) to the logged-in user's email.
      if (sub === 'test' && req.method === 'POST') {
        if (!session.loggedIn || !session.userId) {
          sendJson(401, { error: 'Login required' });
          return;
        }
        const { id } = await readJson();
        const client = new Client(dbConfig);
        try {
          await client.connect();
          const u = await client.query(
            'SELECT email, firstname FROM users WHERE id = $1',
            [session.userId],
          );
          const me = u.rows[0];
          if (!me || !me.email) {
            sendJson(400, { error: 'Your user record has no email address' });
            return;
          }
          const c = await resolveCampaign(client, id);
          if (c.error) {
            sendJson(400, c);
            return;
          }
          if (
            c.row.qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          const r = await client.query(c.sql, c.values);
          const sample = r.rows[0] || {
            email: me.email,
            firstname: me.firstname,
          };
          const html = fillLetter(c.row.letter, sample);
          await sendMail({
            to: me.email,
            subject: `[TEST] ${c.row.name}`,
            html,
            text: html.replace(/<[^>]+>/g, ''),
          });
          sendJson(200, { ok: true, sentTo: me.email });
        } catch (e) {
          sendJson(500, { error: e.message });
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // POST /api/sendemail/transmit  body: { id, emails: [...] }
      // Sends the campaign letter to each address in `emails` (must intersect
      // the recipient set returned by the campaign's query).
      if (sub === 'transmit' && req.method === 'POST') {
        const { id, emails } = await readJson();
        if (!Array.isArray(emails) || emails.length === 0) {
          sendJson(400, { error: 'No recipients selected' });
          return;
        }
        const client = new Client(dbConfig);
        try {
          await client.connect();
          const c = await resolveCampaign(client, id);
          if (c.error) {
            sendJson(400, c);
            return;
          }
          if (
            c.row.qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          const r = await client.query(c.sql, c.values);
          const allowed = new Set(emails);
          // Dedupe by email — keep the first row for each address so we don't
          // send twice when the campaign query returns the same email more than once.
          const seen = new Set();
          const targets = [];
          for (const row of r.rows) {
            if (!allowed.has(row.email) || seen.has(row.email)) continue;
            seen.add(row.email);
            targets.push(row);
          }
          let sent = 0;
          const errors = [];
          for (const row of targets) {
            try {
              const html = fillLetter(c.row.letter, row);
              await sendMail({
                to: row.email,
                subject: c.row.name,
                html,
                text: html.replace(/<[^>]+>/g, ''),
              });
              sent++;
            } catch (e) {
              errors.push({ email: row.email, error: e.message });
            }
          }
          sendJson(200, { ok: true, sent, attempted: targets.length, errors });
        } catch (e) {
          sendJson(500, { error: e.message });
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // POST /api/sendemail/save  body: { id?, name, qtype, query?, qname?, qparams?, letter }
      // Insert/update. Raw rows require developer role.
      if (sub === 'save' && req.method === 'POST') {
        const body = await readJson();
        const { id, name, qtype, query, qname, qparams, letter } = body;
        if (!name || !qtype || (qtype !== 'raw' && qtype !== 'saved')) {
          sendJson(400, { error: 'name and qtype are required' });
          return;
        }
        const client = new Client(dbConfig);
        try {
          await client.connect();
          if (
            qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          if (id) {
            const r = await client.query(
              `UPDATE sendemail SET name=$1, qtype=$2, query=$3, qname=$4, qparams=$5, letter=$6
               WHERE id=$7 RETURNING id`,
              [
                name,
                qtype,
                query || null,
                qname || null,
                qparams || null,
                letter || '',
                id,
              ],
            );
            sendJson(200, { ok: true, id: r.rows[0]?.id });
          } else {
            const r = await client.query(
              `INSERT INTO sendemail (name, qtype, query, qname, qparams, letter)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
              [
                name,
                qtype,
                query || null,
                qname || null,
                qparams || null,
                letter || '',
              ],
            );
            sendJson(200, { ok: true, id: r.rows[0].id });
          }
        } catch (e) {
          sendJson(400, { error: e.message });
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      // POST /api/sendemail/delete  body: { id }
      if (sub === 'delete' && req.method === 'POST') {
        const { id } = await readJson();
        const client = new Client(dbConfig);
        try {
          await client.connect();
          const r = await client.query(
            'SELECT qtype FROM sendemail WHERE id=$1',
            [id],
          );
          if (!r.rows[0]) {
            sendJson(404, { error: 'Not found' });
            return;
          }
          if (
            r.rows[0].qtype === 'raw' &&
            !(await hasRawAccess(prefix, client, session))
          ) {
            sendJson(403, { error: 'Access denied' });
            return;
          }
          await client.query('DELETE FROM sendemail WHERE id=$1', [id]);
          sendJson(200, { ok: true });
        } finally {
          await client.end().catch(() => {});
        }
        return;
      }

      sendJson(404, { error: 'Unknown sendemail route' });
      return;
    } catch (e) {
      sendJson(500, { error: e.message });
      return;
    }
  }

  // ── Tenant app routes (Pattern B dispatch) ──────────────────────────────────
  for (const app of TENANT_APPS[prefix] || []) {
    const handled = await app.routes.handle(req, res, {
      prefix,
      getSession,
      getTenantConfig,
      parseMultipart,
      readRequestBuffer,
    });
    if (handled) return;
  }

  const urlPath = req.url.split('?')[0];
  const filePath = path.join(
    __dirname,
    urlPath === '/' ? '/index.html' : urlPath,
  );
  // Reject path-traversal. Without this, a raw client can send
  // GET /../tenant-files/aaa/Giselle.htm and reach files outside __dirname,
  // which would defeat the /file route's tenant isolation.
  if (!path.resolve(filePath).startsWith(path.resolve(__dirname) + path.sep)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid path');
    return;
  }
  // Only site files are public. Refuse dotfiles (.env holds SMTP creds),
  // Postgres data directories (any top-level folder with a PG_VERSION file),
  // server-side folders, top-level dumps/logs, and the tenant registry.
  const segments = path.relative(__dirname, path.resolve(filePath)).split(path.sep);
  const top = segments[0];
  if (
    segments.some((s) => s.startsWith('.')) ||
    ['node_modules', 'uploads', 'db', 'tenants.json'].includes(top) ||
    (segments.length === 1 && /\.(sql|log)$/i.test(top)) ||
    (segments.length > 1 && fs.existsSync(path.join(__dirname, top, 'PG_VERSION')))
  ) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${prefix} Hello, World! Good Stuff ok` + prefix);
      return;
    }
    res.writeHead(200, {
      'Content-Type': urlPath.endsWith('.html')
        ? 'text/html'
        : urlPath.endsWith('.css')
          ? 'text/css'
          : urlPath.endsWith('.js')
            ? 'application/javascript'
            : 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
  });
});

server.listen(3000, async () => {
  console.log('Server running at http://127.0.0.1:3000/');
  ensureTenantFileDirs();
  await migrateSendemail();
  await seedSendemailMenu();
  await seedTenantApps();
});
