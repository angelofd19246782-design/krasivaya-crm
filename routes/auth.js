'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireLogin } = require('../middleware');

const router = express.Router();

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = { id: user.id, username: user.username, role: user.role };

  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ user: req.session.user });
  });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('nxsid');
    res.json({ ok: true });
  });
});

// GET /auth/me
router.get('/me', requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

// POST /auth/change-password
router.post('/change-password', requireLogin, (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password)
    return res.status(400).json({ error: 'All fields are required' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'New password: min 6 characters' });
  if (new_password.length > 200)
    return res.status(400).json({ error: 'New password: max 200 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.user.id);
  res.json({ ok: true });
});

module.exports = router;
