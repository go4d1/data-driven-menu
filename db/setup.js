#!/usr/bin/env node
// Builds every PostgreSQL instance in tenants.json from scratch: initdb, start,
// create the database, then load db/schema/<name>.sql, each app's
// tenants/<prefix>/<app>/schema.sql, and db/seed/<name>.sql.
// Instances whose data directory already exists are left untouched, so it's
// safe to re-run after adding a tenant to tenants.json.
// Usage: node db/setup.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PG_BIN = process.env.PG_BIN || '/usr/local/opt/postgresql@17/bin';
const BASE_DIR = path.join(__dirname, '..');
const USER = process.env.USER;
const registry = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'tenants.json'), 'utf8'));

const allInstances = { admin: registry.admin, ...registry.tenants };

function run(cmd) {
  execSync(cmd, { stdio: 'pipe' });
}

function loadSql(inst, file) {
  if (!fs.existsSync(file)) return false;
  run(
    `"${PG_BIN}/psql" -h localhost -p ${inst.port} -U ${USER} -d ${inst.database} ` +
      `-v ON_ERROR_STOP=1 -q -f "${file}"`,
  );
  return true;
}

for (const [name, inst] of Object.entries(allInstances)) {
  const dataDir = path.join(BASE_DIR, inst.dataDir);
  const logFile = path.join(dataDir, 'logfile');

  if (fs.existsSync(dataDir)) {
    console.log(`  ${name} skipped — ${inst.dataDir}/ already exists`);
    continue;
  }

  try {
    run(`"${PG_BIN}/initdb" -D "${dataDir}" -U ${USER} -A trust`);
    run(`"${PG_BIN}/pg_ctl" -D "${dataDir}" -l "${logFile}" -o "-p ${inst.port}" -w start`);
    // initdb already creates "postgres" (the admin instance's database).
    if (inst.database !== 'postgres') {
      run(`"${PG_BIN}/createdb" -h localhost -p ${inst.port} -U ${USER} ${inst.database}`);
    }

    const loaded = [];
    if (loadSql(inst, path.join(__dirname, 'schema', `${name}.sql`))) loaded.push('schema');
    for (const app of inst.apps || []) {
      if (loadSql(inst, path.join(BASE_DIR, 'tenants', name, app, 'schema.sql'))) {
        loaded.push(`${app} schema`);
      }
    }
    if (loadSql(inst, path.join(__dirname, 'seed', `${name}.sql`))) loaded.push('seed');

    console.log(`✔ ${name} created on port ${inst.port} (${loaded.join(', ') || 'empty'})`);
  } catch (e) {
    const msg = e.stderr?.toString() || e.message;
    console.error(`✘ ${name} failed: ${msg.trim()}`);
    process.exitCode = 1;
  }
}
