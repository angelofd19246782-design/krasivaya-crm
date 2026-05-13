'use strict';

const express = require('express');
const db      = require('../db');
const { requireLogin } = require('../middleware');

const router = express.Router({ mergeParams: true });

// GET /api/applications/:appId/notes
router.get('/', requireLogin, (req, res) => {
  const { appId } = req.params;
  const user = req.session.user;

  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const notes = db.prepare(`
    SELECT n.id, n.application_id, n.content, n.created_at, u.username AS author
    FROM   notes n
    LEFT JOIN users u ON n.user_id = u.id
    WHERE  n.application_id = ?
    ORDER  BY n.created_at DESC
  `).all(appId);

  res.json(notes);
});

// POST /api/applications/:appId/notes
router.post('/', requireLogin, (req, res) => {
  const { appId } = req.params;
  const user = req.session.user;
  const { content } = req.body;

  if (!content?.trim())       return res.status(400).json({ error: 'Content is required' });
  if (content.length > 10000) return res.status(400).json({ error: 'Content: max 10000 chars' });

  const app = db.prepare('SELECT * FROM applications WHERE id = ? AND deleted_at IS NULL').get(appId);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (user.role === 'employee' && app.assigned_employee_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const result = db.prepare(`
    INSERT INTO notes (application_id, user_id, content) VALUES (?, ?, ?)
  `).run(appId, user.id, content.trim());

  res.status(201).json({
    id:             result.lastInsertRowid,
    application_id: Number(appId),
    content:        content.trim(),
    author:         user.username,
    created_at:     new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
});

module.exports = router;
