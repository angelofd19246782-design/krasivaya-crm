'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// GET /api/users
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json(users);
});

// POST /api/users
router.post('/', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;

  if (!username?.trim())              return res.status(400).json({ error: 'Username is required' });
  if (username.length > 80)           return res.status(400).json({ error: 'Username: max 80 chars' });
  if (!password)                      return res.status(400).json({ error: 'Password is required' });
  if (password.length < 6)            return res.status(400).json({ error: 'Password: min 6 chars' });
  if (password.length > 200)          return res.status(400).json({ error: 'Password: max 200 chars' });
  if (!['admin','employee'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or employee' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const hash   = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'
  ).run(username.trim(), hash, role);

  res.status(201).json({
    id:         result.lastInsertRowid,
    username:   username.trim(),
    role,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
});

// PATCH /api/users/:id  — change role and/or reset password (admin only)
router.patch('/:id', requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { role, password } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role !== undefined) {
    if (!['admin', 'employee'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  }

  if (password) {
    if (password.length < 6)   return res.status(400).json({ error: 'Password: min 6 chars' });
    if (password.length > 200) return res.status(400).json({ error: 'Password: max 200 chars' });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, targetId);
  }

  const updated = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(targetId);
  res.json(updated);
});

// DELETE /api/users/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);

  // Prevent self-deletion
  if (targetId === req.session.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Unassign their applications before deleting
  db.prepare('UPDATE applications SET assigned_employee_id = NULL WHERE assigned_employee_id = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  res.json({ ok: true });
});

module.exports = router;
