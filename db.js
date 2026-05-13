'use strict';

// node:sqlite is built into Node 24 — no npm package needed.
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path   = require('path');

const db = new DatabaseSync(path.join(__dirname, 'nexus.sqlite'));

// Performance + integrity
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK(role IN ('admin', 'employee')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    source               TEXT    NOT NULL DEFAULT 'crm',
    external_id          TEXT,
    name                 TEXT    NOT NULL,
    phone                TEXT,
    email                TEXT,
    comment              TEXT,
    status               TEXT    NOT NULL DEFAULT 'new'
                                 CHECK(status IN ('new','in_progress','completed','incomplete')),
    assigned_employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    queue_number         INTEGER NOT NULL,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    deleted_at           TEXT
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    file_name      TEXT    NOT NULL,
    file_path      TEXT    NOT NULL,
    mime_type      TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content        TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT    PRIMARY KEY,
    data    TEXT    NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// ─── Indexes ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_app_status   ON applications(status);
  CREATE INDEX IF NOT EXISTS idx_app_deleted  ON applications(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_app_assigned ON applications(assigned_employee_id);
  CREATE INDEX IF NOT EXISTS idx_app_ext      ON applications(external_id);
  CREATE INDEX IF NOT EXISTS idx_sess_exp     ON sessions(expires);
`);

// ─── Seed default admin ───────────────────────────────────────────────────────

const adminExists = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')`).run('admin', hash);
  console.log('✓ Default admin created  →  username: admin   password: admin123');
}

// ─── Seed demo data (only when DB is brand new) ───────────────────────────────

const appCount = db.prepare('SELECT COUNT(*) AS c FROM applications').get().c;
if (appCount === 0) {
  const empHash = bcrypt.hashSync('employee123', 10);
  const empId   = db.prepare(`INSERT INTO users (username, password, role) VALUES (?, ?, 'employee')`).run('employee', empHash).lastInsertRowid;
  const admId   = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get().id;

  const ins = db.prepare(`
    INSERT INTO applications
      (name, phone, email, comment, status, source, queue_number, assigned_employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demos = [
    ['Elena Morozova',  '+7 900 123-4567', 'elena@example.com',  'Construction permit request',          'in_progress', 'web_form', empId],
    ['Dmitri Kozlov',   '+7 900 234-5678', null,                 'Business license inquiry',             'new',         'bot',      null],
    ['Sofia Petersen',  '+7 900 345-6789', 'sofia@example.com',  'Property registration — completed',    'completed',   'crm',      empId],
    ['Artem Borisov',   '+7 900 456-7890', null,                 'Tax consultation',                     'completed',   'web_form', admId],
    ['Oksana Vlasova',  '+7 900 567-8901', 'oksana@example.com', 'Legal advice needed',                  'new',         'bot',      null],
    ['Ivan Nikitin',    '+7 900 678-9012', null,                 'Permit renewal — in review',           'in_progress', 'web_form', empId],
    ['Maria Sokolova',  '+7 900 789-0123', 'maria@example.com',  'Document translation — missing files', 'incomplete',  'bot',      null],
  ];

  db.exec('BEGIN');
  try {
    demos.forEach(([name, phone, email, comment, status, source, assignTo], i) => {
      ins.run(name, phone, email, comment, status, source, i + 1, assignTo);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log('✓ Demo data seeded       →  username: employee  password: employee123');
}

module.exports = db;
