/**
 * 快速验证测试
 * 简化版，快速验证核心功能
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');

const TEST_PORT = 3207;
const DEFAULT_MODEL = 'bailian-coding-plan/glm-5';
const MCP_SERVER_PATH = path.join(__dirname, 'lessions_demo', 'cat-cafe-mcp.js');
const TEST_TIMEOUT = 60000; // 1 分钟

async function quickTest() {
  console.log('=== 快速验证测试 ===\n');
  
  // 启动服务器
  const http = require('http');
  const invocationId = randomUUID();
  const callbackToken = randomUUID();
  const messages = [];
  
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${TEST_PORT}`);
    
    if (req.method === 'POST' && url.pathname === '/api/callbacks/post-message') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const p = JSON.parse(body);
          if (p.invocationId === invocationId && p.callbackToken === callbackToken) {
            messages.push(p.content);
            console.log('\n[✓] 收到公开消息:', p.content.slice(0, 50));
            res.writeHead(200);
            res.end('{"status":"ok"}');
            return;
          }
        } catch {}
        res.writeHead(401);
        res.end('{"status":"error"}');
      });
      return;
    }
    
    if (req.method === 'GET' && url.pathname === '/api/callbacks/thread-context') {
      if (url.searchParams.get('invocationId') === invocationId && 
          url.searchParams.get('callbackToken') === callbackToken) {
        res.writeHead(200);
        res.end('{"threadId":"test","messages":[]}');
        return;
      }
      res.writeHead(401);
      res.end('{"status":"error"}');
      return;
    }
    
    res.writeHead(404);
    res.end('{"status":"not_found"}');
  });
  
  await new Promise(r => server.listen(TEST_PORT, r));
  console.log(`服务器启动: http://localhost:${TEST_PORT}`);
  
  // 构建 Prompt
  const prompt = '调用 cat_cafe_post_message 发送消息 "测试成功"';
  
  const mcpConfig = {
    mcp: {
      'cat-cafe': {
        type: 'local',
        command: [process.execPath, MCP_SERVER_PATH],
        enabled: true
      }
    }
  };
  
  const args = ['run', '--format', 'json', '--model', DEFAULT_MODEL, prompt];
  const cmd = process.platform === 'win32' 
    ? spawn('cmd.exe', ['/c', 'opencode', ...args], { 
        env: {
          ...process.env,
          CAT_CAFE_API_URL: `http://localhost:${TEST_PORT}`,
          CAT_CAFE_INVOCATION_ID: invocationId,
          CAT_CAFE_CALLBACK_TOKEN: callbackToken,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(mcpConfig)
        }
      })
    : spawn('opencode', args, { 
        env: {
          ...process.env,
          CAT_CAFE_API_URL: `http://localhost:${TEST_PORT}`,
          CAT_CAFE_INVOCATION_ID: invocationId,
          CAT_CAFE_CALLBACK_TOKEN: callbackToken,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(mcpConfig)
        }
      });
  
  console.log('\n启动 opencode...');
  console.log(`Prompt: ${prompt}\n`);
  
  let buffer = '';
  const toolCalls = [];
  
  const timeout = setTimeout(() => {
    cmd.kill();
    console.log('\n超时，终止进程');
  }, TEST_TIMEOUT);
  
  cmd.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === 'text' && e.part?.text) {
          process.stdout.write(e.part.text);
        }
        if (e.type === 'tool_use' && e.part?.tool) {
          const t = e.part.tool;
          const n = t.includes('_') && t.includes('-') ? t.split('_').slice(1).join('_') : t;
          toolCalls.push(n);
          console.log(`\n[tool] ${n}`);
        }
      } catch {}
    }
  });
  
  return new Promise((resolve) => {
    cmd.on('close', (code) => {
      clearTimeout(timeout);
      
      console.log('\n\n=== 结果 ===');
      console.log(`退出码: ${code}`);
      console.log(`工具调用: ${toolCalls.join(', ') || '无'}`);
      console.log(`公开消息: ${messages.length} 条`);
      
      if (messages.length > 0) {
        console.log('\n消息内容:');
        messages.forEach((m, i) => console.log(`  ${i+1}. ${m}`));
      }
      
      const passed = messages.length > 0;
      console.log(`\n测试: ${passed ? '✓ 通过' : '✗ 未通过'}`);
      
      server.close();
      resolve(passed);
    });
    
    cmd.on('error', (err) => {
      clearTimeout(timeout);
      console.error('进程错误:', err);
      server.close();
      resolve(false);
    });
  });
}

quickTest().then(passed => {
  process.exit(passed ? 0 : 1);
});