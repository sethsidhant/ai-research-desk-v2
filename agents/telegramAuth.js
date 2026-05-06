// telegramAuth.js — one-time local auth to generate Telegram MTProto session string
// Run this locally (from agents/ dir): node telegramAuth.js
// It will prompt for the OTP sent to your Telegram app, then save the session to Supabase.
// After this, trumpWatcher.js on Railway uses the saved session — no phone/OTP needed again.

require('dotenv').config({ path: '../.env.local' });
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { createClient }   = require('@supabase/supabase-js');
const readline           = require('readline');

const API_ID   = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const PHONE    = process.env.TELEGRAM_PHONE;

if (!API_ID || !API_HASH || !PHONE) {
  console.error('Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_PHONE in .env.local');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  console.log(`\n[telegramAuth] Authenticating as ${PHONE}...\n`);

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => PHONE,
    phoneCode:   async () => await ask('Enter the OTP sent to your Telegram app: '),
    password:    async () => await ask('Enter 2FA password (press Enter if none): '),
    onError:     err  => console.error('[telegramAuth] Error:', err.message),
  });

  const sessionString = client.session.save();
  console.log('\n✅ Auth successful!');
  console.log('\nSession string:\n' + sessionString);

  const { error } = await supabase.from('app_settings').upsert(
    { key: 'telegram_session', value: sessionString },
    { onConflict: 'key' }
  );
  if (error) console.error('\n✗ Failed to save session to Supabase:', error.message);
  else       console.log('\n✅ Session saved to Supabase app_settings (key: telegram_session)');
  console.log('   Railway will pick it up automatically on next trumpWatcher start.\n');

  await client.disconnect();
  process.exit(0);
}

main().catch(e => { console.error('[telegramAuth]', e.message); process.exit(1); });
