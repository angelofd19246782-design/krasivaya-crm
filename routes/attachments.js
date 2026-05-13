'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { upload, UPLOADS_DIR } = require('../upload');
const { requireLogin } = require('../middleware');

// ─── Router A: /api/applications/:appId/attachments ──────────────────────────
// Mount with mergeParams so :appId is accessible
const appRouter = express.Router({ mergeParams: true });

// GET /api/applications/:appId/attachments
appRouter.get('/', requireLogin, (req, res) => {
  const { appId } = req.params;
  const user = req.session.user;

  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rows = db.prepare(`
    SELECT id, application_id, file_name, mime_type, created_at
    FROM   attachments
    WHERE  application_id = ?
    ORDER  BY created_at DESC
  `).all(appId);

  res.json(rows);
});

// POST /api/applications/:appId/attachments
appRouter.post('/', requireLogin, upload.single('file'), (req, res) => {
  const { appId } = req.params;
  const user = req.session.user;

  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL').get(appId);
  if (!app) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Application not found' });
  }

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const result = db.prepare(`
    INSERT INTO attachments (application_id, file_name, file_path, mime_type)
    VALUES (?, ?, ?, ?)
  `).run(appId, req.file.originalname, req.file.path, req.file.mimetype);

  res.status(201).json({
    id:             result.lastInsertRowid,
    application_id: Number(appId),
    file_name:      req.file.originalname,
    mime_type:      req.file.mimetype,
    created_at:     new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
});

// ─── Router B: /api/attachments/:id ──────────────────────────────────────────
const attRouter = express.Router();

// GET /api/attachments/:id/view
attRouter.get('/:id/view', requireLogin, (req, res) => {
  const user = req.session.user;
  const att  = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  // Verify application access
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(att.application_id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(att.file_path)) return res.status(404).json({ error: 'File not found on disk' });

  const inline = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(att.mime_type);

  res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.file_name)}"`,
  );
  res.sendFile(path.resolve(att.file_path));
});

// DELETE /api/attachments/:id
attRouter.delete('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const att  = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(att.application_id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Remove file from disk
  try { fs.unlinkSync(att.file_path); } catch {}
  db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id);
  res.json({ ok: true });
});

module.exports = { appRouter, attRouter };
