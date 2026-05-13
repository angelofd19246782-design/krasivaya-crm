'use strict';

const express = require('express');
const db      = require('../db');
const { requireLogin, requireAdmin } = require('../middleware');

const router = express.Router();

// ─── GET /api/stats ───────────────────────────────────────────────────────────
// Dashboard overview — total active, trash count, breakdown by status
router.get('/stats', requireLogin, (req, res) => {
  const active = db.prepare(`
    SELECT
      COUNT(*)                                          AS total,
      SUM(status = 'new')                               AS new,
      SUM(status = 'in_progress')                       AS in_progress,
      SUM(status = 'completed')                         AS completed,
      SUM(status = 'incomplete')                        AS incomplete
    FROM applications
    WHERE deleted_at IS NULL
  `).get();

  const inTrash = db.prepare(
    `SELECT COUNT(*) AS c FROM applications WHERE deleted_at IS NOT NULL`
  ).get().c;

  // Daily counts for last 30 days — total
  const daily = db.prepare(`
    SELECT
      DATE(created_at) AS day,
      COUNT(*)         AS count
    FROM applications
    WHERE deleted_at IS NULL
      AND created_at >= DATE('now', '-30 days')
    GROUP BY day
    ORDER BY day ASC
  `).all();

  // Daily counts broken down by status (for per-card sparklines)
  const dailyByStatus = db.prepare(`
    SELECT
      DATE(created_at) AS day,
      status,
      COUNT(*)         AS count
    FROM applications
    WHERE deleted_at IS NULL
      AND created_at >= DATE('now', '-30 days')
    GROUP BY day, status
    ORDER BY day, status ASC
  `).all();

  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS count
    FROM applications
    WHERE deleted_at IS NULL
    GROUP BY source
    ORDER BY count DESC
  `).all();

  res.json({ active, inTrash, daily, dailyByStatus, bySource });
});

// ─── GET /api/employee-stats ─────────────────────────────────────────────────
// Per-employee breakdown: today / this week / this month / all time
router.get('/employee-stats', requireAdmin, (req, res) => {
  const employees = db.prepare(`SELECT id, username FROM users WHERE role = 'employee'`).all();

  const result = employees.map(emp => {
    const base = `
      FROM applications
      WHERE assigned_employee_id = ?
        AND deleted_at IS NULL
    `;

    const counts = (extra) => db.prepare(`
      SELECT
        COUNT(*)                    AS total,
        SUM(status = 'new')         AS new,
        SUM(status = 'in_progress') AS in_progress,
        SUM(status = 'completed')   AS completed,
        SUM(status = 'incomplete')  AS incomplete
      ${base} ${extra}
    `).get(emp.id);

    return {
      employee_id:   emp.id,
      username:      emp.username,
      today:         counts(`AND DATE(created_at) = DATE('now')`),
      this_week:     counts(`AND created_at >= DATE('now', 'weekday 0', '-7 days')`),
      this_month:    counts(`AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`),
      all_time:      counts(''),
    };
  });

  res.json(result);
});

module.exports = router;
