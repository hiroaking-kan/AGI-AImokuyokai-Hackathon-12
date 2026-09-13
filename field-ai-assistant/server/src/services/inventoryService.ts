import { randomUUID } from 'node:crypto';
import type { Action, Category, ConfirmResult, InventoryChange, ManualRequest, PrepareRequest, Product } from '../../../shared/types.js';
import { InventoryRepository, type InventoryState } from '../repositories/inventoryRepository.js';

export class InventoryError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const aliases: Record<string, string> = {
  chair: 'chair', '椅子': 'chair', 'いす': 'chair', 'イス': 'chair', 'office chair': 'chair',
  desk: 'desk', table: 'desk', '机': 'desk', 'デスク': 'desk', 'テーブル': 'desk',
  monitor: 'monitor', display: 'monitor', screen: 'monitor', 'モニター': 'monitor', 'モニタ': 'monitor',
};
type Pending = { change: InventoryChange; revision: number; expiresAt: number };
const PENDING_TTL = 10 * 60 * 1000;
const CATEGORIES: Category[] = ['chair', 'desk', 'monitor', 'other'];
const CATEGORY_JA: Record<Category, string> = { chair: '椅子', desk: 'デスク', monitor: 'モニター', other: '備品' };

function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new InventoryError(`${label}を正しく入力してください。`);
  return value.trim();
}
function product(state: InventoryState, id: string): Product {
  const found = state.products.find(item => item.id === id);
  if (!found) throw new InventoryError('商品が見つかりません。', 404);
  return found;
}

