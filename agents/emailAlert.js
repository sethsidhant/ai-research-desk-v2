// emailAlert.js — fallback email alerts via Gmail SMTP
// Set GMAIL_USER + GMAIL_APP_PASSWORD in Railway env + .env.local
// ALERT_EMAIL_TO is the destination (pseth2000@yahoo.com)
require('dotenv').config({ path: '../.env.local' });

const nodemailer = require('nodemailer');

const GMAIL_USER     = process.env.GMAIL_USER;
const GMAIL_PASS     = process.env.GMAIL_APP_PASSWORD;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || 'pseth2000@yahoo.com';

let transporter = null;

function getTransporter() {
  if (!GMAIL_USER || !GMAIL_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
  }
  return transporter;
}

// Strip Telegram Markdown symbols for plain-text email body
function stripMarkdown(text) {
  return text
    .replace(/\*([^*]+)\*/g, '$1')   // *bold*
    .replace(/_([^_]+)_/g,   '$1')   // _italic_
    .replace(/`([^`]+)`/g,   '$1')   // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url)
}

// Derive a short subject from the first line of the alert
function makeSubject(text) {
  const first = stripMarkdown(text).split('\n')[0].slice(0, 80);
  return `[Oasis Alert] ${first}`;
}

async function sendEmail(text) {
  const t = getTransporter();
  if (!t) {
    console.warn('[emailAlert] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping email');
    return;
  }
  try {
    await t.sendMail({
      from:    `"Oasis Alerts" <${GMAIL_USER}>`,
      to:      ALERT_EMAIL_TO,
      subject: makeSubject(text),
      text:    stripMarkdown(text),
    });
  } catch (err) {
    console.error('[emailAlert] Send error:', err.message);
  }
}

module.exports = { sendEmail };
