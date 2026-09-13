import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Product, HistoryEntry, ConfirmResult } from '../../../shared/types.js';

export const INITIAL_PRODUCTS: Product[] = [
  { id: 'chair-001', name: 'オフィスチェアA', category: 'chair', categoryJa: '椅子', quantity: 20 },
  { id: 'desk-001', name: 'デスクA', category: 'desk', categoryJa: 'デスク', quantity: 10 },
  { id: 'monitor-001', name: 'モニターA', category: 'monitor', categoryJa: 'モニター', quantity: 15 },
];

export interface InventoryState {
  schemaVersion: 1;
  products: Product[];
  history: HistoryEntry[];
  revisions: Record<string, number>;
  manualRequests: Record<string, { fingerprint: string; result: ConfirmResult }>;
}

/** One process owns this repository. All reads and writes share its FIFO queue. */
export class InventoryRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly directory: string, private state: InventoryState) {}

  static async create(directory: string): Promise<InventoryRepository> {
    await mkdir(directory, { recursive: true });
    let state: InventoryState;
    let initial = false;
    try {
      state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as InventoryState;
      if (state.schemaVersion !== 1 || !Array.isArray(state.products) || !Array.isArray(state.history)
        || !state.revisions || !state.manualRequests || state.products.length !== 3
        || new Set(state.products.map(p => p.id)).size !== 3
        || state.products.some(p => !INITIAL_PRODUCTS.some(seed => seed.id === p.id)
          || !Number.isSafeInteger(p.quantity) || p.quantity < 0
          || !Number.isSafeInteger(state.revisions[p.id]))) {
        throw new Error('在庫データの形式が正しくありません。state.jsonを確認してください。');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      initial = true;
      state = { schemaVersion: 1, products: structuredClone(INITIAL_PRODUCTS), history: [],
        revisions: Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, 0])), manualRequests: {} };
    }
    const repository = new InventoryRepository(directory, state);
    if (initial) await repository.writeAtomic('state.json', state);
    await repository.refreshMirrors();
    return repository;
  }

  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  read<T>(reader: (state: InventoryState) => T): Promise<T> {
    return this.enqueue(() => structuredClone(reader(this.state)));
  }

  transaction<T>(mutate: (state: InventoryState) => T): Promise<T> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      const result = mutate(next);
      // Inventory, audit history, and replay keys are committed together.
      await this.writeAtomic('state.json', next);
      this.state = next;
      await this.refreshMirrors();
      return structuredClone(result);
    });
  }

  private async writeAtomic(filename: string, value: unknown): Promise<void> {
    const temporary = join(this.directory, `.${filename}.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, join(this.directory, filename));
  }

  private async refreshMirrors(): Promise<void> {
    try {
      await this.writeAtomic('products.json', this.state.products);
      await this.writeAtomic('history.json', this.state.history);
    } catch {
      // state.json already committed. Returning failure here would encourage an unsafe retry.
      console.warn('在庫データは保存済みですが参照用JSONを更新できませんでした。再起動時に復元します。');
    }
  }
}
