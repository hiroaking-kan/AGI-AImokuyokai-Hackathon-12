import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

test('REST endpoints expose JSON contracts, validate inputs, and persist manual history', async () => {
  const app = await createApp({ dataDir: await mkdtemp(join(tmpdir(), 'field-ai-api-test-')), gemini: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(base + '/api/products')).json()).length, 3);
    assert.equal((await (await fetch(base + '/api/products/category/chair')).json()).id, 'chair-001');
    const prepared = await (await post('/api/inventory/prepare', { productId: 'chair-001', quantity: 5, action: 'shipment' })).json();
    assert.equal(prepared.afterQuantity, 15);
    assert.equal((await (await fetch(base + '/api/products/chair-001')).json()).quantity, 20);
    const confirmed = await (await post('/api/inventory/confirm', { pendingId: prepared.id })).json();
    assert.equal(confirmed.product.quantity, 15);
    assert.equal(confirmed.history.source, 'ai');
    const manual = await post('/api/inventory/manual', { productId: 'chair-001', quantity: 2, reason: '追加', requestId: 'api-manual' });
    assert.equal((await manual.json()).product.quantity, 17);
    assert.equal((await (await fetch(base + '/api/history')).json())[0].source, 'manual');
    assert.equal((await post('/api/inventory/confirm', {})).status, 400);
    assert.equal((await post('/api/inventory/prepare', null)).status, 400);
    assert.equal((await fetch(base + '/api/products/missing')).status, 404);
    const blocked = await fetch(base + '/api/inventory/manual', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' });
    assert.equal(blocked.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
