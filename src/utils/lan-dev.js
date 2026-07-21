/**
 * LAN + Tailscale dev helpers — test manager on one machine, tenant on another.
 */

const os = require('os');

function isTailscaleIPv4(hostname) {
  if (!hostname?.startsWith('100.')) return false;
  const octet2 = Number(hostname.split('.')[1]);
  return octet2 >= 64 && octet2 <= 127; // 100.64.0.0/10 (Tailscale)
}

function isPrivateLanHost(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (isTailscaleIPv4(hostname)) return true;
  return false;
}

function isPrivateLanOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return isPrivateLanHost(u.hostname);
  } catch {
    return false;
  }
}

function classifyAddress(entry) {
  const { name, address } = entry;
  if (address.startsWith('169.254.')) return 'skip';
  if (/wsl|hyper-v|vethernet|virtualbox|vmware/i.test(name)) return 'skip';
  if (isTailscaleIPv4(address) || /tailscale/i.test(name)) return 'tailscale';
  if (address.startsWith('192.168.') || address.startsWith('10.')) return 'lan';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 'lan';
  return 'other';
}

function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        const kind = classifyAddress({ name, address: net.address });
        if (kind !== 'skip') {
          out.push({ name, address: net.address, kind });
        }
      }
    }
  }
  return out;
}

function getDevAccessUrls() {
  const addrs = getLanIPv4Addresses();
  const lan = addrs.find((a) => a.kind === 'lan');
  const tailscale = addrs.find((a) => a.kind === 'tailscale')
    || addrs.find((a) => isTailscaleIPv4(a.address));
  return {
    lan: lan?.address || null,
    lanInterface: lan?.name || null,
    tailscale: tailscale?.address || null,
    tailscaleInterface: tailscale?.name || null,
    all: addrs,
  };
}

function primaryLanIPv4() {
  const { lan, tailscale } = getDevAccessUrls();
  return lan || tailscale || null;
}

function formatUiUrl(ip, uiPort = 5173) {
  return ip ? `http://${ip}:${uiPort}` : null;
}

function printLanDevBanner({ apiPort = 8080, uiPort = 5173 } = {}) {
  const { lan, tailscale } = getDevAccessUrls();
  if (!lan && !tailscale) {
    console.log('\n[LAN dev] No LAN/Tailscale IPv4 found — use localhost only.\n');
    return;
  }

  console.log('\n[LAN dev] Mac mini / second computer — open either URL:');
  if (lan) {
    console.log(`  LAN:       ${formatUiUrl(lan, uiPort)}`);
  }
  if (tailscale) {
    console.log(`  Tailscale: ${formatUiUrl(tailscale, uiPort)}`);
  }
  console.log(`  API health: http://<same-ip>:${apiPort}/health`);
  console.log('  Manager on one machine, tenant on the other — both LAN and Tailscale work.');
  if (lan && tailscale) {
    console.log('  Same Wi‑Fi → use LAN; remote or firewall issues → use Tailscale.');
  }
  console.log('  Windows Firewall: allow inbound 5173 + 8080 on the host if needed.\n');
}

module.exports = {
  isTailscaleIPv4,
  isPrivateLanHost,
  isPrivateLanOrigin,
  getLanIPv4Addresses,
  getDevAccessUrls,
  primaryLanIPv4,
  formatUiUrl,
  printLanDevBanner,
};
