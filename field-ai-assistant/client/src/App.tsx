import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Action, ConfirmResult, HistoryEntry, InventoryChange, Product } from '../../shared/types';
import { Icon, type IconName } from './components/Icon';
import { Modal } from './components/Modal';
import { api, ApiError } from './services/api';
import { useGeminiLive } from './hooks/useGeminiLive';
import './styles.css';

type Page = 'assistant' | 'inventory' | 'history';
const navigation: { id: Page; label: string; icon: IconName }[] = [
  { id: 'assistant', label: 'AIアシスタント', icon: 'spark' },
  { id: 'inventory', label: '在庫管理', icon: 'box' },
  { id: 'history', label: '変更履歴', icon: 'history' },
];
const actions: Record<Action, string> = { shipment: '出荷', restock: '入荷', adjustment: '在庫調整' };
const unit = (id: string) => id === 'chair-001' ? '脚' : '台';
const messageOf = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。もう一度お試しください。';
const demoAvailable = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';

function ManualDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (result: ConfirmResult) => void }) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const change = Number(quantity);
    if (!Number.isSafeInteger(change) || !change || !reason.trim()) { setError('増減数量（0以外の整数）と理由を入力してください。'); return; }
    lock.current = true; setBusy(true); setError('');
    try { onSaved(await api.manual({ productId: product.id, quantity: change, reason: reason.trim(), requestId: requestId.current })); }
    catch (caught) { setError(messageOf(caught)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal titleId="manual-title" onEscape={() => !lock.current && onClose()}>
    <form onSubmit={save} className="modal-content">
      <div className="eyebrow">手動で調整</div><h2 id="manual-title">{product.name}</h2>
      <p className="muted">現在庫 <strong>{product.quantity}{unit(product.id)}</strong></p>
      <label htmlFor="manual-quantity">増減数量</label>
      <input autoFocus id="manual-quantity" type="number" step="1" placeholder="例：入荷は 3、出荷は -5" required value={quantity} onChange={event => { setQuantity(event.target.value); requestId.current = crypto.randomUUID(); }} disabled={busy} />
      <label htmlFor="manual-reason">変更する理由</label>
      <textarea id="manual-reason" placeholder="例：棚卸しで差異を確認したため" maxLength={500} required value={reason} onChange={event => { setReason(event.target.value); requestId.current = crypto.randomUUID(); }} disabled={busy} />
      {quantity && Number.isSafeInteger(Number(quantity)) && <p className="manual-preview">変更後 <strong>{product.quantity + Number(quantity)}{unit(product.id)}</strong></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>キャンセル</button><button className="button primary" disabled={busy} type="submit">{busy ? '保存しています…' : '保存する'}</button></div>
    </form>
  </Modal>;
}

export default function App() {
  const [page, setPage] = useState<Page>('assistant');
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<InventoryChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualProduct, setManualProduct] = useState<Product | null>(null);
  const [demoMessage, setDemoMessage] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const pendingRef = useRef<InventoryChange | null>(null);
  const mutationLock = useRef(false);
  const prepareLock = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { const [p, h] = await Promise.all([api.getProducts(), api.getHistory()]); setProducts(p); setHistory(h); setError(''); }
    catch (caught) { setError(messageOf(caught)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function updatePending(value: InventoryChange | null) { pendingRef.current = value; setPending(value); }
  function applyResult(result: ConfirmResult) {
    setProducts(previous => previous.map(product => product.id === result.product.id ? result.product : product));
    setHistory(previous => [result.history, ...previous.filter(item => item.id !== result.history.id)]);
    setNotice(`更新しました。${result.product.name}の在庫は${result.product.quantity}${unit(result.product.id)}です。`);
    setError('');
  }
  async function confirmPendingChange(): Promise<unknown> {
    const change = pendingRef.current;
    if (!change) return { error: '確認待ちの変更はありません。' };
    if (mutationLock.current) return { error: '変更を処理しています。重複実行しません。' };
    mutationLock.current = true; setBusy(true); setError('');
    try {
      const result = await api.confirm(change.id);
      updatePending(null); applyResult(result);
      return result;
    } catch (caught) {
      const text = messageOf(caught); setError(text);
      if (caught instanceof ApiError && [404, 409, 410].includes(caught.status)) { updatePending(null); void refresh(); }
      return { error: text };
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function cancelPendingChange(): Promise<unknown> {
    const change = pendingRef.current;
    if (!change) return { cancelled: true };
    if (mutationLock.current) return { error: '変更を処理しています。' };
    mutationLock.current = true; setBusy(true); setError('');
    try {
      const result = await api.cancel(change.id); updatePending(null); setNotice('変更を取り消しました。在庫は変更されていません。'); return result;
    } catch (caught) { const text = messageOf(caught); setError(text); return { error: text }; }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function prepareChange(args: Record<string, unknown>) {
    if (pendingRef.current || prepareLock.current) return { error: '先に画面の確認待ちの変更に、はい・いいえで回答してください。' };
    prepareLock.current = true;
    try {
      const change = await api.prepare({ productId: String(args.productId ?? ''), quantity: Number(args.quantity), action: args.action as Action, source: 'ai' });
      updatePending(change); setNotice(''); setError(''); return change;
    } finally { prepareLock.current = false; }
  }
  const live = useGeminiLive({
    hasPending: Boolean(pending),
    onVoiceDecision: decision => decision === 'confirm' ? confirmPendingChange() : cancelPendingChange(),
    onToolCall: async (name, args) => {
      try {
        if (name === 'get_products') return await api.getProducts();
        if (name === 'get_product_by_category') return await api.getByCategory(String(args.category ?? ''));
        if (name === 'get_inventory') return await api.getInventory(String(args.productId ?? ''));
        if (name === 'prepare_inventory_change') return await prepareChange(args);
        return { error: 'この操作はユーザーの音声または確認ボタンからのみ実行できます。' };
      } catch (caught) { const text = messageOf(caught); setError(text); return { error: text }; }
    },
  });
  useEffect(() => {
    if (videoRef.current) { videoRef.current.srcObject = live.cameraStream; void videoRef.current.play().catch(() => {}); }
  }, [live.cameraStream, page]);
  async function decideFromButton(yes: boolean) {
    const result = await (yes ? confirmPendingChange() : cancelPendingChange());
    live.notifyDecision(result);
  }
  async function runDemo(action: 'recognize' | 'ship') {
    setDemoBusy(true); setError('');
    try {
      if (action === 'recognize') {
        const product = await api.getByCategory('chair');
        setDemoMessage(`椅子ですね。登録されている${product.name}として扱います。現在の在庫は${product.quantity}脚です。`);
      } else {
        const result = await prepareChange({ productId: 'chair-001', quantity: 5, action: 'shipment' });
        if ('error' in result) setError(String(result.error));
        else setDemoMessage(`${result.productName}を5脚出荷します。${result.beforeQuantity}脚から${result.afterQuantity}脚に変更してよろしいですか？`);
      }
    } catch (caught) { setError(messageOf(caught)); }
    finally { setDemoBusy(false); }
  }
  const started = live.status !== 'disconnected';
  const statusLabels = { disconnected: '未接続', connecting: '接続中', connected: '接続済', error: 'エラー' };
  const total = products.reduce((sum, product) => sum + product.quantity, 0);
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#assistant" className="brand-lockup" onClick={event => { event.preventDefault(); setPage('assistant'); }}><span className="brand-mark"><Icon name="spark" /></span><span>現場AI<span className="brand-sub">アシスタント</span></span></a>
      <div className="nav-label">ワークスペース</div>
      <nav aria-label="メインナビゲーション">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'selected' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{page === item.id && <span className="nav-marker" />}</button>)}</nav>
      <div className="sidebar-foot"><span className="local-indicator" />ローカルワークスペース<small>在庫の変更は、あなたの確認から。</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>ワークスペース <span className="breadcrumb-slash">/</span> <strong>{navigation.find(item => item.id === page)?.label}</strong></span><span className={`connection ${live.status}`}><span className="status-dot" />{statusLabels[live.status]}</span></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">FIELD AI ASSISTANT</p><h1>{navigation.find(item => item.id === page)?.label}</h1></div><span className="local-label">現場の在庫を、もっと身近に。</span></div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void refresh()}>再読み込み</button></div>}
        {notice && <div className="alert success" role="status"><Icon name="check" /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="通知を閉じる"><Icon name="close" /></button></div>}
        {page === 'assistant' && <>
          <div className={`assistant-layout ${!started ? 'not-started' : ''}`}>
            <section className="camera-panel" aria-label="カメラとAIアシスタント">
              <div className="camera-toolbar"><span><Icon name="camera" />カメラビュー</span><span className="camera-status">{live.cameraStream ? 'カメラ ON' : 'カメラ OFF'}</span></div>
              <div className={`camera-stage ${live.cameraStream ? 'has-stream' : ''}`}>
                <video ref={videoRef} autoPlay playsInline muted aria-label="カメラプレビュー" hidden={!live.cameraStream} />
                {!live.cameraStream && <div className="camera-placeholder"><div className="camera-illustration"><Icon name="camera" /></div><strong>{live.status === 'connecting' ? 'カメラとマイクを準備中です' : '商品にカメラを向けてください'}</strong><p>AIを起動すると、ここに映像が表示されます。</p></div>}
                {live.cameraStream && <div className="camera-frame" aria-hidden="true" />}
                <span className="camera-caption">椅子・デスク・モニターに対応</span>
              </div>
              <div className="camera-footer"><Icon name="mic" /><span>{live.microphoneActive ? 'マイク ON · 普通に話しかけてください' : 'マイク OFF · 起動後にお話しください'}</span></div>
            </section>
            <section className="conversation-panel">
              {!started ? <><div className="assistant-emblem"><Icon name="spark" /></div><h2>映して、話して。<br />在庫管理をかんたんに。</h2><p>カメラを使って商品を確認し、<br />会話だけで在庫を管理できます。</p><button className="button primary start-button" onClick={() => { setDemoMessage(''); void live.start(); }}><Icon name="spark" />AIを起動する<Icon name="arrow" /></button><button className="button secondary" onClick={() => setPage('inventory')}>在庫管理を見る</button><p className="permission-note">起動時にカメラとマイクの<br />アクセス許可が必要です。</p></> : <><div className="conversation-label"><span className={`status-dot ${live.status}`} />{live.aiState || 'お話しください'}</div><h2>何を確認しますか？</h2><div className="speech-block"><span className="speaker">AIアシスタント</span><p aria-live="polite">{live.latestMessage || '接続後、商品にカメラを向けて話しかけてください。'}</p></div>{live.userTranscript && <div className="user-speech"><span className="speaker">あなた</span><p>{live.userTranscript}</p></div>}{live.error && <div className="form-error" role="alert">{live.error}</div>}{live.status === 'error' && <button className="button primary" onClick={() => void live.reconnect()}>再接続</button>}<button className="button secondary end-button" onClick={() => live.stop()}><Icon name="stop" />会話を終了</button></>}
            </section>
          </div>
          <section className="guide-strip" aria-label="使い方"><div className="guide-title"><Icon name="mic" /><strong>こんなふうに<br />話しかけてください</strong></div><ol><li><span>01</span><div><strong>商品を確認</strong><p>「これ何？」</p></div></li><li><span>02</span><div><strong>在庫を操作</strong><p>「これ5脚出荷して」</p></div></li><li><span>03</span><div><strong>内容を確認</strong><p>「はい」で変更を確定</p></div></li></ol></section>
          {demoAvailable && <details className="demo-panel"><summary>開発・緊急デモ</summary><p>音声・画像認識を模擬します。在庫と履歴は実際に更新されます。</p><div className="button-row"><button className="button secondary" disabled={demoBusy || Boolean(pending)} onClick={() => void runDemo('recognize')}>椅子を認識</button><button className="button secondary" disabled={demoBusy || Boolean(pending)} onClick={() => void runDemo('ship')}>5脚出荷</button></div>{demoMessage && <p role="status">{demoMessage}</p>}</details>}
        </>}
        {page === 'inventory' && <section className="data-panel"><div className="section-heading"><div><h2>登録商品</h2><p>{products.length}種類の商品 <span className="separator">·</span> 合計 {total}点</p></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}>{loading ? '読み込み中…' : '最新の在庫に更新'}</button></div>{!products.length ? <div className="empty-state"><Icon name="box" /><h2>{loading ? '在庫を読み込んでいます' : '商品を表示できませんでした'}</h2><p>接続を確認して、もう一度読み込んでください。</p><button className="button secondary" disabled={loading} onClick={() => void refresh()}>再読み込み</button></div> : <div className="product-list"><div className="product-table-heading"><span>商品名 / カテゴリ</span><span>現在庫</span><span>操作</span></div>{products.map(product => <article className="product-row" key={product.id}><div className="product-identity"><span className="product-icon"><Icon name={product.category} /></span><div><h3>{product.name}</h3><p>{product.categoryJa}<span className="separator">/</span>{product.id}</p></div></div><div className="stock-number">{product.quantity}<span>{unit(product.id)}</span></div><button className="button secondary" onClick={() => setManualProduct(product)} disabled={Boolean(pending)}>在庫を変更</button></article>)}</div>}<p className="panel-note">変更は保存後すぐに反映され、変更履歴に記録されます。</p></section>}
        {page === 'history' && <section className="data-panel"><div className="section-heading"><div><h2>すべての変更</h2><p>新しい順に表示しています</p></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}>履歴を更新</button></div>{!history.length ? <div className="empty-state"><Icon name="history" /><h2>まだ変更履歴はありません</h2><p>在庫を変更すると、ここに記録されます。</p><button className="button primary" onClick={() => setPage('inventory')}>在庫管理を見る</button></div> : <div className="history-list">{history.map(item => <article className="history-row" key={item.id}><div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span className={`source ${item.source}`}>{item.source === 'ai' ? 'AI' : 'MANUAL'}</span></div><div><h3>{item.productName}</h3><p>{actions[item.action]}{item.reason ? ` · ${item.reason}` : ''}</p></div><div className="history-quantity">{item.beforeQuantity}<Icon name="arrow" /><strong>{item.afterQuantity}</strong><span>{unit(item.productId)}</span></div><strong className={`change ${item.change > 0 ? 'positive' : ''}`}>{item.change > 0 ? '+' : ''}{item.change}</strong></article>)}</div>}</section>}
        <footer className="workspace-footer"><span>カメラでは一般カテゴリを判定し、登録商品として扱います。</span><span>保存先：この端末</span></footer>
      </main>
    </div>
    {pending && <Modal titleId="confirm-title" onEscape={() => !mutationLock.current && void decideFromButton(false)}><div className="modal-content confirmation"><div className="eyebrow">あなたの確認が必要です</div><h2 id="confirm-title">在庫を変更しますか？</h2><p className="confirm-product">{pending.productName}</p><div className="quantity-comparison"><div><span>現在</span><strong>{pending.beforeQuantity}<small>{unit(pending.productId)}</small></strong></div><Icon name="arrow" /><div><span>変更後</span><strong>{pending.afterQuantity}<small>{unit(pending.productId)}</small></strong></div></div><p>{actions[pending.action]}数：{Math.abs(pending.quantity)}{unit(pending.productId)}</p><p className="muted">「はい」「いいえ」と話すか、ボタンで回答してください。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button autoFocus className="button secondary" disabled={busy} onClick={() => void decideFromButton(false)}>いいえ</button><button className="button primary" disabled={busy} onClick={() => void decideFromButton(true)}><Icon name="check" />{busy ? '処理しています…' : 'はい'}</button></div><small className="muted">確認するまで、在庫は変更されません。</small></div></Modal>}
    {manualProduct && !pending && <ManualDialog product={manualProduct} onClose={() => setManualProduct(null)} onSaved={result => { applyResult(result); setManualProduct(null); }} />}
  </div>;
}
