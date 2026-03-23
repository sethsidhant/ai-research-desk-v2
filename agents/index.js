// index.js — main entry point for Railway
// Runs all watchers in a single process
require('dotenv').config({ path: '../.env.local' });

const listener      = require('./listener');
const indexWatcher  = require('./indexWatcher');
const stockWatcher  = require('./stockWatcher');
const filingWatcher = require('./filingWatcher');

console.log('[main] Starting all watchers...');
indexWatcher.start();
stockWatcher.start();
filingWatcher.start();
// listener.js starts itself on require
