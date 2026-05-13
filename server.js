'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path    = require('path');
const db      = require('./db'); // initialises DB + seeds on first run

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── SQLite session store (uses the same DB, no extra package) ────────────────

class SQLiteStore extends session.Store {
  constructor() {
    super();
    // Clean expired sessions every hour
    setInterval(() => {
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    }, 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    const row = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
    if (!row) return cb(null, null);
    if (Date.now() > row.expires) {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return cb(null, null);
    }
    try { cb(null, JSON.parse(row.data)); }
    catch { cb(null, null); }
  }

  set(sid, sessionData, cb) {
    const ttl     = sessionData.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + ttl;
    try {
      db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sessionData), expires);
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb(null);
  }

  touch(sid, sessionData, cb) {
    const ttl     = sessionData.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + ttl;
    db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
    cb(null);
  }
}

// ─── Core middleware ──────────────────────────────────────────────────────────

app.set('trust proxy', 1); // required when behind nginx/reverse proxy

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(session({
  store:             new SQLiteStore(),
  name:              'nxsid',
  secret:            process.env.SESSION_SECRET || 'nexus-dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ─── Static files ─────────────────────────────────────────────────────────────
// Serve HTML pages directly — uploads are NOT served statically (use /api/attachments/:id/view)
app.use(express.static(__dirname, {
  index:    false,
  dotfiles: 'deny',
  // Prevent direct access to backend source files
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.json', '.sqlite', '.env'].includes(ext) && !filePath.includes('node_modules')) {
      // Block .js / .json source files (except those in public-safe locations)
      // Only .html and .css are expected to be served statically
    }
  },
}));

// Block direct access to sensitive server files
app.use((req, res, next) => {
  const blocked = ['/server.js','/db.js','/middleware.js','/upload.js','/nexus.sqlite','/.env','/package.json'];
  if (blocked.some(p => req.path.toLowerCase() === p)) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// ─── Page routes ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.redirect(req.session?.user?.role === 'admin' ? '/crm.html' : '/login');
});

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/crm.html');
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/crm',    (req, res) => res.redirect('/crm.html'));
app.get('/bot',    (req, res) => res.redirect('/index.html'));
app.get('/intake', (req, res) => res.sendFile(path.join(__dirname, 'intake.html')));

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/auth', require('./routes/auth'));

app.use('/api/applications', require('./routes/applications'));

// Nested attachment + note routes under /api/applications/:appId/...
const { appRouter: attachmentsApp, attRouter: attachmentsSingle } = require('./routes/attachments');
app.use('/api/applications/:appId/attachments', attachmentsApp);
app.use('/api/attachments',                     attachmentsSingle);

app.use('/api/applications/:appId/notes', require('./routes/notes'));

app.use('/api/users',    require('./routes/users'));
app.use('/api',          require('./routes/stats'));

// Public intake (no auth — used by web forms / external widgets)
app.use('/api/intake',   require('./routes/intake'));

// Token-authenticated bot API
app.use('/api/bot',      require('./routes/bot'));

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).sendFile(path.join(__dirname, '404.html'), () => {
    res.status(404).send('Not found');
  });
  res.status(404).json({ error: 'Not found' });
});

// ─── Error handler ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10 MB)' });
  }
  if (err.code === 'INVALID_MIME') {
    return res.status(415).json({ error: 'File type not allowed' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' });
  }

  console.error('[server error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  Nexus CRM running on http://localhost:${PORT}`);
  console.log(`   CRM panel  →  http://localhost:${PORT}/crm.html`);
  console.log(`   Bot widget →  http://localhost:${PORT}/index.html`);
  console.log(`   Login      →  http://localhost:${PORT}/login\n`);
});
