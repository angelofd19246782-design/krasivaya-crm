# PULSAR

**Premium operations console for client signals, documents, and team coordination.**

A control-plane CRM with mission-control UX, real-time analytics, and Telegram bot integration. Vanilla HTML/CSS/JS frontend, Node.js + Express backend, SQLite storage.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — set SESSION_SECRET and BOT_API_TOKEN

# 3. Start the server
npm start          # production
npm run dev        # development (auto-restart)
```

Server runs at **http://localhost:3000**

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Employee | `employee` | `employee123` |

> **Change passwords immediately after first login** via Settings → Change Password.

## Pages

| URL | Description |
|-----|-------------|
| `/crm.html` | CRM dashboard (requires login) |
| `/login` | Sign-in page |
| `/intake.html` | Public request submission form |
| `/index.html` | Bot widget demo |

## Seed Test Data

```bash
node seed.js           # add ~200 realistic test records
node seed.js --reset   # wipe seed records and re-seed
```

## Bot API

The bot submits applications via a token-authenticated REST API.

**Header:** `x-bot-token: <BOT_API_TOKEN from .env>`

```http
POST /api/bot/application
Content-Type: application/json

{
  "name": "Ivan Petrov",
  "phone": "+7 900 123-4567",
  "comment": "Request description",
  "external_id": "tg_123456"
}
```

Response: `{ "id": 42, "queue_number": 15 }`

Attach a file after creation:
```http
POST /api/bot/application/42/attachment
x-bot-token: <token>
Content-Type: multipart/form-data

file=<binary>
```

## Project Structure

```
├── server.js          — Express server
├── db.js              — SQLite schema + seed
├── middleware.js       — Auth guards
├── upload.js           — Multer file upload config
├── routes/
│   ├── auth.js        — Login / logout / change password
│   ├── applications.js — CRUD for applications
│   ├── attachments.js  — File upload/download
│   ├── notes.js        — Per-application notes
│   ├── users.js        — User management (admin)
│   ├── stats.js        — Dashboard analytics
│   ├── intake.js       — Public intake endpoint
│   └── bot.js          — Bot API (token-auth)
├── crm.html            — CRM single-page app
├── login.html          — Login page
├── intake.html         — Public request form
├── index.html          — Bot widget
└── seed.js             — Test data generator
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `SESSION_SECRET` | Cookie signing secret | *(change this!)* |
| `BOT_API_TOKEN` | Bot API bearer token | *(change this!)* |

## Tech Stack

- **Backend:** Node.js 24, Express 4, `node:sqlite` (built-in)
- **Auth:** `express-session` + `bcryptjs`, session stored in SQLite
- **Frontend:** Vanilla JS, Chart.js 4, single-file SPA
- **Uploads:** Multer (local disk, `uploads/` folder)
