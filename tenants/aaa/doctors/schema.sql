-- Doctor Credentialing System schema
-- Lives in the `doctors` schema of the aaa database.
-- Mirrors the tenants/aaa/theater/ pattern (schema-as-namespace).

CREATE SCHEMA IF NOT EXISTS doctors;

SET search_path TO doctors, public;

CREATE TABLE IF NOT EXISTS doctors.doctors (
  id SERIAL PRIMARY KEY,
  firstname VARCHAR(30) NOT NULL,
  lastname VARCHAR(30) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  invitation_token VARCHAR(255) UNIQUE NOT NULL,
  last_response_at TIMESTAMP,
  last_attested_at TIMESTAMP,
  follow_ups_sent INT DEFAULT 0,
  last_follow_up_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors.offices (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  street VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL CHECK (state IN ('DE', 'MD', 'VA')),
  zip VARCHAR(10) NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(street, city, state, zip)
);

CREATE TABLE IF NOT EXISTS doctors.credentials (
  id SERIAL PRIMARY KEY,
  doctor_id INT NOT NULL REFERENCES doctors.doctors(id),
  state VARCHAR(2) NOT NULL CHECK (state IN ('DE', 'MD', 'VA')),
  credential_number VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, state)
);

CREATE TABLE IF NOT EXISTS doctors.doctor_offices (
  id SERIAL PRIMARY KEY,
  doctor_id INT NOT NULL REFERENCES doctors.doctors(id),
  office_id INT NOT NULL REFERENCES doctors.offices(id),
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, office_id)
);

CREATE TABLE IF NOT EXISTS doctors.admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors.audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actor_id INT,
  actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('doctor', 'admin')),
  entity VARCHAR(50) NOT NULL,
  entity_id INT,
  action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'confirm')),
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors.pending_emails (
  id SERIAL PRIMARY KEY,
  doctor_id INT NOT NULL REFERENCES doctors.doctors(id),
  email_type VARCHAR(50) NOT NULL CHECK (email_type IN ('initial_invitation', 're_attestation', 'follow_up')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  follow_up_number INT DEFAULT 0,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors.settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doctors_invitation_token ON doctors.doctors(invitation_token);
CREATE INDEX IF NOT EXISTS idx_doctors_deleted_at        ON doctors.doctors(deleted_at);
CREATE INDEX IF NOT EXISTS idx_credentials_doctor_id     ON doctors.credentials(doctor_id);
CREATE INDEX IF NOT EXISTS idx_credentials_state         ON doctors.credentials(state);
CREATE INDEX IF NOT EXISTS idx_doctor_offices_doctor_id  ON doctors.doctor_offices(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_offices_office_id  ON doctors.doctor_offices(office_id);
CREATE INDEX IF NOT EXISTS idx_offices_state             ON doctors.offices(state);
CREATE INDEX IF NOT EXISTS idx_pending_emails_doctor_id  ON doctors.pending_emails(doctor_id);
CREATE INDEX IF NOT EXISTS idx_pending_emails_status     ON doctors.pending_emails(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id        ON doctors.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id       ON doctors.audit_log(entity_id);
