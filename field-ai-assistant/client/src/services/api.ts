import type { ConfirmResult, HistoryEntry, InventoryChange, ManualRequest, PrepareRequest, Product } from '../../../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as T & { error?: string; message?: string };
  if (!response.ok) throw new ApiError(data?.error || data?.message || '在庫の情報を取得・更新できませんでした。もう一度お試しください。', response.status);
  return data;
}
export const api = {
  getProducts: () => request<Product[]>('/products'),
  getHistory: () => request<HistoryEntry[]>('/history'),
  getByCategory: (category: string) => request<Product>(`/products/category/${encodeURIComponent(category)}`),
  getInventory: (productId: string) => request<Product>(`/products/${encodeURIComponent(productId)}`),
  prepare: (body: PrepareRequest) => request<InventoryChange>('/inventory/prepare', body),
  confirm: (pendingId: string) => request<ConfirmResult>('/inventory/confirm', { pendingId }),
  cancel: (pendingId: string) => request<{ cancelled: true }>('/inventory/cancel', { pendingId }),
  manual: (body: ManualRequest) => request<ConfirmResult>('/inventory/manual', body),
};
