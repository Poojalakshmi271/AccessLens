/* =====================================================================
   ACCESSLENS – server.js  (v2 – Full Backend)
   Security: helmet + rate-limit
   SMS: Twilio (env-gated, console fallback)
   APIs: /api/health · /api/sos · /api/detection-log
         /api/sos-history · /api/feedback
   NOTE: optional – the front-end also works as a static site (GitHub Pages).
   In-memory stores persisted to JSON files on disk
   ===================================================================== */

'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const cors       = require('cors');
const fs         = require('fs');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Data directory (for simple JSON persistence) ───────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── In-memory stores ────────────────────────────────────
let sosHistory      = loadJSON('sos-history.json',      []);
let detectionLog    = loadJSON('detection-log.json',    []);
let userSettings    = loadJSON('user-settings.json',    {});
let feedbackStore   = loadJSON('feedback.json',         []);

function loadJSON(filename, fallback) {
  const file = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.warn(`Could not load ${filename}:`, e.message); }
  return fallback;
}

function saveJSON(filename, data) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  } catch (e) { console.warn(`Could not save ${filename}:`, e.message); }
}

// ── Twilio (optional – only if env vars are set) ────────
let twilioClient = null;
const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_ENABLED = TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM
  && !TWILIO_SID.startsWith('your_');

if (TWILIO_ENABLED) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
    console.log('✅ Twilio SMS integration enabled');
  } catch (e) {
    console.warn('⚠ Twilio module not found. Run: npm install twilio');
  }
} else {
  console.log('ℹ  Twilio not configured – SMS will be logged to console only');
  console.log('   Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env to enable SMS');
}

// ── Middleware ──────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));

// Helmet with relaxed CSP so TF.js / Leaflet CDN work in dev
app.use(helmet({
  contentSecurityPolicy: false,  // Disabled for CDN usage; enable and tune in prod
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate Limiting ───────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const sosLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1 minute
  max: 5,
  message: { error: 'SOS rate limit exceeded.' },
});

app.use('/api/', generalLimiter);
app.use('/api/sos', sosLimiter);

// ── Input Sanitiser ─────────────────────────────────────
function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

// ── Admin guard: protected routes are DISABLED unless ADMIN_KEY is set in production
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    if (IS_PROD) return res.status(503).json({ error: 'Admin endpoints disabled: set ADMIN_KEY.' });
    return next(); // open in local dev only
  }
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// E.164 phone check (+ followed by 8–15 digits)
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

// ── Helper: send SMS via Twilio ─────────────────────────
async function sendSMS(toNumber, body) {
  if (!twilioClient) {
    console.log(`[SMS CONSOLE] To: ${toNumber}\nMessage: ${body}`);
    return { success: true, method: 'console' };
  }
  try {
    const msg = await twilioClient.messages.create({
      from: TWILIO_FROM,
      to: toNumber,
      body,
    });
    console.log(`✅ SMS sent – SID: ${msg.sid}`);
    return { success: true, method: 'twilio', sid: msg.sid };
  } catch (e) {
    console.error('❌ Twilio SMS error:', e.message);
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════

// ── GET /api/health ─────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    twilio: Boolean(TWILIO_ENABLED && twilioClient),
    stats: {
      sosEvents:     sosHistory.length,
      detections:    detectionLog.length,
      feedbackItems: feedbackStore.length,
    },
  });
});

