import { GoogleGenAI } from '@google/genai';
import type { Express } from 'express';
import { LIVE_API_VERSION, LIVE_CONFIG, LIVE_MODEL } from '../../shared/live-config.js';
import type { TokenResponse } from '../../shared/types.js';

export function registerGeminiRoutes(app: Express) {
  app.post('/api/gemini/token', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'your_api_key_here') {
      response.status(503).json({ error: 'AIの接続設定がまだ完了していません。管理者に設定を依頼してください。' });
      return;
    }
    try {
      const client = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: LIVE_API_VERSION, timeout: 20_000 } });
      const token = await client.authTokens.create({ config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        liveConnectConstraints: { model: LIVE_MODEL, config: LIVE_CONFIG },
      } });
      if (!token.name) throw new Error('Token unavailable');
      response.json({ token: token.name, model: LIVE_MODEL } satisfies TokenResponse);
    } catch {
      // Do not log upstream errors: SDK errors can include credentials or request metadata.
      response.status(502).json({ error: 'AIに接続できませんでした。接続設定や通信状況を確認して、もう一度お試しください。' });
    }
  });
}
