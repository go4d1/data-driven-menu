# FOM Database Schema

Reference documentation for every table across the FOM Postgres instances.
Generated 2026-05-21 from the live databases. Revised 2026-05-23 — added `fommenu.private` column.

FOM is **multi-tenant**: each tenant runs its own isolated PostgreSQL instance
(separate data directory + port). There is no shared database — a tenant's data
lives only in its own instance. A separate **admin** instance holds cross-tenant
configuration.

## Connection reference

| Instance | Role | Port | Database name | Tables | Connect |
|----------|------|------|---------------|--------|---------|
| `aaa` | Tenant (runs the `doctors` app) | 5437 | `aaa` | 19 | `psql -h localhost -p 5437 -d aaa` |
| `bbb` | Tenant | 5433 | `bbb` | 4 | `psql -h localhost -p 5433 -d bbb` |
| `ccc` | Tenant | 5434 | `ccc` | 2 | `psql -h localhost -p 5434 -d ccc` |
| `mvg` | Tenant | 5435 | `mvg` | 2 | `psql -h localhost -p 5435 -d mvg` |
| `admin` | Admin / config | 5436 | **`postgres`** | 1 | `psql -h localhost -p 5436 -d postgres` |

> ⚠️ The admin instance's database is named **`postgres`**, not `admin`.
> `psql -p 5436 -d admin` fails with *database "admin" does not exist* — the
> `admin` in `tenants.json` is the *data directory* name, not the DB name.

Ports and data directories are defined in [tenants.json](tenants.json).

## Table presence matrix

Row counts shown in parentheses, as of 2026-05-21.

| Table | aaa | bbb | ccc | mvg |
|-------|-----|-----|-----|-----|
| `public.fommenu` | ✓ (69) | ✓ (85) | — | — |
| `public.fompages` | ✓ (0) | ✓ (0) | ✓ (0) | ✓ (0) |
| `public.photos` | ✓ (12) | ✓ (1) | — | — |
| `public.sendemail` | ✓ (11) | ✓ (0) | ✓ (0) | ✓ (0) |
| `public.users` | ✓ (35) | — | — | — |
| `public.widgets` | ✓ (12) | — | — | — |
| `doctors.*` (8 tables) | ✓ | — | — | — |
| `theater.*` (5 tables) | ✓ | — | — | — |

The `admin` instance holds one table, `public.rex_path` (4 rows).

---

# Core per-tenant tables (`public` schema)

These tables make up the FOM application itself. They are created per tenant;
not every tenant has every table (see the matrix above).

## `fommenu`

The flyout-menu navigation tree. Each row is a menu item; `parentpk` builds the
hierarchy (top-level rows use `parentpk = 0`). Drives `buildUL()` in
[index.js](index.js). Present in **aaa** (69 rows) and **bbb** (85 rows).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `pk` | integer | NO | | **Primary key** |
| `parentpk` | integer | YES | | Parent row's `pk`; `0` = top level |
| `cprompt` | varchar(60) | YES | | Menu label |
| `chref` | varchar(60) | YES | | HTML file loaded into `#container`, resolved under `__dirname` |
| `private` | varchar(60) | YES | | Tenant-isolated HTML fragment served from `<TENANT_FILES_DIR>/<prefix>/<name>`. **Wins over `chref`** in `/loadPage` when both are set. Added 2026-05-23. |
| `cfunction` | varchar(120) | YES | | Widget call, e.g. `tabgenerator('1')` |
| `isort` | integer | YES | | Sort order among siblings |
| `ilevel` | integer | YES | | Permission level required |
| `crole` | varchar(10) | YES | | Role(s) required |
| `objective` | text | YES | | Free-text note shown in the status bar |
| `cexec` | text | YES | | Legacy executable field |
| `jscript` | text | YES | | Inline JS run after the page loads |
| `lparent` | boolean | YES | | Logical flag — node is a parent |
| `chtml` | text | YES | | Inline HTML body (alternative to `chref`) |
| `jqclass` | varchar(10) | YES | | Anchor class — `fom-lc` = load in container |
| `class` | varchar(10) | YES | | Extra CSS class for the label span |

Index: `fomMenu_pkey` (unique, `pk`).

## `fompages`

Standalone page records keyed by name. **Currently unused** — empty in all four
tenants and not referenced anywhere in [index.js](index.js). Likely planned or
legacy. Present in **all four tenants** (0 rows each).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `name` | varchar(60) | NO | | **Primary key** |
| `title` | varchar(120) | YES | | |
| `html` | text | YES | | Page body |
| `crole` | integer | YES | `0` | Role required |
| `cfunction` | text | YES | | |
| `isort` | integer | YES | `0` | |
| `active` | boolean | YES | `true` | |
| `updated` | timestamp | YES | `now()` | |

