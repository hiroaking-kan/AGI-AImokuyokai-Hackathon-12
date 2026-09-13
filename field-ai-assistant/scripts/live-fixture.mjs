import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

// Exercises the real SDK, AudioWorklet and app against an in-browser WebSocket fixture.
// No token provisioning or Google API call is made. Recognition/ASR are supplied fixtures.
export async function verifyLiveFixture(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  const outgoing = [];
  let socket;
  let socketClosed = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__testTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await original(options);
      window.__testTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.route('**/api/gemini/token', route => route.fulfill({ json: { token: 'auth_tokens/local-fixture', model: 'gemini-3.1-flash-live-preview' } }));
  await page.routeWebSocket(address => !['127.0.0.1', 'localhost'].includes(address.hostname), ws => {
    socket = ws;
    ws.onClose(() => { socketClosed = true; });
    ws.onMessage(raw => {
      const message = JSON.parse(raw.toString());
      outgoing.push(message);
      if (message.setup) ws.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  const send = message => socket.send(JSON.stringify(message));
  const tool = (id, name, args = {}) => send({ toolCall: { functionCalls: [{ id, name, args }] } });
  const result = id => outgoing.flatMap(message => message.toolResponse?.functionResponses || []).find(entry => entry.id === id)?.response?.result;
  const inventory = async () => (await (await page.request.get(`${url}/api/products`)).json())[0].quantity;
  const history = async () => (await (await page.request.get(`${url}/api/history`)).json()).length;
  try {
    await page.goto(url);
    const before = await inventory();
    const historyBefore = await history();
    await page.getByRole('button', { name: 'AIを起動する', exact: true }).click();
    await expect(page.locator('.connection')).toHaveText('接続済', { timeout: 15000 });
    await expect.poll(() => outgoing.some(message => JSON.stringify(message).includes('audio/pcm;rate=16000'))).toBe(true);
    await expect.poll(() => outgoing.some(message => JSON.stringify(message).includes('image/jpeg'))).toBe(true);
    assert.equal(await page.evaluate(() => window.__testTracks.length), 2);
    tool('recognize', 'get_product_by_category', { category: 'chair' });
    await expect.poll(() => result('recognize')?.id).toBe('chair-001');
    tool('prepare', 'prepare_inventory_change', { productId: 'chair-001', quantity: 5, action: 'shipment' });
    await expect(page.getByRole('dialog')).toBeVisible();
    assert.equal(await inventory(), before);
    // Model-only confirmation is refused, even though a pending proposal exists.
    tool('unapproved', 'confirm_inventory_change');
    await expect.poll(() => Boolean(result('unapproved')?.error)).toBe(true);
    assert.equal(await inventory(), before);
    send({ serverContent: { turnComplete: true } });
    // Confirmation tool can arrive before final ASR; it must fail closed until ASR finishes.
    tool('early-confirm', 'confirm_inventory_change');
    await expect.poll(() => Boolean(result('early-confirm')?.error)).toBe(true);
    send({ serverContent: { inputTranscription: { text: 'はい', finished: true } } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(await inventory(), before - 5);
    tool('confirmed', 'confirm_inventory_change');
    await expect.poll(() => result('confirmed')?.history?.change).toBe(-5);
    tool('confirmed', 'confirm_inventory_change');
    await expect.poll(() => outgoing.filter(message => message.toolResponse?.functionResponses?.some(entry => entry.id === 'confirmed')).length).toBe(2);
    assert.equal(await history(), historyBefore + 1, 'voice and repeated tool only apply once');
    send({ serverContent: { turnComplete: true } });
    tool('prepare-cancel', 'prepare_inventory_change', { productId: 'chair-001', quantity: 3, action: 'restock' });
    await expect(page.getByRole('dialog')).toBeVisible();
    send({ serverContent: { turnComplete: true } });
    send({ serverContent: { inputTranscription: { text: 'いいえ', finished: true } } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(await inventory(), before - 5);
    assert.equal(await history(), historyBefore + 1);
    // Playback and interruption are exercised with silence, not a generated AI response.
    send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(4800).toString('base64') } }] }, outputTranscription: { text: '更新しました。' } } });
    await expect(page.locator('.speech-block')).toContainText('更新しました');
    send({ serverContent: { interrupted: true } });
    await page.getByRole('button', { name: '会話を終了', exact: true }).click();
    await expect.poll(() => socketClosed).toBe(true);
    assert.ok(await page.evaluate(() => window.__testTracks.every(track => track.readyState === 'ended')));
    await expect(page.locator('video')).toBeHidden();
    assert.deepEqual(errors, []);
    console.log('PASS: Live fixture — SDK setup, PCM/JPEG, unapproved rejection, voice yes/no, ASR race, replay, playback/interruption, media cleanup. Actual Gemini remains untested.');
  } catch (error) {
    console.error(JSON.stringify({ fixtureError: await page.locator('[role="alert"]').allTextContents(), trackCount: await page.evaluate(() => window.__testTracks.length), socketCreated: Boolean(socket), outgoingKinds: outgoing.map(message => Object.keys(message)), pageErrors: errors }));
    throw error;
  } finally { await page.close(); }
}
