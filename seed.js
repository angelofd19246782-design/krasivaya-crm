'use strict';

/**
 * Seed script — realistic dashboard test data
 * Usage:
 *   node seed.js          → adds records (skips if already seeded)
 *   node seed.js --reset  → wipes seed records and re-inserts fresh data
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'nexus.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Simple seedable PRNG (deterministic, reproducible) ──────────────────────
function makePrng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rng = makePrng(0xdeadbeef);
const rand = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = arr => arr[rand(0, arr.length - 1)];

// ─── Reference data ───────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Alexander','Alexei','Andrei','Anton','Artem','Boris','Dmitri','Evgeni',
  'Fyodor','Georgi','Igor','Ivan','Kirill','Konstantin','Leonid','Maxim',
  'Mikhail','Nikolai','Pavel','Roman','Sergei','Timur','Vladimir','Vitali',
  'Yuri','Elena','Anna','Ekaterina','Maria','Natalia','Olga','Svetlana',
  'Tatiana','Victoria','Oksana','Irina','Yulia','Ksenia','Daria','Sofia',
  'Aisha','Bauyrzhan','Daniyar','Yerlan','Zarina','Ainur','Bekzat','Nurlan',
  'Sanzhar','Mira','Ji-won','Min-jun','Soo-yeon','Da-eun','Hyun-soo',
  'Lena','Tomas','Erik','Marta','Viktor','Inna','Ruslan','Kira','Nadia',
];

const LAST_NAMES = [
  'Morozov','Kozlov','Petrov','Borisov','Vlasov','Nikitin','Sokolov',
  'Fedorov','Novikov','Ivanov','Smirnov','Kuznetsov','Popov','Lebedev',
  'Volkov','Orlov','Larin','Zaitsev','Belikov','Gusev','Titov','Stepanov',
  'Mikhailov','Romanov','Makarov','Frolov','Voronov','Kovalev','Belov',
  'Serov','Akhmedov','Isakov','Karimov','Nurbekov','Seitkali','Bekova',
  'Kim','Park','Lee','Choi','Jung','Han','Yoon','Lim','Cho','Shin',
  'Werner','Hoffmann','Schulz','Fischer','Weber','Wagner','Becker',
];

const COMMENTS = [
  'Construction permit application — need review of documents',
  'Business license renewal inquiry',
  'Property registration request — missing notary stamp',
  'Tax consultation for small business',
  'Legal advice on contract dispute',
  'Permit renewal — documents submitted, awaiting approval',
  'Document translation required — missing certified copies',
  'Land use change request',
  'Zoning variance application',
  'Utility connection approval request',
  'Building inspection scheduling',
  'Fire safety certificate request',
  'Environmental impact assessment inquiry',
  'Vehicle registration assistance',
  'Trademark registration consultation',
  'Social support application',
  'Business registration — sole proprietorship',
  'Import license application',
  'Export declaration assistance needed',
  'Health permit for food business',
  'Childcare facility licensing',
  'Education certificate legalization',
  'Pension fund inquiry',
  'Medical insurance coverage question',
  'Housing subsidy application',
  'Utility bill dispute resolution',
  'Noise complaint formal filing',
  'Neighborhood planning objection',
  'Sign permit for commercial property',
  'Sidewalk use permit',
  'Event permit for public gathering',
  'Alcohol license application',
  'Tourism operator registration',
  'Freelance activity registration',
  'Visa support document request',
  'Residency registration inquiry',
  'Name change application',
  'Birth certificate duplicate request',
  'Marriage certificate apostille',
  'Power of attorney notarization',
  'Document authentication for abroad',
  'Inheritance claim filing',
  'Real estate transaction support',
  'Mortgage registration assistance',
  'Debt restructuring consultation',
  'Court order enforcement inquiry',
  'Consumer rights complaint',
  'Refund request for overpaid tax',
  'Startup registration package',
  'Non-profit organization registration',
];

const SOURCES = ['crm', 'bot', 'web_form'];
const SOURCE_WEIGHTS = [0.25, 0.40, 0.35]; // bot-heavy (realistic for this type of CRM)

const STATUSES = ['new', 'in_progress', 'completed', 'incomplete'];

function weightedPick(items, weights) {
  const r = rng();
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += weights[i];
    if (r < sum) return items[i];
  }
  return items[items.length - 1];
}

// ─── Date/time helpers ────────────────────────────────────────────────────────

// Today is 2026-04-20
const TODAY = new Date('2026-04-20T23:59:59Z');

function daysAgo(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function randomTimestamp(date) {
  // Realistic hour distribution: morning peak (8-11), afternoon (13-17), some evening
  const hourBuckets = [
    { lo: 7,  hi: 9,  w: 0.20 },
    { lo: 9,  hi: 12, w: 0.28 },
    { lo: 12, hi: 14, w: 0.15 },
    { lo: 14, hi: 17, w: 0.25 },
    { lo: 17, hi: 20, w: 0.09 },
    { lo: 20, hi: 23, w: 0.03 },
  ];
  const bucket = weightedPick(hourBuckets, hourBuckets.map(b => b.w));
  const hour   = rand(bucket.lo, bucket.hi - 1);
  const minute = rand(0, 59);
  const second = rand(0, 59);

  const d = new Date(date);
  d.setUTCHours(hour, minute, second, 0);
  // Return as SQLite datetime string (local-ish, no Z suffix to match existing data format)
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// ─── Volume distribution over 30 days ────────────────────────────────────────
// Strategy:
//   - base trend: low start (~1-3/day) growing to ~5-8/day in recent days
//   - organic noise (×0.4 to ×2.0 multiplier)
//   - 5 spike days (8-15 requests) scattered in the period
//   - a few quiet days (0-1 requests)
//   - last 5 days: guaranteed moderate activity

function buildDayVolumes(totalTarget) {
  const days = 30;
  const volumes = [];

  // Linear growth base: 2 requests/day at day30 → 7 at day1
  for (let i = 0; i < days; i++) {
    const daysFromEnd = i;           // 0 = today, 29 = 30 days ago
    const base = 7 - daysFromEnd * (5 / (days - 1));
    const noise = 0.35 + rng() * 1.6;
    volumes.push(Math.max(0, Math.round(base * noise)));
  }

  // Inject 5 spike days at random positions (not in last 2 days or first 5)
  const spikePositions = new Set();
  while (spikePositions.size < 5) {
    spikePositions.add(rand(5, 25));
  }
  spikePositions.forEach(pos => { volumes[pos] = rand(9, 16); });

  // Inject 4 quiet days (avoid last 3 days)
  const quietPositions = new Set();
  while (quietPositions.size < 4) {
    const p = rand(5, 27);
    if (!spikePositions.has(p)) quietPositions.add(p);
  }
  quietPositions.forEach(pos => { volumes[pos] = rand(0, 1); });

  // Ensure last 5 days have at least 3 requests each
  for (let i = 0; i < 5; i++) {
    if (volumes[i] < 3) volumes[i] = rand(3, 7);
  }

  // Scale to match target total
  const rawTotal = volumes.reduce((a, b) => a + b, 0);
  const scale    = totalTarget / rawTotal;
  return volumes.map((v, i) => {
    const scaled = Math.round(v * scale);
    // Keep last 5 days reasonable
    return i < 5 ? Math.max(3, scaled) : Math.max(0, scaled);
  });
}

// ─── Status assignment ────────────────────────────────────────────────────────
// Older requests are more likely completed; newer requests more likely new/in_progress

function assignStatus(daysAgoVal) {
  // probability shifts with age
  const ageFactor = Math.min(1, daysAgoVal / 20); // 0 = today, 1 = old
  const pCompleted   = 0.12 + ageFactor * 0.32;   // older → more completed
  const pIncomplete  = 0.04 + ageFactor * 0.06;
  const pInProgress  = 0.20 + (1 - ageFactor) * 0.12;
  const pNew         = 1 - pCompleted - pIncomplete - pInProgress;
  return weightedPick(STATUSES, [pNew, pInProgress, pCompleted, pIncomplete]);
}

// ─── Phone generator ─────────────────────────────────────────────────────────
function randomPhone() {
  const prefixes = ['+7 900', '+7 901', '+7 902', '+7 903', '+7 905',
                    '+7 906', '+7 908', '+7 910', '+7 915', '+7 916',
                    '+7 920', '+7 921', '+7 925', '+7 926', '+7 950',
                    '+7 960', '+7 961', '+7 962', '+7 963', '+7 964'];
  const p = pick(prefixes);
  const n1 = String(rand(100, 999));
  const n2 = String(rand(10, 99)).padStart(2, '0');
  const n3 = String(rand(10, 99)).padStart(2, '0');
  return `${p} ${n1}-${n2}-${n3}`;
}

// ─── Main seeding ─────────────────────────────────────────────────────────────

const SEED_MARKER = 'SEED_2026';
const alreadySeeded = db.prepare(
  `SELECT COUNT(*) AS c FROM applications WHERE comment LIKE ?`
).get(`%[${SEED_MARKER}]%`).c;

const isReset = process.argv.includes('--reset');

if (alreadySeeded > 0 && !isReset) {
  console.log(`Seed already applied (${alreadySeeded} records). Use --reset to re-seed.`);
  process.exit(0);
}

if (isReset && alreadySeeded > 0) {
  db.exec(`DELETE FROM applications WHERE comment LIKE '%[${SEED_MARKER}]%'`);
  console.log(`Cleared ${alreadySeeded} previously seeded records.`);
}

// Get current max queue_number
const maxQ = (db.prepare('SELECT COALESCE(MAX(queue_number), 0) AS m FROM applications').get().m) || 0;

// Get employee/admin IDs for assignment
const adminRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
const empRows  = db.prepare(`SELECT id FROM users WHERE role = 'employee'`).all();
const allUsers = [adminRow, ...empRows].filter(Boolean).map(r => r.id);

const TARGET_TOTAL = 200;
const volumes = buildDayVolumes(TARGET_TOTAL);
const actualTotal = volumes.reduce((a, b) => a + b, 0);

const ins = db.prepare(`
  INSERT INTO applications
    (name, phone, email, comment, status, source, queue_number, assigned_employee_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let inserted = 0;
let queueNum = maxQ + 1;

db.exec('BEGIN');
try {
  // volumes[0] = today, volumes[29] = 30 days ago
  for (let dayIdx = 0; dayIdx < volumes.length; dayIdx++) {
    const daysBack = dayIdx;
    const count    = volumes[dayIdx];
    const date     = daysAgo(daysBack);

    for (let k = 0; k < count; k++) {
      const firstName  = pick(FIRST_NAMES);
      const lastName   = pick(LAST_NAMES);
      const name       = `${firstName} ${lastName}`;
      const phone      = rng() > 0.08 ? randomPhone() : null; // 8% no phone
      const email      = rng() > 0.60                          // 40% have email
        ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(10,99)}@example.com`
        : null;
      const baseComment = pick(COMMENTS);
      const comment     = `${baseComment} [${SEED_MARKER}]`;
      const status      = assignStatus(daysBack);
      const source      = weightedPick(SOURCES, SOURCE_WEIGHTS);
      const ts          = randomTimestamp(date);

      // Assign employee only for in_progress/completed
      let assignedId = null;
      if ((status === 'in_progress' || status === 'completed') && allUsers.length > 0) {
        assignedId = rng() > 0.15 ? pick(allUsers) : null;
      }

      ins.run(name, phone, email, comment, status, source, queueNum++, assignedId, ts, ts);
      inserted++;
    }
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const stats = db.prepare(`
  SELECT status, COUNT(*) AS c
  FROM applications
  WHERE comment LIKE ?
  GROUP BY status
`).all(`%[${SEED_MARKER}]%`);

const dayStats = db.prepare(`
  SELECT DATE(created_at) AS day, COUNT(*) AS c
  FROM applications
  WHERE comment LIKE ?
  GROUP BY day
  ORDER BY day
`).all(`%[${SEED_MARKER}]%`);

console.log(`\n✓ Seeded ${inserted} records (target was ${TARGET_TOTAL})\n`);
console.log('Status distribution:');
stats.forEach(r => console.log(`  ${r.status.padEnd(14)} ${r.c}`));
console.log('\nDaily volume (last 30 days):');
dayStats.forEach(r => {
  const bar = '█'.repeat(Math.round(r.c / 1.5));
  console.log(`  ${r.day}  ${String(r.c).padStart(3)}  ${bar}`);
});
console.log('\nTo re-seed fresh:  node seed.js --reset');