Index: `fompages_pkey` (unique, `name`).

## `photos`

Uploaded photos. Files are stored on disk under
`uploads/photos/<tenant>/`; this table holds the metadata. Populated by the
`/uploadPhotos` route and read by `/photo`, `/photo-thumb`, and the Browse
Photos screen. Present in **aaa** (12 rows) and **bbb** (1 row).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `title` | varchar(100) | YES | | |
| `caption` | text | YES | | |
| `igroup` | integer | YES | `0` | Group number (set at upload) |
| `filename` | text | YES | | Stored filename on disk |
| `originalname` | text | YES | | Original uploaded filename |
| `mimetype` | varchar(100) | YES | | |
| `sizebytes` | integer | YES | | File size |
| `uploaded_by` | integer | YES | | User id (from session) |
| `uploaded_at` | timestamp | YES | `now()` | |

Index: `photos_pkey` (unique, `id`).

## `sendemail`

Email campaign definitions for the sendemail system. A campaign is either a
raw SQL query (`qtype='raw'`) or a named saved query (`qtype='saved'`). The
`letter` is the template body with `{{column}}` placeholders. Present in **all
four tenants** (aaa 11 rows; bbb/ccc/mvg 0).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `name` | text | NO | | Campaign name |
| `qtype` | text | NO | | `'raw'` or `'saved'` |
| `query` | text | YES | | Raw SQL (when `qtype='raw'`) |
| `qname` | text | YES | | Saved-query name (when `qtype='saved'`) |
| `qparams` | jsonb | YES | | Bind parameters for the saved query |
| `letter` | text | NO | `''` | Email template body |

Index: `sendemail_pkey` (unique, `id`).

## `users`

Application user accounts. Present in **aaa only** (35 rows).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `firstname` | varchar(50) | NO | | |
| `lastname` | varchar(50) | NO | | |
| `email` | varchar(100) | YES | | |
| `phone` | varchar(20) | YES | | |
| `role` | varchar(30) | YES | `'user'` | |
| `active` | boolean | YES | `true` | |
| `created_at` | timestamp | YES | `now()` | |
| `permission` | integer | YES | `0` | Permission level |
| `password` | varchar(200) | YES | | Salted hash (`salt:hash`) |

Index: `users_pkey` (unique, `id`).

## `widgets`

Content panels for tab / accordion widgets. A `fommenu` row with
`cfunction = tabgenerator('N')` or `accordion('N')` renders all `widgets` rows
where `igroup = N`. Present in **aaa only** (12 rows).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `chead` | text | NO | | Tab / panel heading |
| `cbody` | text | YES | | Panel HTML body |
| `igroup` | integer | YES | | Widget group number |
| `jscript` | text | YES | | JS run lazily when the panel first shows |

Index: `widgets_pkey` (unique, `id`).

---

# `doctors` schema (aaa only)

The doctor-credentialing application, loaded as a per-tenant app for `aaa`.
Source of truth: [aaa/doctors/schema.sql](aaa/doctors/schema.sql). All tables
use a `created_at` / `updated_at` timestamp pair (default `CURRENT_TIMESTAMP`)
and most support soft-deletion via a nullable `deleted_at`.

## `doctors.doctors`

Doctor records and their attestation/follow-up tracking. **100 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `firstname` | varchar(30) | NO | | |
| `lastname` | varchar(30) | NO | | |
| `email` | varchar(255) | NO | | |
| `phone` | varchar(20) | YES | | |
| `invitation_token` | varchar(255) | NO | | **Unique** — portal access token |
| `last_response_at` | timestamp | YES | | |
| `last_attested_at` | timestamp | YES | | |
| `follow_ups_sent` | integer | YES | `0` | |
| `last_follow_up_at` | timestamp | YES | | |
| `deleted_at` | timestamp | YES | | Soft-delete marker |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `doctors_pkey` (`id`); unique on `invitation_token`; non-unique on
`invitation_token` and `deleted_at`.

## `doctors.offices`

Physical office locations. **90 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `name` | varchar(255) | NO | | |
| `street` | varchar(255) | NO | | |
| `city` | varchar(100) | NO | | |
| `state` | varchar(2) | NO | | |
| `zip` | varchar(10) | NO | | |
| `deleted_at` | timestamp | YES | | Soft-delete marker |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `offices_pkey` (`id`); **unique** on (`street`, `city`, `state`,
`zip`); non-unique on `state`.

## `doctors.credentials`

