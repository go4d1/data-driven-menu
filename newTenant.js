#!/usr/bin/env node

// Usage: node newTenant.js <subdomain>
// Example: node newTenant.js newuser
//          node newTenant.js http://newuser.medicalpod.com

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PG_BIN = '/usr/local/opt/postgresql@17/bin';
const BASE_DIR = __dirname;
const TENANTS_FILE = path.join(BASE_DIR, 'tenants.json');
const TEMPLATE_DB = 'aaa';
const TEMPLATE_PORT = 5432;
const DOMAIN = 'medicalpod.fom';

// Parse subdomain from argument (accepts bare name or full URL)
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node newTenant.js <subdomain|url>');
  console.error('  e.g. node newTenant.js ccc');
  console.error('  e.g. node newTenant.js http://ccc.medicalpod.com');
  process.exit(1);
}

const subdomain = arg
  .replace(/^https?:\/\//, '')
  .split('.')[0]
  .toLowerCase();

if (!/^[a-z0-9]+$/.test(subdomain)) {
  console.error(`Invalid subdomain: "${subdomain}" — use lowercase letters and numbers only`);
  process.exit(1);
}

// Load tenant registry
const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));

if (registry.tenants[subdomain]) {
  console.error(`Tenant "${subdomain}" already exists on port ${registry.tenants[subdomain].port}`);
  process.exit(1);
}

const port = registry.nextPort;
const dataDir = path.join(BASE_DIR, subdomain);
const logFile = path.join(dataDir, 'logfile');

console.log(`\nCreating tenant: ${subdomain}`);
console.log(`  Port    : ${port}`);
console.log(`  Data dir: ${dataDir}`);
console.log(`  Database: ${subdomain}\n`);

// 1. Create subdirectory
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
  console.log(`✔ Created directory: ${dataDir}`);
} else {
  console.log(`  Directory already exists: ${dataDir}`);
}

// 2. initdb
console.log('  Initializing PostgreSQL data directory...');
execSync(`${PG_BIN}/initdb ${dataDir}`, { stdio: 'pipe' });
console.log('✔ initdb complete');

// 3. Start postgres on new port
console.log(`  Starting PostgreSQL on port ${port}...`);
execSync(`${PG_BIN}/pg_ctl -D ${dataDir} -l ${logFile} -o "-p ${port}" start`, { stdio: 'pipe' });
console.log(`✔ PostgreSQL started on port ${port}`);

// 4. Create named database
console.log(`  Creating database "${subdomain}"...`);
execSync(`${PG_BIN}/createdb -h localhost -p ${port} -U ${process.env.USER} ${subdomain}`, { stdio: 'pipe' });
console.log(`✔ Database "${subdomain}" created`);

// 5. Copy fommenu schema from template
console.log(`  Copying fommenu schema from template (${TEMPLATE_DB})...`);
execSync(
  `${PG_BIN}/pg_dump -h localhost -p ${TEMPLATE_PORT} -U ${process.env.USER} -s -t 'fommenu' ${TEMPLATE_DB} | ${PG_BIN}/psql -h localhost -p ${port} -U ${process.env.USER} ${subdomain}`,
  { stdio: 'pipe', shell: true }
);
console.log('✔ fommenu table created');

// 6. Add /etc/hosts entry
const hostsEntry = `127.0.0.1 ${subdomain}.${DOMAIN}`;
const hosts = fs.readFileSync('/etc/hosts', 'utf8');
if (!hosts.includes(`${subdomain}.${DOMAIN}`)) {
  try {
    execSync(`printf '%s\n' "${hostsEntry}" | sudo tee -a /etc/hosts`, { stdio: 'pipe' });
    console.log(`✔ Added ${subdomain}.${DOMAIN} to /etc/hosts`);
  } catch {
    console.warn(`⚠ Could not update /etc/hosts — add this line manually:\n  ${hostsEntry}`);
  }
} else {
  console.log(`  ${subdomain}.${DOMAIN} already in /etc/hosts`);
}

// 7. Update tenant registry
registry.tenants[subdomain] = { port, database: subdomain, dataDir: subdomain };
registry.nextPort = port + 1;
fs.writeFileSync(TENANTS_FILE, JSON.stringify(registry, null, 2));
console.log('✔ tenants.json updated');

console.log(`\nDone! Tenant "${subdomain}" is ready.`);
console.log(`  URL     : http://${subdomain}.${DOMAIN}:3000`);
console.log(`  Connect : psql -h localhost -p ${port} -U ${process.env.USER} ${subdomain}\n`);
