// index.js — main entry point for Railway
// Runs all watchers in a single process
require('dotenv').config({ path: '../.env.local' });

const listener      = require('./listener');
const indexWatcher  = require('./indexWatcher');
const stockWatcher  = require('./stockWatcher');
const filingWatcher = require('./filingWatcher');

const { ready } = require('./kiteClient');

async function main() {
  console.log('[main] Starting all watchers...');
  await ready; // wait for fresh Kite token before first poll
  indexWatcher.start();
  stockWatcher.start();
  filingWatcher.start();
  // listener.js starts itself on require
}

main();
