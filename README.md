# FOM — Data-Driven Flyout Menu

FOM (Flyout Menu) is a multi-tenant web application whose navigation is defined
entirely by data. Each tenant's menu lives in a single `fommenu` table: one row
per menu item, with a `parentpk` column that builds the tree. The same rows
drive the flyout menu users click, the drag-and-drop menu builder that edits it,
and the server's decision about what to return when an item is clicked.

The goal is for every tenant to get its own menu and its own small custom
applications, without touching a shared codebase. Adding a page is a matter of
adding a row, not a deployment.

Built with Node.js (plain `http`, no framework) and PostgreSQL. It's a port of
an earlier Visual FoxPro / Web Connection system.

## How it works

- **One PostgreSQL instance per tenant.** Each tenant (`aaa`, `bbb`, `ccc`,
  `mvg`) runs its own Postgres server on its own port, with its own data
  directory. A separate **admin** instance holds per-tenant settings (roles and
  permission levels) in `rex_path`. [tenants.json](tenants.json) maps each
  tenant to its port, database and data directory.
- **Tenants are chosen by subdomain.** A request to `aaa.localhost:3000` is
  served from the `aaa` database. Browsers resolve `*.localhost` to your own
  machine, so no `/etc/hosts` changes are needed for local development.
- **Menu rows decide what a click does.** Depending on which columns are set, a
  menu item loads an HTML file (`chref`), inline HTML (`chtml`), a
  tenant-private file (`private`), or calls a widget function (`cfunction`).
  Optional JavaScript (`jscript`) runs after the page loads. `ilevel` and
  `crole` restrict an item to users with a given permission level or role.
- **Tenant apps.** A tenant can list apps in `tenants.json` (`"apps":
  ["doctors"]`). Each app lives in `tenants/<prefix>/<app>/` and exports its
  routes, saved queries and a seed function that registers its menu rows at
  startup. See [tenants/aaa/doctors/](tenants/aaa/doctors/) for an example: a
  doctor credentialing system.

Full table-by-table documentation is in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## Requirements

- Node.js 20 or later
- PostgreSQL 17. The scripts expect the Homebrew binaries at
  `/usr/local/opt/postgresql@17/bin`. On Apple Silicon or Linux, set `PG_BIN`
  to your Postgres `bin` directory, for example
  `export PG_BIN=/opt/homebrew/opt/postgresql@17/bin`.

## Getting started

```bash
git clone https://github.com/go4d1/data-driven-menu.git
cd data-driven-menu
npm install
npm run db:setup     # create, start and load every Postgres instance
npm start            # http://aaa.localhost:3000/fom.html
```

`db:setup` creates a data directory for each instance in `tenants.json`, starts
it on its port, and loads, in order:

1. `db/schema/<name>.sql` — tables, indexes, functions and triggers
2. `tenants/<prefix>/<app>/schema.sql` — for each app the tenant uses
3. `db/seed/<name>.sql` — starter data: the menus, demo users, widgets, and
   sample content

It skips any instance whose data directory already exists, so it never
overwrites a database and is safe to re-run.

After that, start and stop the databases with:

```bash
npm run db:start
npm run db:stop
```

### Signing in

The seed data includes a demo Global Admin account on every tenant:

- Email: `aaa@ddm.com`
- Password: `testuser`

Change or remove it before exposing the server to anyone else.

### Email (optional)

The bulk-email pages send mail over SMTP. To use them, copy the example and
fill in your SMTP details:

```bash
cp .env.example .env
```

`.env` is git-ignored, and the server refuses to serve it or any other
dotfile. Without it the app runs normally, but sending email fails.

## Project layout

| Path | What it is |
| --- | --- |
| [index.js](index.js) | The whole server: auth, menu APIs, page loading, uploads, email, static files |
| [fom.html](fom.html) | Main page: the flyout menu and the content area it loads pages into |
| [menubuilder.html](menubuilder.html) | Tree editor for reordering and editing menu rows |
| [fomHelpers.js](fomHelpers.js) | Client-side menu loading and click handling |
| `*.html` (other) | Pages and widgets that menu items load |
| [tenants.json](tenants.json) | Tenant registry: ports, databases, data directories, apps |
| [tenants/](tenants/) | Per-tenant app code |
| [db/](db/) | Schema and seed files, plus the setup and export scripts |
| [startAll.js](startAll.js) / [stopAll.js](stopAll.js) | Start or stop every Postgres instance |
| [newTenant.js](newTenant.js) | Create a new tenant instance and register it |

Postgres data directories (`aaa/`, `bbb/`, `ccc/`, `mvg/`, `admin/`) and
`uploads/` are created locally and are not in the repo.

## Updating the schema and seed files

The files in `db/` are generated from a working install. After changing table
structures or the menus you want new installs to start with, regenerate them
with the databases running:

```bash
npm run db:export
```

Then review the diff before committing. The export leaves out data that belongs
to a running site rather than a fresh install: email campaigns (`sendemail`),
photo records (`photos`, whose files are in `uploads/`), and `fompages`. Rows
listed in `ROW_FILTERS` in [db/export.js](db/export.js) are also left out.
