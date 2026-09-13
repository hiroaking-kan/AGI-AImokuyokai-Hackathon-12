import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';
import { LIVE_API_VERSION, LIVE_CONFIG, LIVE_MODEL } from '../shared/live-config.js';

type Request = IncomingMessage & { body?: unknown; query: Record<string, string | string[] | undefined> };
export default async function handler(request: Request, response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
  const path = '/' + String(request.query.path || '').replace(/^\/+/, '');
  const method = request.method || 'GET';
  if (!['GET', 'POST'].includes(method)) return send(405, { error: 'この操作には対応していません。' });
  if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}`)
    return send(403, { error: 'この接続元からは操作できません。' });
  if (method === 'POST' && !request.headers['content-type']?.startsWith('application/json'))
    return send(415, { error: 'JSON形式で送信してください。' });
  if (JSON.stringify(request.body || {}).length > 16_384) return send(413, { error: '送信内容が大きすぎます。' });
  try {
    if (path === '/gemini/token' && method === 'POST') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return send(503, { error: 'AI接続は準備中です。' });
      const client = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: LIVE_API_VERSION, timeout: 20_000 } });
      const token = await client.authTokens.create({ config: {
        uses: 1, expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        liveConnectConstraints: { model: LIVE_MODEL, config: LIVE_CONFIG },
      } });
      if (!token.name) throw new Error('Unavailable');
      return send(200, { token: token.name, model: LIVE_MODEL });
    }
    const routes: Record<string, RegExp> = {
      GET: /^\/(health|products(?:\/[^/]+(?:\/[^/]+)?)?|history)$/,
      POST: /^\/inventory\/(prepare|confirm|cancel|manual)$/,
    };
    if (!routes[method]?.test(path)) return send(404, { error: 'APIが見つかりません。' });
    const url = process.env.SHEETS_API_URL;
    const secret = process.env.SHEETS_API_SECRET;
    if (!url || !secret) return send(503, { error: 'スプレッドシートへの接続は準備中です。' });
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) throw new Error('Invalid backend');
    const upstream = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, path, method, body: request.body || {} }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) throw new Error('Unavailable');
    const result = await upstream.json() as { status: number; data: unknown };
    if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599) throw new Error('Invalid response');
    return send(result.status, result.data);
  } catch {
    // Never log upstream responses: they may contain authentication metadata.
    return send(502, { error: '接続できませんでした。通信状況と管理者の接続設定を確認してください。' });
  }
}
