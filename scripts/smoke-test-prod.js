#!/usr/bin/env node
/** Production smoke test — sets API_URL before loading helpers. */
process.env.API_URL = process.env.API_URL || 'https://www.monterorentals.com';
require('./smoke-test.js');
