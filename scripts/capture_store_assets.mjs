import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'publishing/source/direct-store-capture.html');
const outputDir = path.join(root, 'publishing/assets');
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function capture(cdp, { variant, width, height, deviceScaleFactor, filename }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    mobile: false, width, height, deviceScaleFactor,
    screenWidth: width, screenHeight: height,
  });
  const fileUrl = `file://${source}?variant=${variant}`;
  await cdp.send('Page.navigate', { url: fileUrl });
  await new Promise(resolve => setTimeout(resolve, 350));
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  await fs.writeFile(path.join(outputDir, filename), Buffer.from(data, 'base64'));
}

const target = await json(`${endpoint}/json/new?about:blank`, { method: 'PUT' });
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.open();
await cdp.send('Page.enable');

try {
  for (const variant of ['interface-1', 'interface-2', 'interface-3']) {
    await capture(cdp, { variant, width: 1280, height: 800, deviceScaleFactor: 1,
      filename: `direct-${variant}-1280x800.png` });
  }
  await capture(cdp, { variant: 'notification-2', width: 853, height: 533, deviceScaleFactor: 1.5,
    filename: 'direct-notification-2-1280x800.png' });
  await capture(cdp, { variant: 'notification-3', width: 640, height: 400, deviceScaleFactor: 2,
    filename: 'direct-notification-3-1280x800.png' });
} finally {
  cdp.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
