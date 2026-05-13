'use strict';

const express = require('express');
const fs      = require('fs');
const db      = require('../db');
const { upload } = require('../upload');

const router = express.Router();

// ─── POST /api/intake ─────────────────────────────────────────────────────────
// Public endpoint — no session required.
// Creates an application visible immediately in the CRM.
router.post('/', (req, res) => {
  const { name, phone, email, comment, source = 'web_form', external_id } = req.body;

  if (!name?.trim())                     return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200)                 return res.status(400).json({ error: 'Name: max 200 chars' });
  if (!phone?.trim())                    return res.status(400).json({ error: 'Phone is required' });
  if (phone.length > 50)                 return res.status(400).json({ error: 'Phone: max 50 chars' });
  if (email  && email.length  > 200)     return res.status(400).json({ error: 'Email: max 200 chars' });
  if (comment && comment.length > 5000)  return res.status(400).json({ error: 'Comment: max 5000 chars' });

  // Deduplicate by external_id if provided
  if (external_id?.trim()) {
    const existing = db.prepare(
      'SELECT id, queue_number FROM applications WHERE external_id = ?'
    ).get(external_id.trim());
    if (existing) {
      return res.json({ id: existing.id, queue_number: existing.queue_number, duplicate: true });
    }
  }

  const qn = db.prepare('SELECT COALESCE(MAX(queue_number), 0) + 1 AS next FROM applications').get().next;

  const result = db.prepare(`
    INSERT INTO applications
      (name, phone, email, comment, status, source, external_id, queue_number)
    VALUES (?, ?, ?, ?, 'new', ?, ?, ?)
  `).run(
    name.trim(),
    phone.trim(),
    email   || null,
    comment || null,
    source,
    external_id?.trim() || null,
    qn,
  );

  res.status(201).json({ id: result.lastInsertRowid, queue_number: qn });
});

// ─── POST /api/intake/:id/attachment ─────────────────────────────────────────
// Public endpoint — attach files to a previously created intake application.
router.post('/:id/attachment', upload.single('file'), (req, res) => {
  const app = db.prepare(
    `SELECT id FROM applications WHERE id = ? AND status = 'new' AND deleted_at IS NULL`
  ).get(req.params.id);

  if (!app) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Application not found or not eligible' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const result = db.prepare(`
    INSERT INTO attachments (application_id, file_name, file_path, mime_type)
    VALUES (?, ?, ?, ?)
  `).run(app.id, req.file.originalname, req.file.path, req.file.mimetype);

  res.status(201).json({
    id:             result.lastInsertRowid,
    application_id: app.id,
    file_name:      req.file.originalname,
    mime_type:      req.file.mimetype,
  });
});

// ─── GET /api/intake/track ────────────────────────────────────────────────────
// Public endpoint — track status by queue number or phone.
router.get('/track', (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Query required' });
  const term = q.trim();

  let app = /^\d+$/.test(term)
    ? db.prepare(
        'SELECT id, name, status, queue_number, created_at FROM applications WHERE queue_number = ? AND deleted_at IS NULL'
      ).get(Number(term))
    : null;

  if (!app) {
    app = db.prepare(
      'SELECT id, name, status, queue_number, created_at FROM applications WHERE phone = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get(term);
  }

  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json(app);
});

module.exports = router;
