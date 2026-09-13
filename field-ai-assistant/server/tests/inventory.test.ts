import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InventoryRepository } from '../src/repositories/inventoryRepository.js';
import { InventoryService } from '../src/services/inventoryService.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'field-ai-inventory-test-'));
  const repository = await InventoryRepository.create(directory);
  return { directory, service: new InventoryService(repository) };
}

test('prepare does not change persistent stock; simultaneous confirmations commit once', async () => {
  const { directory, service } = await fixture();
  const original = await readFile(join(directory, 'state.json'), 'utf8');
  const pending = await service.prepare({ productId: 'chair-001', quantity: 5, action: 'shipment' });
  assert.equal(pending.beforeQuantity, 20);
  assert.equal(pending.afterQuantity, 15);
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), original);
  const [first, second] = await Promise.all([service.confirm(pending.id), service.confirm(pending.id)]);
  assert.deepEqual(first, second);
  assert.equal((await service.getProduct('chair-001')).quantity, 15);
  assert.equal((await service.getHistory()).length, 1);
  assert.equal(JSON.parse(await readFile(join(directory, 'products.json'), 'utf8'))[0].quantity, 15);
  const reopened = new InventoryService(await InventoryRepository.create(directory));
  assert.equal((await reopened.confirm(pending.id)).product.quantity, 15);
  assert.equal((await reopened.getHistory()).length, 1);
});

test('cancel prevents confirmation; unknown or expired pending never creates history', async () => {
  const { directory, service } = await fixture();
  const pending = await service.prepare({ productId: 'chair-001', quantity: 5, action: 'shipment' });
  assert.deepEqual(await service.cancel(pending.id), { cancelled: true });
  await assert.rejects(service.confirm(pending.id), /確認待ち/);
  const another = await service.prepare({ productId: 'chair-001', quantity: 2, action: 'restock' });
  const reopened = new InventoryService(await InventoryRepository.create(directory));
  await assert.rejects(reopened.confirm(another.id), /確認待ち/);
  assert.equal((await reopened.getProduct('chair-001')).quantity, 20);
  assert.deepEqual(await reopened.getHistory(), []);
});

test('reject shortage, non-integers, invalid actions and unknown category', async () => {
  const { service } = await fixture();
  for (const quantity of [21, 0, -2, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.prepare({ productId: 'chair-001', quantity, action: 'shipment' }));
  }
  await assert.rejects(service.prepare({ productId: 'chair-001', quantity: -21, action: 'adjustment' }));
  assert.throws(() => service.getByCategory('unknown'), /商品を認識できません/);
  assert.equal((await service.getByCategory('office chair')).id, 'chair-001');
  assert.equal((await service.getByCategory('机')).id, 'desk-001');
  assert.equal((await service.getProduct('chair-001')).quantity, 20);
  assert.deepEqual(await service.getHistory(), []);
});

test('manual changes use the same history logic and persistent replay protection', async () => {
  const { directory, service } = await fixture();
  const request = { productId: 'desk-001', quantity: -2, reason: '棚卸し', requestId: 'manual-one' };
  const [first, repeated] = await Promise.all([service.manual(request), service.manual(request)]);
  assert.deepEqual(first, repeated);
  assert.equal(first.product.quantity, 8);
  assert.equal(first.history.source, 'manual');
  assert.equal(first.history.reason, '棚卸し');
  assert.equal(first.history.change, -2);
  const reopened = new InventoryService(await InventoryRepository.create(directory));
  assert.deepEqual(await reopened.manual(request), first);
  await assert.rejects(reopened.manual({ ...request, quantity: 2 }), /同じリクエストID/);
  assert.throws(() => service.manual({ ...request, reason: '' }), /理由/);
  assert.equal((await reopened.getHistory()).length, 1);
});

test('stale approvals reject even after stock returns to its previous number', async () => {
  const { service } = await fixture();
  const pending = await service.prepare({ productId: 'chair-001', quantity: 5, action: 'shipment' });
  await service.manual({ productId: 'chair-001', quantity: 1, reason: '追加', requestId: 'add' });
  await service.manual({ productId: 'chair-001', quantity: -1, reason: '訂正', requestId: 'revert' });
  await assert.rejects(service.confirm(pending.id), /確認中に在庫が変更/);
  assert.equal((await service.getProduct('chair-001')).quantity, 20);
  assert.equal((await service.getHistory()).length, 2);
});

