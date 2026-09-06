#!/usr/bin/env node
'use strict';

// Verificador de dispositivos na rede local (celulares, notebooks, IoT, etc.).
// Roda só na máquina local: dá ping em toda a sub-rede pra popular a tabela
// ARP do sistema operacional, lê essa tabela (IP + MAC) e, se houver
// internet, consulta o fabricante do MAC num serviço público.
//
// Isso NÃO funciona a partir de um servidor na nuvem (Vercel, etc.) — só
// enxerga a rede à qual esta máquina está conectada.

const os = require('os');
const fs = require('fs');
const dns = require('dns');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const PING_CONCURRENCY = 32;
const PING_TIMEOUT_MS = 800;
const MAX_HOSTS = 1024; // trava de segurança contra máscaras muito abertas (ex.: /8)
const VENDOR_LOOKUP_TIMEOUT_MS = 2000;
const VENDOR_LOOKUP_DELAY_MS = 1100; // api.macvendors.com free tier: ~1 req/s

// Pistas de hostname que sugerem celular/tablet. É heurística, não certeza:
// hostname é definido pelo próprio aparelho e pode ser qualquer coisa.
const MOBILE_HOSTNAME_HINTS = [
  'iphone', 'ipad', 'android', 'galaxy', 'redmi', 'xiaomi', 'pixel',
  'oneplus', 'huawei', 'honor', 'moto-g', 'motorola', 'realme', 'oppo',
  'vivo-', 'poco',
];

function getCandidateInterfaces() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push({ name, ...iface });
      }
    }
  }
  return result;
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(int) {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 255).join('.');
}

function computeHostRange(ip, netmask) {
  const ipInt = ipToInt(ip);
  const maskInt = ipToInt(netmask);
  const networkInt = ipInt & maskInt;
  const broadcastInt = networkInt | (~maskInt >>> 0);
  const first = networkInt + 1;
  const last = broadcastInt - 1;
  const total = Math.max(0, last - first + 1);

  const hosts = [];
  const truncated = total > MAX_HOSTS;
  const end = truncated ? first + MAX_HOSTS - 1 : last;
  for (let cur = first; cur <= end; cur++) {
    hosts.push(intToIp(cur));
  }
  return { hosts, total, truncated };
}

async function pingHost(ip) {
  const cmd = os.platform() === 'win32'
    ? `ping -n 1 -w ${PING_TIMEOUT_MS} ${ip}`
    : `ping -c 1 -W ${Math.ceil(PING_TIMEOUT_MS / 1000)} ${ip}`;
  try {
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}

async function pingSweep(ips) {
  let cursor = 0;
  async function worker() {
    while (cursor < ips.length) {
      const ip = ips[cursor++];
      await pingHost(ip);
    }
  }
  const workers = Array.from({ length: Math.min(PING_CONCURRENCY, ips.length) }, worker);
  await Promise.all(workers);
}

function normalizeMac(mac) {
  return mac.replace(/-/g, ':').toLowerCase();
}

function parseArpOutput(output) {
  const platform = os.platform();
  const entries = new Map();

  for (const line of output.split('\n')) {
    let match;
    if (platform === 'linux') {
      match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-fA-F:]{17})/);
    } else if (platform === 'win32') {
      match = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})\s+\w+/);
    } else {
      // macOS / BSD: "? (192.168.1.5) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
      match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]{17})/);
    }
    if (match) {
      entries.set(match[1], normalizeMac(match[2]));
    }
  }
  return entries;
}

async function readArpFromProc() {
  // Lê a tabela ARP direto do kernel, sem depender de `ip` ou `arp` estarem
  // instalados (/proc/net/arp sempre existe no Linux).
  const content = await fs.promises.readFile('/proc/net/arp', 'utf8');
  const entries = new Map();
  for (const line of content.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [ip, , flags, mac] = parts;
    if (flags !== '0x2') continue; // só entradas completas (ATF_COM)
    if (!mac || mac === '00:00:00:00:00:00') continue;
    entries.set(ip, normalizeMac(mac));
  }
  return entries;
}

