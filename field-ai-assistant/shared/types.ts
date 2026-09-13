export type Category = 'chair' | 'desk' | 'monitor';
export type Action = 'shipment' | 'restock' | 'adjustment';
export type Source = 'ai' | 'manual';
export interface Product { id: string; name: string; category: Category; categoryJa: string; quantity: number }
export interface InventoryChange { id: string; productId: string; productName: string; action: Action; quantity: number; beforeQuantity: number; afterQuantity: number; source: Source; reason?: string; createdAt: string }
export interface HistoryEntry { id: string; productId: string; productName: string; change: number; beforeQuantity: number; afterQuantity: number; action: Action; source: Source; reason?: string; createdAt: string }
export interface PrepareRequest { productId: string; quantity: number; action: Action; source?: Source; reason?: string }
export interface ConfirmRequest { pendingId: string }
export interface ManualRequest { productId: string; quantity: number; reason: string; requestId: string }
export interface ConfirmResult { product: Product; history: HistoryEntry }
export interface TokenResponse { token: string; model: string }
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