test('concurrent different pending changes cannot oversell', async () => {
  const { service } = await fixture();
  const [first, second] = await Promise.all([
    service.prepare({ productId: 'monitor-001', quantity: 10, action: 'shipment' }),
    service.prepare({ productId: 'monitor-001', quantity: 10, action: 'shipment' }),
  ]);
  const results = await Promise.allSettled([service.confirm(first.id), service.confirm(second.id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await service.getProduct('monitor-001')).quantity, 5);
  assert.equal((await service.getHistory()).length, 1);
});

test('startup repairs stale mirrors from authoritative state and rejects corrupt state', async () => {
  const { directory, service } = await fixture();
  await service.manual({ productId: 'chair-001', quantity: -5, reason: '棚卸し', requestId: 'repair-one' });
  await writeFile(join(directory, 'products.json'), 'corrupt mirror', 'utf8');
  await writeFile(join(directory, 'history.json'), '[]', 'utf8');
  await InventoryRepository.create(directory);
  assert.equal(JSON.parse(await readFile(join(directory, 'products.json'), 'utf8'))[0].quantity, 15);
  assert.equal(JSON.parse(await readFile(join(directory, 'history.json'), 'utf8')).length, 1);
  await writeFile(join(directory, 'state.json'), 'corrupt authoritative data', 'utf8');
  await assert.rejects(InventoryRepository.create(directory));
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), 'corrupt authoritative data');
});

test('cancel and confirm are serialized and cannot both succeed after a commit', async () => {
  const { service } = await fixture();
  const pending = await service.prepare({ productId: 'chair-001', quantity: 5, action: 'shipment' });
  const results = await Promise.allSettled([service.confirm(pending.id), service.cancel(pending.id)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal((await service.getProduct('chair-001')).quantity, 15);
});

test('register prepare does not persist until confirm; confirm adds product and is idempotent', async () => {
  const { directory, service } = await fixture();
  const pending = await service.prepare({ action: 'register', name: 'ホワイトボード', category: 'other', quantity: 1, location: '第1会議室' });
  assert.equal(pending.action, 'register');
  assert.equal(pending.beforeQuantity, 0);
  assert.equal(pending.afterQuantity, 1);
  assert.equal(pending.productName, 'ホワイトボード');
  assert.equal(pending.category, 'other');
  assert.equal(pending.location, '第1会議室');
  assert.match(pending.productId, /^item-/);
  assert.equal((await service.getProducts()).length, 3);
  const [first, second] = await Promise.all([service.confirm(pending.id), service.confirm(pending.id)]);
  assert.deepEqual(first, second);
  const products = await service.getProducts();
  assert.equal(products.length, 4);
  const created = products.find(item => item.id === pending.productId);
  assert.equal(created?.name, 'ホワイトボード');
  assert.equal(created?.categoryJa, '備品');
  assert.equal(created?.quantity, 1);
  assert.equal(created?.location, '第1会議室');
  const history = await service.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'register');
  assert.equal(history[0].source, 'ai');
  assert.equal(history[0].beforeQuantity, 0);
  assert.equal(history[0].afterQuantity, 1);
  const reopened = new InventoryService(await InventoryRepository.create(directory));
  assert.equal((await reopened.getProducts()).length, 4);
  assert.equal((await reopened.confirm(pending.id)).product.quantity, 1);
  assert.equal((await reopened.getHistory()).length, 1);
});

test('register prepare rejects missing name, non-positive quantity and unknown category; cancel does not add', async () => {
  const { service } = await fixture();
  await assert.rejects(service.prepare({ action: 'register', name: '', category: 'other', quantity: 1 }));
  await assert.rejects(service.prepare({ action: 'register', name: 'ホワイトボード', category: 'other', quantity: 0 }));
  await assert.rejects(service.prepare({ action: 'register', name: 'ホワイトボード', category: 'other', quantity: -1 }));
  await assert.rejects(service.prepare({ action: 'register', name: 'ホワイトボード', category: 'gadget' as 'other', quantity: 1 }));
  const pending = await service.prepare({ action: 'register', name: '延長コード', category: 'other', quantity: 2 });
  assert.deepEqual(await service.cancel(pending.id), { cancelled: true });
  await assert.rejects(service.confirm(pending.id), /確認待ち/);
  assert.equal((await service.getProducts()).length, 3);
  assert.deepEqual(await service.getHistory(), []);
});

test('failed disk commit leaves stock and history unchanged and allows retry', async () => {
  const { directory, service } = await fixture();
  const pending = await service.prepare({ productId: 'chair-001', quantity: 5, action: 'shipment' });
  // Temporarily make only this test's isolated data directory unavailable.
  await rename(directory, directory + '-offline');
  try {
    await assert.rejects(service.confirm(pending.id));
    assert.equal((await service.getProduct('chair-001')).quantity, 20);
    assert.deepEqual(await service.getHistory(), []);
  } finally { await rename(directory + '-offline', directory); }
  assert.equal((await service.confirm(pending.id)).product.quantity, 15);
  assert.equal((await service.getHistory()).length, 1);
});