// ── POST /api/sos ───────────────────────────────────────
app.post('/api/sos', async (req, res) => {
  const { contact, message, location, timestamp, contactPhone } = req.body;
  const safeContact  = sanitize(contact || 'Not provided');
  const safeMessage  = sanitize(message || 'Emergency SOS activated from AccessLens.');
  const rawPhone     = String(contactPhone || '').replace(/[^\d+]/g, '');
  const safePhone    = PHONE_RE.test(rawPhone) ? rawPhone : '';
  const ts           = sanitize(timestamp || new Date().toISOString());

  // Validate location if provided
  let loc = null;
  if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    loc = {
      lat: Math.round(location.lat * 1e6) / 1e6,
      lng: Math.round(location.lng * 1e6) / 1e6,
    };
  }

  // Build human-readable log entry
  const mapsLink = loc
    ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
    : null;

  console.log('\n' + '='.repeat(44));
  console.log('🚨  EMERGENCY SOS ACTIVATED  🚨');
  console.log('='.repeat(44));
  console.log(`Time     : ${ts}`);
  console.log(`Contact  : ${safeContact}${safePhone ? ' · ' + safePhone : ''}`);
  console.log(`Message  : ${safeMessage}`);
  if (loc) {
    console.log(`Location : ${loc.lat}, ${loc.lng}`);
    console.log(`Maps     : ${mapsLink}`);
  } else {
    console.log('Location : GPS unavailable');
  }
  console.log('='.repeat(44) + '\n');

  // Persist SOS event
  const event = {
    id: Date.now(),
    timestamp: ts,
    contact: safeContact,
    phone: safePhone,
    message: safeMessage,
    location: loc,
    mapsLink,
  };
  sosHistory.unshift(event);
  if (sosHistory.length > 100) sosHistory = sosHistory.slice(0, 100); // cap
  saveJSON('sos-history.json', sosHistory);

  // Build SMS body
  let smsBody = `🚨 EMERGENCY SOS – AccessLens\nFrom: ${safeContact}\n${safeMessage}`;
  if (loc) smsBody += `\nLocation: ${mapsLink}`;
  smsBody += `\nTime: ${new Date(ts).toLocaleString()}`;

  // Send SMS if phone provided
  let smsResult = null;
  if (safePhone) {
    smsResult = await sendSMS(safePhone, smsBody);
  } else {
    console.log('[SOS] No valid contact phone number – skipping SMS');
    smsResult = { success: false, reason: 'no_phone' };
  }

  res.status(200).json({
    success: true,
    message: 'SOS received and processed.',
    event: { id: event.id, timestamp: event.timestamp },
    sms: smsResult,
    details: {
      contactNotified: !!safePhone,
      locationIncluded: !!loc,
      twilioEnabled: Boolean(TWILIO_ENABLED && twilioClient),
    },
  });
});

// ── GET /api/sos-history ────────────────────────────────
// Simple admin endpoint – protect with env secret in production
app.get('/api/sos-history', requireAdmin, (req, res) => {
  res.json({ count: sosHistory.length, events: sosHistory });
});

// ── POST /api/detection-log ─────────────────────────────
app.post('/api/detection-log', (req, res) => {
  const { label, distance, risk, timestamp } = req.body;
  if (!label) return res.status(400).json({ error: 'label is required' });

  const entry = {
    id:        Date.now(),
    label:     sanitize(label),
    distance:  typeof distance === 'number' ? distance : null,
    risk:      ['high','medium','low'].includes(risk) ? risk : 'low',
    timestamp: sanitize(timestamp || new Date().toISOString()),
  };

  detectionLog.unshift(entry);
  if (detectionLog.length > 500) detectionLog = detectionLog.slice(0, 500);
  saveJSON('detection-log.json', detectionLog);

  res.status(201).json({ success: true, entry });
});

// ── GET /api/detection-log ──────────────────────────────
app.get('/api/detection-log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ count: detectionLog.length, entries: detectionLog.slice(0, limit) });
});

// ── DELETE /api/detection-log ───────────────────────────
app.delete('/api/detection-log', requireAdmin, (req, res) => {
  detectionLog = [];
  saveJSON('detection-log.json', detectionLog);
  res.json({ success: true, message: 'Detection log cleared.' });
});

// ── POST /api/feedback ──────────────────────────────────
app.post('/api/feedback', (req, res) => {
  const { type, message, rating } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const entry = {
    id:        Date.now(),
    type:      sanitize(type || 'general', 30),
    message:   sanitize(message, 500),
    rating:    typeof rating === 'number' ? Math.min(5, Math.max(1, rating)) : null,
    timestamp: new Date().toISOString(),
  };

  feedbackStore.unshift(entry);
  if (feedbackStore.length > 200) feedbackStore = feedbackStore.slice(0, 200);
  saveJSON('feedback.json', feedbackStore);

  console.log(`💬 Feedback received [${entry.type}]: ${entry.message.slice(0, 80)}`);
  res.status(201).json({ success: true, id: entry.id });
});

// ── Fallback to SPA ─────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// JSON error handler (bad JSON bodies etc.)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

// ── Start ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🚀  AccessLens Server v2.0`);
  console.log(`    http://localhost:${PORT}`);
  console.log('='.repeat(50));
  console.log(`   Static   → /public`);
  console.log(`   Health   → GET  /api/health`);
  console.log(`   SOS      → POST /api/sos`);
  console.log(`   SOS Hist → GET  /api/sos-history`);
  console.log(`   Detect   → POST /api/detection-log`);
  console.log(`   Feedback → POST /api/feedback`);
  console.log('='.repeat(50) + '\n');
});