async function readArpTable() {
  if (os.platform() === 'linux') {
    try {
      return await readArpFromProc();
    } catch {
      // /proc/net/arp indisponível; tenta os comandos abaixo
    }
    try {
      const { stdout } = await execAsync('ip neigh show');
      return parseArpOutput(stdout);
    } catch {
      const { stdout } = await execAsync('arp -a');
      return parseArpOutput(stdout);
    }
  }
  const { stdout } = await execAsync('arp -a');
  return parseArpOutput(stdout);
}

async function reverseDns(ip) {
  try {
    const names = await dns.promises.reverse(ip);
    return names[0] || null;
  } catch {
    return null;
  }
}

async function lookupVendor(mac) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VENDOR_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.macvendors.com/${mac}`, { signal: controller.signal });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function guessIsMobile(hostname, vendor) {
  const haystack = `${hostname || ''} ${vendor || ''}`.toLowerCase();
  return MOBILE_HOSTNAME_HINTS.some((hint) => haystack.includes(hint));
}

function pad(str, len) {
  str = String(str ?? '');
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

async function main() {
  const args = process.argv.slice(2);
  const skipVendorLookup = args.includes('--no-vendor');
  const ifaceArg = args.find((a) => a.startsWith('--interface='))?.split('=')[1];

  const candidates = getCandidateInterfaces();
  if (candidates.length === 0) {
    console.error('Nenhuma interface de rede local (IPv4, não-interna) encontrada.');
    process.exit(1);
  }

  const iface = ifaceArg
    ? candidates.find((c) => c.name === ifaceArg)
    : candidates[0];

  if (!iface) {
    console.error(`Interface "${ifaceArg}" não encontrada. Disponíveis: ${candidates.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  if (candidates.length > 1 && !ifaceArg) {
    console.log(`Aviso: mais de uma interface de rede encontrada (${candidates.map((c) => c.name).join(', ')}). Usando "${iface.name}" (${iface.address}). Use --interface=NOME para escolher outra.\n`);
  }

  console.log(`Escaneando a rede de ${iface.name} (${iface.address}/${iface.netmask})...`);

  const { hosts, total, truncated } = computeHostRange(iface.address, iface.netmask);
  if (truncated) {
    console.log(`Aviso: sub-rede tem ${total} endereços possíveis; escaneando só os primeiros ${MAX_HOSTS} por segurança.`);
  }

  await pingSweep(hosts);
  const arpTable = await readArpTable();

  if (arpTable.size === 0) {
    console.log('\nNenhum dispositivo encontrado na tabela ARP. Verifique se está conectado à rede correta.');
    return;
  }

  console.log(`\n${arpTable.size} dispositivo(s) encontrado(s). Resolvendo hostname${skipVendorLookup ? '' : ' e fabricante'}...\n`);

  const rows = [];
  for (const [ip, mac] of arpTable) {
    const hostname = await reverseDns(ip);
    let vendor = null;
    if (!skipVendorLookup) {
      vendor = await lookupVendor(mac);
      await new Promise((r) => setTimeout(r, VENDOR_LOOKUP_DELAY_MS));
    }
    const provavelCelular = guessIsMobile(hostname, vendor);
    rows.push({ ip, mac, hostname, vendor, provavelCelular });
  }

  rows.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));

  console.log([
    pad('IP', 16), pad('MAC', 18), pad('Fabricante (chute)', 22), pad('Hostname', 28), 'Possível celular?',
  ].join(' '));
  console.log('-'.repeat(100));
  for (const row of rows) {
    console.log([
      pad(row.ip, 16),
      pad(row.mac, 18),
      pad(row.vendor || (skipVendorLookup ? '(não consultado)' : 'desconhecido'), 22),
      pad(row.hostname || '-', 28),
      row.provavelCelular ? 'talvez (chute)' : '-',
    ].join(' '));
  }

  console.log('\nObs.: "Possível celular?" é só um chute baseado em nome do aparelho e fabricante do');
  console.log('MAC — o mesmo fabricante faz notebooks, TVs e outros aparelhos. Não é uma identificação confiável.');
}

main().catch((err) => {
  console.error('Erro ao escanear a rede:', err.message);
  process.exit(1);
});
