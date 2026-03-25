/**
 * Web Server 入口
 * 启动 Cat Cafe Web 界面
 */

import { startWebServer } from './web/server';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

async function main() {
  console.log('');
  console.log('🐱 Cat Cafe Multi-Agent System');
  console.log('================================\n');
  
  const server = await startWebServer(PORT);
  
  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n[web] Shutting down...');
    await server.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n[web] Shutting down...');
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[web] Fatal error:', error);
  process.exit(1);
});