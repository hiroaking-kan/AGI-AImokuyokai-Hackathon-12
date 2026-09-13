import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { verifyLiveFixture } from './live-fixture.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'field-ai-e2e-'));
const root = resolve('.');
const apiPort = '18787';
const webPort = '15173';
const url = `http://127.0.0.1:${webPort}`;
const env = { ...process.env, DATA_DIR: dataDir, API_PORT: apiPort, VITE_DEMO_MODE: 'true', GEMINI_API_KEY: '' };
const processes = [];
let browser;
function launch(args) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', () => {});
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  processes.push(child);
  return child;
}
async function ready(address) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processes.some(child => child.exitCode !== null)) throw new Error('Test server exited before ready');
    try { if ((await fetch(address)).ok) return; } catch { /* server starting */ }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error(`Server did not start: ${address}`);
}
try {
  launch(['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts']);
  launch(['node_modules/vite/bin/vite.js', '--port', webPort]);
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`), ready(url)]);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__mediaCalls = 0;
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__mediaCalls++;
      throw new DOMException(constraints.video ? 'Camera denied' : 'Mic denied', 'NotAllowedError');
    };
  });
  const getProducts = async () => (await page.request.get(`${url}/api/products`)).json();
  const getHistory = async () => (await page.request.get(`${url}/api/history`)).json();
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'AIを起動する', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__mediaCalls), 0, 'No camera/mic request before click');
  await page.screenshot({ path: join(dataDir, 'assistant-desktop.png'), fullPage: true });
  const designMetrics = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('main *,nav button')].filter(el => el.getClientRects().length);
    const texts = visible.filter(el => [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
    return {
      fonts: [...new Set(texts.map(el => getComputedStyle(el).fontSize))],
      controls: [...document.querySelectorAll('button,input,textarea,summary')].filter(el => el.getClientRects().length).map(el => ({ label: el.textContent.trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
      alignments: [...document.querySelectorAll('.page-heading,.camera-panel,.conversation-panel,.guide-strip')].map(el => ({ name: el.className, left: el.getBoundingClientRect().left })),
      colors: ['body','.button.primary','.button.secondary','.muted','.camera-placeholder'].map(selector => { const el = document.querySelector(selector); if (!el) return null; const c = getComputedStyle(el); return { selector, color: c.color, background: c.backgroundColor }; }),
    };
  });
  await page.keyboard.press('Tab');
  designMetrics.focus = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return { width: c.outlineWidth, style: c.outlineStyle, color: c.outlineColor }; });
  await writeFile(join(dataDir, 'design-metrics.json'), JSON.stringify(designMetrics, null, 2));
  await page.getByRole('button', { name: '在庫管理', exact: true }).click();
  await expect(page.locator('.product-row')).toHaveCount(3);
  await expect(page.locator('.product-row').first()).toContainText('20');
  await page.getByRole('button', { name: '在庫を変更', exact: true }).first().click();
  await page.getByLabel('増減数量', { exact: true }).fill('2');
  await page.getByLabel('変更する理由').fill('ブラウザ検証：棚卸し調整');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await getProducts())[0].quantity, 22);
  await page.reload();
  assert.equal((await getProducts())[0].quantity, 22, 'Persistent after reload');
  await page.getByRole('button', { name: '変更履歴', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('MANUAL');
  await page.getByRole('button', { name: 'AIアシスタント', exact: true }).click();
  await page.getByText('開発・緊急デモ', { exact: true }).click();
  await page.getByRole('button', { name: '椅子を認識', exact: true }).click();
  await expect(page.locator('.demo-panel')).toContainText('現在の在庫は22脚');
  await page.getByRole('button', { name: '5脚出荷', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('在庫を変更しますか');
  assert.equal((await getProducts())[0].quantity, 22, 'Prepare does not write');
  await page.getByRole('button', { name: 'いいえ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await getProducts())[0].quantity, 22, 'Cancel does not write');
  assert.equal((await getHistory()).length, 1);
  await page.getByRole('button', { name: '5脚出荷', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: join(dataDir, 'confirmation.png'), fullPage: true });
  await page.getByRole('button', { name: 'はい', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await getProducts())[0].quantity, 17, 'Double click applies once');
  const history = await getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].source, 'ai');
  assert.equal(history[0].change, -5);
  await page.reload();
  assert.equal((await getProducts())[0].quantity, 17);
  const insufficient = await page.request.post(`${url}/api/inventory/prepare`, { data: { productId: 'chair-001', quantity: 100, action: 'shipment' } });
  assert.equal(insufficient.status(), 409);
  assert.equal((await getProducts())[0].quantity, 17);
  await page.getByRole('button', { name: 'AIを起動する', exact: true }).click();
  await expect(page.getByRole('button', { name: '再接続', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').last()).toContainText('カメラ');
  assert.equal(await page.evaluate(() => window.__mediaCalls), 1);
  await page.getByRole('button', { name: '会話を終了', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AIを起動する', exact: true })).toBeVisible();
  for (const name of ['AIアシスタント', '在庫管理', '変更履歴']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.setViewportSize({ width: 375, height: 812 });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
    assert.ok(dimensions.scroll <= dimensions.width, `${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
    if (name === 'AIアシスタント') {
      const startBox = await page.getByRole('button', { name: 'AIを起動する', exact: true }).boundingBox();
      assert.ok(startBox.y + startBox.height <= 812, 'Mobile start button visible in initial viewport');
      designMetrics.mobileStart = startBox;
      await writeFile(join(dataDir, 'design-metrics.json'), JSON.stringify(designMetrics, null, 2));
    }
    await page.screenshot({ path: join(dataDir, `mobile-${name}.png`), fullPage: true });
  }
  const tokenResponse = await page.request.post(`${url}/api/gemini/token`, { data: {} });
  assert.equal(tokenResponse.status(), 503, 'Missing key handled without external call');
  const disk = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.ok(JSON.stringify(disk).includes('ブラウザ検証'), 'History persisted to JSON');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  await verifyLiveFixture(browser, url);
  console.log(JSON.stringify({ result: 'PASS', checks: ['startup', 'frontend-api', 'three-products', 'manual-adjustment', 'history', 'reload-persistence', 'prepare-no-write', 'cancel-no-write', 'double-confirm-once', 'insufficient-stock', 'no-media-before-start', 'camera-denial-reconnect', 'mobile-no-overflow', 'missing-key-error', 'no-page-errors'], artifacts: dataDir }, null, 2));
} finally {
  await browser?.close();
  for (const child of processes) { if (child.exitCode === null) child.kill(); }
  // Retain temporary evidence; cleanup is deliberately left to the operator.
}
