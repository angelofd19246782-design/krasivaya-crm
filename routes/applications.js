'use strict';

const express = require('express');
const fs      = require('fs');
const db      = require('../db');
const { requireLogin, requireAdmin } = require('../middleware');

const router = express.Router();

const VALID_STATUSES = ['new', 'in_progress', 'completed', 'incomplete'];

// ─── GET /api/applications ────────────────────────────────────────────────────
// Query params: ?trash=1  ?status=new  ?mine=1
router.get('/', requireLogin, (req, res) => {
  const { trash, status, mine } = req.query;
  const user = req.session.user;

  const conds  = [];
  const params = [];

  if (trash === '1') {
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    conds.push('a.deleted_at IS NOT NULL');
  } else {
    conds.push('a.deleted_at IS NULL');
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
    conds.push('a.status = ?');
    params.push(status);
  }

  // Employees only see their assigned applications unless admin
  if (user.role === 'employee') {
    conds.push('a.assigned_employee_id = ?');
    params.push(user.id);
  } else if (mine === '1') {
    conds.push('a.assigned_employee_id = ?');
    params.push(user.id);
  }

  const sql = `
    SELECT a.*, u.username AS assigned_username
    FROM   applications a
    LEFT JOIN users u ON a.assigned_employee_id = u.id
    WHERE  ${conds.join(' AND ')}
    ORDER  BY a.created_at DESC
  `;

  res.json(db.prepare(sql).all(...params));
});

// ─── GET /api/applications/:id ────────────────────────────────────────────────
router.get('/:id', requireLogin, (req, res) => {
  const user = req.session.user;

  const app = db.prepare(`
    SELECT a.*, u.username AS assigned_username
    FROM   applications a
    LEFT JOIN users u ON a.assigned_employee_id = u.id
    WHERE  a.id = ?
  `).get(req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(app);
});

// ─── POST /api/applications ───────────────────────────────────────────────────
router.post('/', requireAdmin, (req, res) => {
  const {
    name, phone, email, comment,
    status = 'new', assigned_employee_id,
    source = 'crm', external_id,
  } = req.body;

  if (!name?.trim())                    return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200)                return res.status(400).json({ error: 'Name: max 200 chars' });
  if (phone  && phone.length  > 50)     return res.status(400).json({ error: 'Phone: max 50 chars' });
  if (email  && email.length  > 200)    return res.status(400).json({ error: 'Email: max 200 chars' });
  if (comment && comment.length > 5000) return res.status(400).json({ error: 'Comment: max 5000 chars' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const qn = db.prepare('SELECT COALESCE(MAX(queue_number), 0) + 1 AS next FROM applications').get().next;

  const result = db.prepare(`
    INSERT INTO applications
      (name, phone, email, comment, status, assigned_employee_id, source, external_id, queue_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    phone   || null,
    email   || null,
    comment || null,
    status,
    assigned_employee_id || null,
    source,
    external_id          || null,
    qn,
  );

  res.status(201).json(db.prepare('SELECT * FROM applications WHERE id = ?').get(result.lastInsertRowid));
});

// ─── PUT /api/applications/:id ────────────────────────────────────────────────
router.put('/:id', requireLogin, (req, res) => {
  const user = req.session.user;

  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Employee: status-only, must be assigned
  if (user.role === 'employee') {
    if (app.assigned_employee_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    const { status } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Valid status required' });
    }
    db.prepare(`UPDATE applications SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, app.id);
    return res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id));
  }

  // Admin: full update
  const { name, phone, email, comment, status, assigned_employee_id } = req.body;

  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (name    && String(name).length    > 200)  return res.status(400).json({ error: 'Name: max 200 chars' });
  if (phone   && String(phone).length   > 50)   return res.status(400).json({ error: 'Phone: max 50 chars' });
  if (email   && String(email).length   > 200)  return res.status(400).json({ error: 'Email: max 200 chars' });
  if (comment && String(comment).length > 5000) return res.status(400).json({ error: 'Comment: max 5000 chars' });
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const fields = {};
  if (name                !== undefined) fields.name                 = String(name).trim() || null;
  if (phone               !== undefined) fields.phone                = phone  || null;
  if (email               !== undefined) fields.email                = email  || null;
  if (comment             !== undefined) fields.comment              = comment || null;
  if (status              !== undefined) fields.status               = status;
  if (assigned_employee_id !== undefined) fields.assigned_employee_id = assigned_employee_id || null;

  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });

  fields.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE applications SET ${setClauses} WHERE id = ?`).run(...Object.values(fields), app.id);

  res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(app.id));
});

// ─── DELETE /api/applications/:id  (soft delete) ─────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const app = db.prepare('SELECT id FROM applications WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  db.prepare(`UPDATE applications SET deleted_at = datetime('now') WHERE id = ?`).run(app.id);
  res.json({ ok: true });
});

// ─── POST /api/applications/:id/restore ──────────────────────────────────────
router.post('/:id/restore', requireAdmin, (req, res) => {
  const app = db.prepare('SELECT id FROM applications WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found in trash' });

  db.prepare('UPDATE applications SET deleted_at = NULL WHERE id = ?').run(app.id);
  res.json({ ok: true });
});

// ─── DELETE /api/applications/:id/permanent ───────────────────────────────────
router.delete('/:id/permanent', requireAdmin, (req, res) => {
  const app = db.prepare('SELECT id FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Remove files from disk before DB delete (cascade handles the rows)
  const files = db.prepare('SELECT file_path FROM attachments WHERE application_id = ?').all(app.id);
  files.forEach(f => { try { fs.unlinkSync(f.file_path); } catch {} });

  db.prepare('DELETE FROM applications WHERE id = ?').run(app.id);
  res.json({ ok: true });
});

module.exports = router;
