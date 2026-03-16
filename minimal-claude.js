const { spawn } = require('child_process');

const prompt = process.argv[2] || '你好';
const model = 'bailian-coding-plan/qwen3-max-2026-01-23';

const command = process.platform === 'win32' ? 'cmd.exe' : 'opencode';
const args = process.platform === 'win32' 
  ? ['/c', 'opencode', 'run', '--format', 'json', '--model', model, prompt]
  : ['run', '--format', 'json', '--model', model, prompt];

const child = spawn(command, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 120000
});

let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const data = JSON.parse(line);
      
      if (data.type === 'text' && data.part?.text) {
        process.stdout.write(data.part.text);
      }
    } catch (err) {
      // 忽略 JSON 解析错误
    }
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('close', (code) => {
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      
      if (data.type === 'text' && data.part?.text) {
        process.stdout.write(data.part.text);
      }
    } catch (err) {
      // 忽略最后的 JSON 解析错误
    }
  }
  
  process.stdout.write('\n');
  
  if (code !== 0) {
    process.exit(code);
  }
});

child.on('error', (error) => {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
});
