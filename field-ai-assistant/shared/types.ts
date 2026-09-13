export type Category = 'chair' | 'desk' | 'monitor' | 'other';
export type Action = 'shipment' | 'restock' | 'adjustment' | 'register';
export type Source = 'ai' | 'manual';
export interface Product { id: string; name: string; category: Category; categoryJa: string; quantity: number; location?: string }
export interface InventoryChange { id: string; productId: string; productName: string; action: Action; quantity: number; beforeQuantity: number; afterQuantity: number; source: Source; reason?: string; createdAt: string; category?: Category; categoryJa?: string; location?: string }
export interface HistoryEntry { id: string; productId: string; productName: string; change: number; beforeQuantity: number; afterQuantity: number; action: Action; source: Source; reason?: string; createdAt: string }
export interface PrepareRequest { productId?: string; name?: string; category?: Category; location?: string; quantity: number; action: Action; source?: Source; reason?: string }
export interface ConfirmRequest { pendingId: string }
export interface ManualRequest { productId: string; quantity: number; reason: string; requestId: string }
export interface ConfirmResult { product: Product; history: HistoryEntry }
export interface TokenResponse { token: string; model: string }
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
