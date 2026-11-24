#!/usr/bin/env node
/**
 * OmniSphere Standalone Device Simulator CLI (Section 12.3).
 * Uses Node.js built-in fetch and standard library only (zero external dependencies).
 *
 * Usage:
 *   node simulator/simulator.mjs ./provisioning.json
 *   BASE_URL=http://localhost:3000/device/v1 DEVICE_ID=dev_xxx API_KEY=osp_xxx node simulator/simulator.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function loadConfig() {
  const fileArg = process.argv[2];
  let fileCfg = {};
  if (fileArg) {
    const resolved = path.resolve(process.cwd(), fileArg);
    const raw = fs.readFileSync(resolved, 'utf8');
    fileCfg = JSON.parse(raw);
  }

  const baseUrl = (
    process.env.BASE_URL ||
    fileCfg.apiBaseUrl ||
    'http://localhost:3000/device/v1'
  ).replace(/\/+$/, '');
  const deviceId = process.env.DEVICE_ID || fileCfg.deviceId || '';
  const apiKey = process.env.API_KEY || fileCfg.apiKey || '';
  const modelId = process.env.MODEL_ID || fileCfg.modelId || 'mdl_th200';
  const intervalSec = Math.max(5, Math.min(60, Number(process.env.INTERVAL_SEC || 10)));
  const firmwareVersion = process.env.FIRMWARE_VERSION || '1.0.0';

  if (!deviceId || !apiKey) {
    console.error(
      'Usage: node simulator/simulator.mjs <provisioning.json>\n' +
        '   or: BASE_URL=http://localhost:3000/device/v1 DEVICE_ID=... API_KEY=... node simulator/simulator.mjs',
    );
    process.exit(1);
  }

  return { baseUrl, deviceId, apiKey, modelId, intervalSec, firmwareVersion };
}

const cfg = loadConfig();
let currentFirmware = cfg.firmwareVersion;
let heartbeatIntervalSec = 30;
let lastHeartbeatMs = 0;
let uptimeSec = 60;
let stopping = false;

const stateValues = {
  temperature: 32.4,
  humidity: 54.0,
  vibration_rms: 4.1,
  voltage: 230.2,
  current: 46.5,
  power_kw: 21.4,
  energy_kwh: 14800,
};

async function callApi(method, endpoint, body) {
  const url = `${cfg.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': cfg.deviceId,
      'X-API-Key': cfg.apiKey,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  const ts = new Date().toISOString();
  console.log(`[${ts}] ${method} ${endpoint} -> HTTP ${res.status}`, payload ? JSON.stringify(payload) : '');
  return { ok: res.ok, status: res.status, payload };
}

function nextMetrics() {
  const jitter = (val, step, min, max) => {
    const next = Math.max(min, Math.min(max, val + (Math.random() - 0.5) * step));
    return Math.round(next * 100) / 100;
  };

  if (cfg.modelId === 'mdl_vm310') {
    stateValues.vibration_rms = jitter(stateValues.vibration_rms, 1.2, 0.5, 48);
    stateValues.temperature = jitter(stateValues.temperature, 1.8, 10, 140);
    return {
      vibration_rms: stateValues.vibration_rms,
      temperature: stateValues.temperature,
    };
  }
  if (cfg.modelId === 'mdl_em120') {
    stateValues.voltage = jitter(stateValues.voltage, 4.0, 180, 460);
    stateValues.current = jitter(stateValues.current, 6.0, 5, 190);
    stateValues.power_kw = jitter(stateValues.power_kw, 3.0, 1, 140);
    stateValues.energy_kwh = Math.round((stateValues.energy_kwh + 0.35) * 100) / 100;
    return {
      voltage: stateValues.voltage,
      current: stateValues.current,
      power_kw: stateValues.power_kw,
      energy_kwh: stateValues.energy_kwh,
    };
  }

  stateValues.temperature = jitter(stateValues.temperature, 1.6, 5, 115);
  stateValues.humidity = jitter(stateValues.humidity, 2.4, 10, 95);
  return {
    temperature: stateValues.temperature,
    humidity: stateValues.humidity,
  };
}

function nextHealth() {
  return {
    cpuLoad: Math.round((24 + Math.random() * 30) * 10) / 10,
    memoryUsage: Math.round((44 + Math.random() * 22) * 10) / 10,
    batteryLevel: cfg.modelId === 'mdl_em120' ? null : Math.round((80 + Math.random() * 12) * 10) / 10,
    signalStrength: Math.round(-58 - Math.random() * 20),
    uptimeSec,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleOtaUpdate(update) {
  const { jobId, firmwareId, version, downloadPath, sha256 } = update;
  await callApi('POST', `/updates/${jobId}/status`, { status: 'DOWNLOADING' });
  const relPath = downloadPath && downloadPath.startsWith('/device/v1')
    ? downloadPath.slice('/device/v1'.length)
    : `/firmware/${firmwareId}/download`;
  const dlRes = await fetch(`${cfg.baseUrl}${relPath}`, {
    headers: {
      'X-Device-Id': cfg.deviceId,
      'X-API-Key': cfg.apiKey,
    },
  });
  if (!dlRes.ok) {
    await callApi('POST', `/updates/${jobId}/status`, {
      status: 'FAILED',
      errorCode: `DOWNLOAD_HTTP_${dlRes.status}`,
    });
    return;
  }
  const headerSha = (dlRes.headers.get('x-checksum-sha256') || '').toLowerCase();
  const bytes = Buffer.from(await dlRes.arrayBuffer());
  const digest = crypto.createHash('sha256').update(bytes).digest('hex').toLowerCase();
  if ((sha256 && digest !== sha256.toLowerCase()) || (headerSha && digest !== headerSha)) {
    await callApi('POST', `/updates/${jobId}/status`, {
      status: 'FAILED',
      errorCode: 'CHECKSUM_MISMATCH',
    });
    return;
  }
  await sleep(5000);
  await callApi('POST', `/updates/${jobId}/status`, { status: 'INSTALLING' });
  await sleep(5000);
  currentFirmware = version || currentFirmware;
  uptimeSec = 1;
  await callApi('POST', `/updates/${jobId}/status`, {
    status: 'VERIFIED',
    newVersion: currentFirmware,
  });
  await callApi('POST', '/handshake', { firmwareVersion: currentFirmware });
}

async function run() {
  console.log(
    `OmniSphere CLI Simulator starting for ${cfg.deviceId} -> ${cfg.baseUrl} (interval=${cfg.intervalSec}s)`,
  );

  const hs = await callApi('POST', '/handshake', { firmwareVersion: currentFirmware });
  if (hs.ok && hs.payload) {
    if (typeof hs.payload.heartbeatIntervalSec === 'number') {
      heartbeatIntervalSec = hs.payload.heartbeatIntervalSec;
    }
    if (hs.payload.config && typeof hs.payload.config.version === 'number') {
      await callApi('POST', '/config-ack', {
        version: hs.payload.config.version,
        status: 'APPLIED',
      });
    }
  }

  while (!stopping) {
    const now = Date.now();
    const ts = new Date(now).toISOString();
    const metrics = nextMetrics();
    const health = nextHealth();

    await callApi('POST', '/telemetry', { timestamp: ts, metrics, health });

    if (now - lastHeartbeatMs >= heartbeatIntervalSec * 1000) {
      lastHeartbeatMs = now;
      await callApi('POST', '/heartbeat', { timestamp: ts, health });
    }

    const cmdRes = await callApi('GET', '/commands');
    if (cmdRes.ok && cmdRes.payload) {
      if (cmdRes.payload.config && typeof cmdRes.payload.config.version === 'number') {
        await callApi('POST', '/config-ack', {
          version: cmdRes.payload.config.version,
          status: 'APPLIED',
        });
      }
      if (cmdRes.payload.update) {
        await handleOtaUpdate(cmdRes.payload.update);
      }
      if (Array.isArray(cmdRes.payload.commands)) {
        for (const cmd of cmdRes.payload.commands) {
          if (cmd.type === 'RESTART') {
            await callApi('POST', `/commands/${cmd.id}/ack`, { status: 'ACKED' });
            console.log('Simulating 10-second device reboot...');
            await sleep(10_000);
            uptimeSec = 1;
            await callApi('POST', '/handshake', { firmwareVersion: currentFirmware });
          }
        }
      }
    }

    uptimeSec += cfg.intervalSec;
    await sleep(cfg.intervalSec * 1000);
  }
}

process.on('SIGINT', () => {
  stopping = true;
  console.log('\nStopping OmniSphere CLI Simulator...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopping = true;
  process.exit(0);
});

run().catch((err) => {
  console.error('Simulator fatal error:', err);
  process.exit(1);
});
