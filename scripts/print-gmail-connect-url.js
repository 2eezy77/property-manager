#!/usr/bin/env node
/** Print Gmail OAuth connect URL (owner login required). */
require('../src/config/env');
const http = require('http');

const email = process.argv[2] || process.env.EMAIL_DEV_OVERRIDE || 'owner@example.com';
const password = process.env.SMOKE_TEST_PASSWORD;
if (!password) {
  console.error('Set SMOKE_TEST_PASSWORD before running this script.');
  process.exit(1);
}

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = http.request({ hostname: 'localhost', port: 8080, path, method, headers }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    console.error('Login failed:', login.body);
    process.exit(1);
  }
  const connect = await req('GET', '/api/utilities/gmail/connect', null, login.body.accessToken);
  if (connect.status !== 200) {
    console.error('Connect URL failed:', connect.body);
    process.exit(1);
  }
  console.log(connect.body.url);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
