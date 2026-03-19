// runDailyPipeline.js
// Runs the full daily pipeline in sequence:
//   1. engine       — score all watchlisted stocks
//   2. newsAgent    — fetch BSE filings + news
//   3. summaryAgent — generate AI summaries
//   4. whatsappNotifier — send alerts
//
// Run daily at ~3:05 AM Dublin (8:35 AM IST), after refreshKiteToken.js

const { execSync } = require('child_process');
const path = require('path');

const dir = __dirname;

function run(script) {
  const label = `[pipeline] ${script}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${label} — starting at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('─'.repeat(60));
  try {
    execSync(`node ${script}`, { cwd: dir, stdio: 'inherit', timeout: 10 * 60 * 1000 });
    console.log(`✅ ${script} done`);
  } catch (err) {
    console.error(`❌ ${script} failed:`, err.message);
    // Continue pipeline even if one step fails
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`[runDailyPipeline] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
console.log('═'.repeat(60));

run('engine.js');
run('newsAgent.js');
run('summaryAgent.js');
run('whatsappNotifier.js');

console.log(`\n${'═'.repeat(60)}`);
console.log(`✅ Daily pipeline complete — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
console.log('═'.repeat(60));