export class InventoryService {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly repository: InventoryRepository) {}

  getProducts() { return this.repository.read(state => state.products); }
  getProduct(id: string) { return this.repository.read(state => product(state, id)); }
  getHistory() { return this.repository.read(state => [...state.history].reverse()); }
  getByCategory(value: string) {
    const category = aliases[value.trim().toLowerCase()];
    if (!category) throw new InventoryError('商品を認識できませんでした。対象がよく見えるようにカメラを向けてください。', 404);
    return this.repository.read(state => state.products.find(item => item.category === category)!);
  }

  private buildRegister(state: InventoryState, input: PrepareRequest): InventoryChange {
    const name = text(input?.name, '品名');
    if (!input.category || !CATEGORIES.includes(input.category)) throw new InventoryError('カテゴリが正しくありません。');
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1)
      throw new InventoryError('数量は正の整数で入力してください。');
    const location = input.location == null || input.location === '' ? undefined : text(input.location, '設置場所');
    let productId = `item-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    while (state.products.some(item => item.id === productId)) productId = `item-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    return { id: randomUUID(), productId, productName: name, action: 'register', quantity: input.quantity,
      beforeQuantity: 0, afterQuantity: input.quantity, source: 'ai', createdAt: new Date().toISOString(),
      category: input.category, categoryJa: CATEGORY_JA[input.category], ...(location ? { location } : {}) };
  }

  private buildChange(state: InventoryState, input: PrepareRequest): InventoryChange {
    if (input.action === 'register') return this.buildRegister(state, input);
    const id = text(input?.productId, '商品');
    const actions: Action[] = ['shipment', 'restock', 'adjustment'];
    if (!actions.includes(input.action)) throw new InventoryError('操作内容が正しくありません。');
    if (!Number.isSafeInteger(input.quantity) || input.quantity === 0
      || (input.action !== 'adjustment' && input.quantity < 0))
      throw new InventoryError('数量は0以外の整数で入力してください。出荷・入荷は正の数を指定してください。');
    const found = product(state, id);
    const difference = input.action === 'shipment' ? -input.quantity : input.quantity;
    const afterQuantity = found.quantity + difference;
    if (afterQuantity < 0) throw new InventoryError(`現在の在庫は${found.quantity}です。指定した数量では在庫が不足します。`, 409);
    if (!Number.isSafeInteger(afterQuantity)) throw new InventoryError('数量が大きすぎます。');
    return { id: randomUUID(), productId: id, productName: found.name, action: input.action,
      quantity: input.quantity, beforeQuantity: found.quantity, afterQuantity, source: 'ai', createdAt: new Date().toISOString(),
      ...(input.reason ? { reason: text(input.reason, '理由', 500) } : {}) };
  }

  prepare(input: PrepareRequest) {
    return this.repository.read(state => {
      const now = Date.now();
      for (const [id, value] of this.pending) if (value.expiresAt <= now) this.pending.delete(id);
      if (this.pending.size >= 100) throw new InventoryError('未確認の変更が多すぎます。確認またはキャンセルしてください。', 429);
      const change = this.buildChange(state, input);
      this.pending.set(change.id, { change, revision: state.revisions[change.productId] ?? 0, expiresAt: now + PENDING_TTL });
      return change;
    });
  }

  private apply(state: InventoryState, change: InventoryChange): ConfirmResult {
    if (change.action === 'register') {
      if (state.products.some(item => item.id === change.productId))
        throw new InventoryError('同じ商品がすでに登録されています。', 409);
      if (!change.category || !CATEGORIES.includes(change.category)) throw new InventoryError('カテゴリが正しくありません。');
      const created: Product = { id: change.productId, name: change.productName, category: change.category,
        categoryJa: change.categoryJa ?? CATEGORY_JA[change.category], quantity: change.afterQuantity,
        ...(change.location ? { location: change.location } : {}) };
      state.products.push(created);
      state.revisions[created.id] = 1;
      const history = { id: change.id, productId: created.id, productName: created.name,
        beforeQuantity: 0, afterQuantity: created.quantity, change: created.quantity, action: 'register' as const,
        source: change.source, createdAt: new Date().toISOString() };
      state.history.push(history);
      return { product: { ...created }, history };
    }
    const current = product(state, change.productId);
    current.quantity = change.afterQuantity;
    state.revisions[current.id] += 1;
    const history = { id: change.id, productId: current.id, productName: current.name,
      beforeQuantity: change.beforeQuantity, afterQuantity: change.afterQuantity,
      change: change.afterQuantity - change.beforeQuantity, action: change.action, source: change.source,
      createdAt: new Date().toISOString(), ...(change.reason ? { reason: change.reason } : {}) };
    state.history.push(history);
    return { product: { ...current }, history };
  }

  async confirm(rawId: unknown): Promise<ConfirmResult> {
    const id = text(rawId, '確認ID', 128);
    const result = await this.repository.transaction(state => {
      const previous = state.history.find(entry => entry.id === id && entry.source === 'ai');
      if (previous) return { product: { ...product(state, previous.productId), quantity: previous.afterQuantity }, history: previous };
      const pending = this.pending.get(id);
      if (!pending || pending.expiresAt <= Date.now()) throw new InventoryError('確認待ちの変更がありません。もう一度変更内容を指定してください。', 409);
      if (pending.change.action === 'register') {
        if (state.products.some(item => item.id === pending.change.productId))
          throw new InventoryError('同じ商品がすでに登録されています。', 409);
        return this.apply(state, pending.change);
      }
      const current = product(state, pending.change.productId);
      if (state.revisions[current.id] !== pending.revision || current.quantity !== pending.change.beforeQuantity)
        throw new InventoryError('確認中に在庫が変更されました。現在庫を確認し、もう一度操作してください。', 409);
      return this.apply(state, pending.change);
    });
    this.pending.delete(id);
    return result;
  }

  cancel(rawId: unknown) {
    const id = text(rawId, '確認ID', 128);
    return this.repository.read(state => {
      if (state.history.some(entry => entry.id === id)) throw new InventoryError('この変更はすでに確定しています。', 409);
      this.pending.delete(id);
      return { cancelled: true as const };
    });
  }

  manual(input: ManualRequest) {
    const requestId = text(input?.requestId, 'リクエストID', 128);
    const reason = text(input.reason, '理由', 500);
    const fingerprint = JSON.stringify([input.productId, input.quantity, reason]);
    return this.repository.transaction(state => {
      const previous = Object.hasOwn(state.manualRequests, requestId) ? state.manualRequests[requestId] : undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new InventoryError('同じリクエストIDで異なる変更は保存できません。', 409);
        return previous.result;
      }
      const change = this.buildChange(state, { ...input, reason, action: 'adjustment' });
      change.source = 'manual';
      const result = this.apply(state, change);
      Object.defineProperty(state.manualRequests, requestId, { value: { fingerprint, result }, enumerable: true, writable: true, configurable: true });
      return result;
    });
  }
}