State medical credentials held by a doctor. **5 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `doctor_id` | integer | NO | | **FK** → `doctors.doctors.id` |
| `state` | varchar(2) | NO | | |
| `credential_number` | varchar(255) | NO | | |
| `deleted_at` | timestamp | YES | | Soft-delete marker |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `credentials_pkey` (`id`); **unique** on (`doctor_id`, `state`);
non-unique on `state` and `doctor_id`.

## `doctors.doctor_offices`

Junction table linking doctors to offices (many-to-many). **5 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `doctor_id` | integer | NO | | **FK** → `doctors.doctors.id` |
| `office_id` | integer | NO | | **FK** → `doctors.offices.id` |
| `deleted_at` | timestamp | YES | | Soft-delete marker |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `doctor_offices_pkey` (`id`); **unique** on (`doctor_id`,
`office_id`); non-unique on `doctor_id` and `office_id`.

## `doctors.admin_users`

Back-office admin logins for the doctors app. **0 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `username` | varchar(255) | NO | | **Unique** |
| `email` | varchar(255) | NO | | **Unique** |
| `password_hash` | varchar(255) | NO | | |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

## `doctors.audit_log`

Change-history log for doctors-app entities. **12 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `timestamp` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `actor_id` | integer | YES | | Who made the change |
| `actor_type` | varchar(20) | NO | | e.g. `admin`, `doctor` |
| `entity` | varchar(50) | NO | | Table/entity affected |
| `entity_id` | integer | YES | | Row affected |
| `action` | varchar(20) | NO | | e.g. `create`, `update`, `delete` |
| `before_value` | jsonb | YES | | Snapshot before the change |
| `after_value` | jsonb | YES | | Snapshot after the change |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `audit_log_pkey` (`id`); non-unique on `entity_id` and `actor_id`.

## `doctors.pending_emails`

Queue of attestation / follow-up emails to be sent. **0 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `doctor_id` | integer | NO | | **FK** → `doctors.doctors.id` |
| `email_type` | varchar(50) | NO | | |
| `status` | varchar(20) | YES | `'pending'` | |
| `follow_up_number` | integer | YES | `0` | |
| `sent_at` | timestamp | YES | | |
| `created_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

Indexes: `pending_emails_pkey` (`id`); non-unique on `status` and `doctor_id`.

## `doctors.settings`

Key/value configuration for the doctors app. **0 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | integer | NO | serial | **Primary key** |
| `key` | varchar(100) | NO | | **Unique** |
| `value` | varchar(255) | NO | | |
| `updated_at` | timestamp | YES | `CURRENT_TIMESTAMP` | |

---

# `theater` schema (aaa only)

Theater-domain sample data (the `plays` table backs several demo menu items).

> ⚠️ The `theater` tables have **no primary keys** and their `id` column is a
> nullable `integer`. They are flat data tables, not enforced-integrity models.

## `theater.plays`

Play / scene records. **192 rows.**

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer | YES | No PK |
| `act` | text | YES | |
| `slug` | text | YES | |
| `body` | text | YES | |
| `genre` | text | YES | |

## `theater.actors`

Cast members. **4 rows.**

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer | YES | No PK |
| `lastname` | text | YES | |
| `firstname` | text | YES | |
| `birthdate` | date | YES | |
| `roles` | text | YES | |
| `status` | text | YES | |
| `number` | integer | YES | |
| `cell_tel` | text | YES | |
| `bio` | text | YES | |

## `theater.guest`

Guest performers — **identical column layout to `theater.actors`.** **5 rows.**

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer | YES | No PK |
| `lastname` | text | YES | |
| `firstname` | text | YES | |
| `birthdate` | date | YES | |
| `roles` | text | YES | |
| `status` | text | YES | |
| `number` | integer | YES | |
| `cell_tel` | text | YES | |
| `bio` | text | YES | |

## `theater.company`

Production companies / organisations. **624 rows.**

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer | YES | No PK |
| `name` | text | YES | |
| `url` | text | YES | |
| `body` | text | YES | |

## `theater.theaters`

Theater venues. **67 rows.**

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | integer | YES | No PK |
| `name` | text | YES | |
| `address` | text | YES | |
| `url` | text | YES | |
| `email` | text | YES | |
| `directions` | text | YES | |

---

# Admin instance (port 5436, database `postgres`)

## `rex_path`

Per-tenant configuration ("rex" settings) keyed by tenant prefix. Read by
`getRex(prefix)` in [index.js](index.js) to load each tenant's permission
levels and roles. **4 rows.**

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `prefix` | varchar | NO | | **Primary key** — tenant prefix (`aaa`, …) |
| `settings` | jsonb | NO | `'{}'` | Settings blob (permission levels, roles) |

Index: `rex_path_pkey` (unique, `prefix`).
