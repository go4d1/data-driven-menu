#!/usr/bin/env node
// Starts all tenant PostgreSQL instances defined in tenants.json
// Usage: node startAll.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PG_BIN = '/usr/local/opt/postgresql@17/bin';
const BASE_DIR = __dirname;
const registry = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'tenants.json'), 'utf8'));

const allInstances = { admin: registry.admin, ...registry.tenants };

for (const [name, tenant] of Object.entries(allInstances)) {
  const dataDir = path.join(BASE_DIR, tenant.dataDir);
  const logFile = path.join(dataDir, 'logfile');
  try {
    execSync(
      `"${PG_BIN}/pg_ctl" -D "${dataDir}" -l "${logFile}" -o "-p ${tenant.port}" start`,
      { stdio: 'pipe' }
    );
    console.log(`✔ ${name} started on port ${tenant.port}`);
  } catch (e) {
    const msg = e.stderr?.toString() || '';
    if (msg.includes('already') || msg.includes('running')) {
      console.log(`  ${name} already running on port ${tenant.port}`);
    } else {
      console.error(`✘ ${name} failed: ${msg.trim()}`);
    }
  }
}
