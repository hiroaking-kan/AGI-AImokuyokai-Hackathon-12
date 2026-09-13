import { randomUUID } from 'node:crypto';
import type { Action, ConfirmResult, InventoryChange, ManualRequest, PrepareRequest, Product } from '../../../shared/types.js';
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

  private buildChange(state: InventoryState, input: PrepareRequest): InventoryChange {
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
      this.pending.set(change.id, { change, revision: state.revisions[change.productId], expiresAt: now + PENDING_TTL });
      return change;
    });
  }

  private apply(state: InventoryState, change: InventoryChange): ConfirmResult {
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
