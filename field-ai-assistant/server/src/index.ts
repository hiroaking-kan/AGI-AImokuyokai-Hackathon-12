import { config } from 'dotenv';
import { createApp } from './app.js';

config({ path: '.env.local', quiet: true });
const port = Number(process.env.API_PORT || process.env.PORT || 8787);
const app = await createApp();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Inventory API: http://127.0.0.1:${port}`);
});
server.on('error', () => {
  console.error('サーバーを起動できません。ポートの使用状況を確認してください。');
  process.exitCode = 1;
});
