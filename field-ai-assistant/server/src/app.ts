import express, { type ErrorRequestHandler } from 'express';
import { resolve } from 'node:path';
import { InventoryRepository } from './repositories/inventoryRepository.js';
import { InventoryError, InventoryService } from './services/inventoryService.js';
import { registerGeminiRoutes } from './gemini.js';

export async function createApp(options: { dataDir?: string; gemini?: boolean } = {}) {
  const repository = await InventoryRepository.create(options.dataDir ?? process.env.DATA_DIR ?? resolve('server/data'));
  const service = new InventoryService(repository);
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const hostname = request.hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      response.status(403).json({ error: 'このアプリはlocalhost専用です。' }); return;
    }
    const origin = request.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch { response.status(403).json({ error: 'この接続元からは操作できません。' }); return; }
    }
    if (request.method === 'POST' && !request.is('application/json')) {
      response.status(415).json({ error: 'JSON形式で送信してください。' }); return;
    }
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/products', async (_request, response) => response.json(await service.getProducts()));
  app.get('/api/products/category/:category', async (request, response) => response.json(await service.getByCategory(request.params.category)));
  app.get('/api/products/:id', async (request, response) => response.json(await service.getProduct(request.params.id)));
  app.get('/api/history', async (_request, response) => response.json(await service.getHistory()));
  app.post('/api/inventory/prepare', async (request, response) => response.json(await service.prepare(request.body)));
  app.post('/api/inventory/confirm', async (request, response) => response.json(await service.confirm(request.body?.pendingId)));
  app.post('/api/inventory/cancel', async (request, response) => response.json(await service.cancel(request.body?.pendingId)));
  app.post('/api/inventory/manual', async (request, response) => response.json(await service.manual(request.body)));
  if (options.gemini !== false) registerGeminiRoutes(app);
  app.use('/api', (_request, response) => response.status(404).json({ error: 'APIが見つかりません。' }));
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof InventoryError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError || (error as { type?: string })?.type === 'entity.too.large') {
      response.status(400).json({ error: '送信内容を確認してください。' }); return;
    }
    console.error('在庫APIの処理に失敗しました。');
    response.status(500).json({ error: '在庫を更新できませんでした。もう一度お試しください。' });
  };
  app.use(handleError);
  return app;
}
