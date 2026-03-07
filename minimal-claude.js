const { execSync } = require('child_process');

const prompt = process.argv[2] || '你好';
const model = 'bailian-coding-plan/qwen3-max-2026-01-23';

try {
  const command = `opencode run --format json --model "${model}" "${prompt}"`;
  const stdout = execSync(command, { encoding: 'utf8', timeout: 120000 });
  
  const lines = stdout.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      
      if (data.type === 'text' && data.part?.text) {
        process.stdout.write(data.part.text);
      }
    } catch (err) {
    }
  }
  
  process.stdout.write('\n');
} catch (error) {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
}