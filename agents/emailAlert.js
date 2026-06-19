// emailAlert.js — email alerts via Resend HTTP API (port 443, works on Railway)
require('dotenv').config({ path: '../.env.local' });

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const ALERT_EMAIL_TO  = process.env.ALERT_EMAIL_TO || 'pseth2000@yahoo.com';

function stripMarkdown(text) {
  return text
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g,   '$1')
    .replace(/`([^`]+)`/g,   '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function makeSubject(text) {
  const first = stripMarkdown(text).split('\n')[0].slice(0, 80);
  return `[Oasis Alert] ${first}`;
}

async function sendEmail(text) {
  if (!RESEND_API_KEY) {
    console.warn('[emailAlert] RESEND_API_KEY not set — skipping email');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'Oasis Alerts <onboarding@resend.dev>',
        to:      [ALERT_EMAIL_TO],
        subject: makeSubject(text),
        text:    stripMarkdown(text),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[emailAlert] Resend error:', err);
    }
  } catch (err) {
    console.error('[emailAlert] Send error:', err.message);
  }
}

module.exports = { sendEmail };
