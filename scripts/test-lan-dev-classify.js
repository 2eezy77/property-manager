#!/usr/bin/env node
/**
 * Unit checks for LAN interface address classification (beyond CORS host allowlist).
 * Run: node scripts/test-lan-dev-classify.js
 */
'use strict';

const { classifyAddress, formatUiUrl } = require('../src/utils/lan-dev');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(classifyAddress({ name: 'eth0', address: '169.254.1.2' }) === 'skip', 'link-local skipped');
assert(classifyAddress({ name: 'vEthernet (WSL)', address: '172.20.0.1' }) === 'skip', 'WSL/vEthernet skipped');
assert(classifyAddress({ name: 'Hyper-V Virtual', address: '192.168.50.1' }) === 'skip', 'Hyper-V name skipped');
assert(classifyAddress({ name: 'VirtualBox Host', address: '10.0.2.15' }) === 'skip', 'VirtualBox name skipped');
assert(classifyAddress({ name: 'VMware Network', address: '192.168.56.1' }) === 'skip', 'VMware name skipped');

assert(classifyAddress({ name: 'tailscale0', address: '100.64.1.9' }) === 'tailscale', 'tailscale iface + CGNAT');
assert(classifyAddress({ name: 'eth0', address: '100.100.2.3' }) === 'tailscale', 'Tailscale CGNAT by address alone');
assert(classifyAddress({ name: 'Tailscale', address: '192.168.1.50' }) === 'tailscale', 'Tailscale by iface name');

assert(classifyAddress({ name: 'en0', address: '192.168.1.20' }) === 'lan', '192.168.* is lan');
assert(classifyAddress({ name: 'wlan0', address: '10.0.0.8' }) === 'lan', '10.* is lan');
assert(classifyAddress({ name: 'enp0s3', address: '172.16.0.4' }) === 'lan', '172.16.* is lan');
assert(classifyAddress({ name: 'enp0s3', address: '172.31.255.10' }) === 'lan', '172.31.* is lan');

assert(classifyAddress({ name: 'eth0', address: '8.8.8.8' }) === 'other', 'public IP is other');
assert(classifyAddress({ name: 'eth0', address: '172.15.0.1' }) === 'other', '172.15.* not RFC1918 lan');
assert(classifyAddress({ name: 'eth0', address: '172.32.0.1' }) === 'other', '172.32.* not RFC1918 lan');

assert(formatUiUrl('192.168.1.5', 5173) === 'http://192.168.1.5:5173', 'formatUiUrl builds http URL');
assert(formatUiUrl(null) === null, 'formatUiUrl null ip → null');
assert(formatUiUrl('10.0.0.2', 3000) === 'http://10.0.0.2:3000', 'formatUiUrl respects uiPort');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll lan-dev-classify checks passed.');
