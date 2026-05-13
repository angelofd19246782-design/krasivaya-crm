'use strict';

const express = require('express');
const fs      = require('fs');
const db      = require('../db');
const { upload } = require('../upload');

const router = express.Router();

// ─── Token guard ──────────────────────────────────────────────────────────────
function requireBotToken(req, res, next) {
  const token = req.headers['x-bot-token'];
  if (!token || token !== process.env.BOT_API_TOKEN) {
    return res.status(401).json({ error: 'Invalid or missing bot token' });
  }
  next();
}

// ─── POST /api/bot/application ────────────────────────────────────────────────
// External bot creates an application.
// Returns { id, queue_number } — bot uses id to attach files.
router.post('/application', requireBotToken, (req, res) => {
  const {
    name, phone, email, comment,
    source      = 'bot',
    external_id,
  } = req.body;

  if (!name?.trim())                    return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200)                return res.status(400).json({ error: 'Name: max 200 chars' });
  if (phone  && phone.length   > 50)    return res.status(400).json({ error: 'Phone: max 50 chars' });
  if (email  && email.length   > 200)   return res.status(400).json({ error: 'Email: max 200 chars' });
  if (comment && comment.length > 5000) return res.status(400).json({ error: 'Comment: max 5000 chars' });

  // Deduplication by external_id
  if (external_id?.trim()) {
    const existing = db.prepare(
      'SELECT id, queue_number FROM applications WHERE external_id = ? AND source = ?'
    ).get(external_id.trim(), source);

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
    phone       || null,
    email       || null,
    comment     || null,
    source,
    external_id?.trim() || null,
    qn,
  );

  res.status(201).json({ id: result.lastInsertRowid, queue_number: qn });
});

// ─── POST /api/bot/application/:id/attachment ─────────────────────────────────
// External bot attaches a file to an existing application.
router.post('/application/:id/attachment', requireBotToken, upload.single('file'), (req, res) => {
  const app = db.prepare(
    'SELECT id FROM applications WHERE id = ? AND deleted_at IS NULL'
  ).get(req.params.id);

  if (!app) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Application not found' });
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

module.exports = router;
