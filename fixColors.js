// One-off migration: re-assign permission-level colors in level order for every tenant.
// Mirrors the /saveSettings logic in index.js so existing rows match new saves.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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

const TENANTS_FILE = path.join(__dirname, 'tenants.json');

function getAdminConfig() {
  const registry = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  return {
    host: 'localhost',
    user: process.env.USER,
    database: registry.admin.database,
    port: registry.admin.port,
  };
}

(async () => {
  const client = new Client(getAdminConfig());
  await client.connect();
  try {
    const { rows } = await client.query('SELECT prefix, settings FROM rex_path');
    for (const row of rows) {
      const settings =
        typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
      if (!settings || !Array.isArray(settings.permissionLevels)) {
        console.log(`${row.prefix}: no permissionLevels — skipped`);
        continue;
      }
      settings.permissionLevels = settings.permissionLevels
        .slice()
        .sort((a, b) => a.level - b.level)
        .map((p, i) => ({
          level: p.level,
          label: p.label,
          color: colors[i % colors.length],
        }));
      await client.query('UPDATE rex_path SET settings = $1 WHERE prefix = $2', [
        JSON.stringify(settings),
        row.prefix,
      ]);
      const summary = settings.permissionLevels
        .map((p) => `${p.label}(${p.level})=${p.color}`)
        .join(', ');
      console.log(`${row.prefix}: ${summary}`);
    }
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
