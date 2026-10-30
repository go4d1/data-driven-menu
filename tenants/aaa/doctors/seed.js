// Per-tenant startup seed for the doctors app.
// Runs once at server boot against the tenant's DB connection.
// Idempotent: ON CONFLICT updates existing rows, sendemail campaigns matched by name.

const fs = require('fs');
const path = require('path');

const PARENT_PK = 101230;
const PAGES = {
  101231: { file: 'pages/dashboard.html',       cprompt: 'Dashboard',         isort: 1 },
  101232: { file: 'pages/upload-doctors.html',  cprompt: 'Upload Doctors',    isort: 2 },
  101233: { file: 'pages/browse-doctors.html',  cprompt: 'Browse Doctors',    isort: 3 },
  101234: { file: 'pages/upload-offices.html',  cprompt: 'Upload Offices',    isort: 4 },
  101235: { file: 'pages/browse-offices.html',  cprompt: 'Browse Offices',    isort: 5 },
  101236: { file: 'pages/followup-emails.html', cprompt: 'Follow-up Emails',  isort: 6 },
  101237: { file: 'pages/reports.html',         cprompt: 'Reports',           isort: 7 },
  101238: { file: 'pages/settings.html',        cprompt: 'Settings',          isort: 8 },
};

function extractInlineScript(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const m = txt.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  return m ? m[1] : '';
}

module.exports = async function seed(client, ctx) {
  // ── Menu rows ─────────────────────────────────────────────────────────────
  await client.query(
    `INSERT INTO fommenu (pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, chtml, jscript, jqclass)
     VALUES ($1, 0, 'Doctors', 100, 0, '', '', '', '', '', '')
     ON CONFLICT (pk) DO UPDATE SET cprompt = EXCLUDED.cprompt, isort = EXCLUDED.isort`,
    [PARENT_PK],
  );
  for (const [pkStr, cfg] of Object.entries(PAGES)) {
    const pk = Number(pkStr);
    const absPath = path.join(__dirname, cfg.file);
    if (!fs.existsSync(absPath)) {
      console.log(`  doctors seed: ${cfg.file} not found, skipping pk ${pk}`);
      continue;
    }
    // chref is the path relative to project root (what /loadPage will resolve).
    const chref = path.join(ctx.app._appDir, cfg.file);
    const jscript = extractInlineScript(absPath);
    await client.query(
      `INSERT INTO fommenu (pk, parentpk, cprompt, isort, ilevel, crole, chref, cfunction, chtml, jscript, jqclass)
       VALUES ($1, $2, $3, $4, 0, '', $5, '', '', $6, 'fom-lc')
       ON CONFLICT (pk) DO UPDATE SET
         cprompt = EXCLUDED.cprompt,
         isort   = EXCLUDED.isort,
         chref   = EXCLUDED.chref,
         jscript = EXCLUDED.jscript,
         jqclass = EXCLUDED.jqclass`,
      [pk, PARENT_PK, cfg.cprompt, cfg.isort, chref, jscript],
    );
  }

  // ── Sendemail campaigns ───────────────────────────────────────────────────
  const defaultBaseUrl = process.env.BASE_URL || 'http://aaa.localhost:3000';
  const invitationLetter = `
    <h2>Doctor Credentialing Portal Invitation</h2>
    <p>Dear {{firstname}} {{lastname}},</p>
    <p>Thank you for being part of our credentialing initiative. Please click the link below to access the portal and provide your state credentials and office assignments.</p>
    <p><a href="{{base_url}}/doctor/auth/{{id}}~{{invitation_token}}" style="padding:10px 20px;background:#007bff;color:white;text-decoration:none;border-radius:5px;">Access Credentialing Portal</a></p>
    <p>This link is unique to you and will not expire.</p>
    <p>Thank you,<br/>Credentialing Team</p>
  `.trim();
  const followupLetter = `
    <h2>Reminder: Please Complete Your Professional Credentials</h2>
    <p>Dear {{firstname}} {{lastname}},</p>
    <p>This is a friendly reminder to complete your credentialing submission. Please click the link below to access the portal.</p>
    <p><a href="{{base_url}}/doctor/auth/{{id}}~{{invitation_token}}" style="padding:10px 20px;background:#007bff;color:white;text-decoration:none;border-radius:5px;">Access Credentialing Portal</a></p>
    <p>Thank you,<br/>Credentialing Team</p>
  `.trim();
  const campaigns = [
    { name: 'Doctor Invitations', qname: 'doctor_invitations', qparams: { base_url: defaultBaseUrl },            letter: invitationLetter },
    { name: 'Doctor Follow-ups',  qname: 'doctor_followups',   qparams: { days: '7', base_url: defaultBaseUrl }, letter: followupLetter },
  ];
  for (const c of campaigns) {
    const ex = await client.query(
      `SELECT id FROM sendemail WHERE name = $1 AND qtype = 'saved'`,
      [c.name],
    );
    if (ex.rows[0]) {
      await client.query(
        `UPDATE sendemail SET qname = $1, qparams = $2, letter = $3 WHERE id = $4`,
        [c.qname, c.qparams, c.letter, ex.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO sendemail (name, qtype, qname, qparams, letter)
         VALUES ($1, 'saved', $2, $3, $4)`,
        [c.name, c.qname, c.qparams, c.letter],
      );
    }
  }
};
