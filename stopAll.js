#!/usr/bin/env node
// Stops all tenant PostgreSQL instances defined in tenants.json
// Usage: node stopAll.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PG_BIN = '/usr/local/opt/postgresql@17/bin';
const BASE_DIR = __dirname;
const registry = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'tenants.json'), 'utf8'));

const allInstances = { admin: registry.admin, ...registry.tenants };

for (const [name, tenant] of Object.entries(allInstances)) {
  const dataDir = path.join(BASE_DIR, tenant.dataDir);
  try {
    execSync(
      `${PG_BIN}/pg_ctl -D ${dataDir} -m fast -t 10 stop`,
      { stdio: 'pipe' }
    );
    console.log(`✔ ${name} stopped`);
  } catch (e) {
    const msg = e.stderr?.toString() || '';
    if (msg.includes('not running')) {
      console.log(`  ${name} was not running`);
    } else if (msg.includes('does not shut down')) {
      try {
        const pidFile = path.join(dataDir, 'postmaster.pid');
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').split('\n')[0], 10);
        if (!pid) throw new Error('could not read PID from postmaster.pid');
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        try { fs.unlinkSync(pidFile); } catch {}
        console.log(`✔ ${name} stopped (kill -9 ${pid})`);
      } catch (e2) {
        console.error(`✘ ${name} failed: ${(e2.stderr?.toString() || e2.message || '').trim()}`);
      }
    } else {
      console.error(`✘ ${name} failed: ${msg.trim()}`);
    }
  }
}
