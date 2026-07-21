/**
 * Print LAN + Tailscale URLs for dual-machine testing.
 * Usage: npm run lan:urls
 */
const { getDevAccessUrls, formatUiUrl } = require('../src/utils/lan-dev');

const apiPort = process.env.PORT || 8080;
const uiPort = process.env.VITE_PORT || 5173;
const { lan, lanInterface, tailscale, tailscaleInterface, all } = getDevAccessUrls();

console.log('\nDual-machine testing — LAN + Tailscale\n');

if (!lan && !tailscale) {
  console.log('No LAN or Tailscale IPv4 detected. Use localhost on this machine only.\n');
  process.exit(0);
}

console.log('Host — two terminals:');
console.log('  npm run dev:lan');
console.log('  cd client && npm run dev:lan\n');

console.log('Mac mini — open in browser (either works if both are on LAN + Tailscale):');
if (lan) {
  console.log(`  LAN (${lanInterface || 'wifi/ethernet'}):  ${formatUiUrl(lan, uiPort)}`);
}
if (tailscale) {
  console.log(`  Tailscale (${tailscaleInterface || 'tailscale'}): ${formatUiUrl(tailscale, uiPort)}`);
}
console.log('');

const smokeIp = lan || tailscale;
console.log('Smoke test from Mac mini:');
console.log(`  API_URL=http://${smokeIp}:${apiPort} node scripts/smoke-test.js\n`);

if (all.length > 0) {
  console.log('All usable addresses on this host:');
  for (const a of all) {
    const tag = a.kind === 'tailscale' ? 'Tailscale' : a.kind === 'lan' ? 'LAN' : 'Other';
    console.log(`  [${tag}] ${a.name}: ${formatUiUrl(a.address, uiPort)}`);
  }
  console.log('');
}
