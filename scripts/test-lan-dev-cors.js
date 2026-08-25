#!/usr/bin/env node
/**
 * Unit checks for LAN / Tailscale CORS origin allowlist.
 * Run: node scripts/test-lan-dev-cors.js
 */
'use strict';

const {
  isTailscaleIPv4,
  isPrivateLanHost,
  isPrivateLanOrigin,
} = require('../src/utils/lan-dev');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(isTailscaleIPv4('100.64.1.2') === true, 'Tailscale 100.64.* allowed');
check(isTailscaleIPv4('100.127.0.1') === true, 'Tailscale 100.127.* allowed');
check(isTailscaleIPv4('100.63.0.1') === false, '100.63.* is not Tailscale CGNAT');
check(isTailscaleIPv4('100.128.0.1') === false, '100.128.* is not Tailscale CGNAT');
check(isTailscaleIPv4('192.168.1.1') === false, 'RFC1918 is not Tailscale');
check(isTailscaleIPv4(null) === false, 'null hostname not Tailscale');

check(isPrivateLanHost('localhost') === true, 'localhost is private');
check(isPrivateLanHost('127.0.0.1') === true, 'loopback is private');
check(isPrivateLanHost('192.168.0.10') === true, '192.168.* is private');
check(isPrivateLanHost('10.0.0.5') === true, '10.* is private');
check(isPrivateLanHost('172.16.4.1') === true, '172.16.* is private');
check(isPrivateLanHost('172.31.255.1') === true, '172.31.* is private');
check(isPrivateLanHost('172.15.0.1') === false, '172.15.* is not private');
check(isPrivateLanHost('172.32.0.1') === false, '172.32.* is not private');
check(isPrivateLanHost('8.8.8.8') === false, 'public IP not private');
check(isPrivateLanHost('100.64.2.3') === true, 'Tailscale host is private');
check(isPrivateLanHost('') === false, 'empty host not private');

check(isPrivateLanOrigin('http://192.168.1.5:5173') === true, 'LAN http origin allowed');
check(isPrivateLanOrigin('https://10.1.2.3') === true, 'LAN https origin allowed');
check(isPrivateLanOrigin('http://100.100.50.1:5173') === true, 'Tailscale origin allowed');
check(isPrivateLanOrigin('https://evil.com') === false, 'public origin rejected');
check(isPrivateLanOrigin('ftp://192.168.1.1') === false, 'non-http(s) rejected');
check(isPrivateLanOrigin('not a url') === false, 'malformed origin rejected');
check(isPrivateLanOrigin(null) === false, 'null origin rejected');
check(isPrivateLanOrigin('') === false, 'empty origin rejected');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll lan-dev-cors checks passed.');
