# 开发日志

## 2026-03-07 - 修复 opencode 集成问题

### 问题描述
原项目使用 `claude` CLI 工具，但系统中未安装该工具。需要修改为使用 `opencode` 工具，并指定使用 `bailian-coding-plan/qwen3-max-2026-01-23` 模型。

### 初始状态
项目结构：
- `minimal-claude.js` - 原始脚本，使用 claude CLI
- 缺少 `package.json`、配置文件等

### 问题分析
1. **缺少 claude 工具** - 系统中未安装 claude CLI
2. **Windows 兼容性问题** - Node.js `spawn` 在 Windows 上处理 .cmd 文件存在问题
3. **JSON 格式解析** - opencode 的 JSON 输出格式与 claude 不同

### 解决方案

#### 尝试 1: 直接替换命令
将 `claude` 替换为 `opencode`，使用 `opencode.cmd`：
```javascript
const opencode = spawn('opencode.cmd', ['run', '--format', 'json', '--model', model, prompt]);
```
**结果**: 失败，出现 `EINVAL` 错误

#### 尝试 2: 添加 shell 选项
```javascript
const opencode = spawn('opencode.cmd', ['run', '--format', 'json', '--model', model, prompt], { shell: true });
```
**结果**: 失败，出现超时和安全警告

#### 尝试 3: 使用 cmd /c
```javascript
const opencode = spawn('cmd', ['/c', 'opencode', 'run', '--format', 'json', '--model', model, prompt]);
```
**结果**: 失败，仍然超时

#### 尝试 4: 使用完整路径
```javascript
const opencode = spawn('C:\\Users\\chens\\AppData\\Roaming\\npm\\opencode.cmd', ['run', '--format', 'json', '--model', model, prompt]);
```
**结果**: 失败，仍然是 `EINVAL` 错误

#### 尝试 5: 使用 exec（异步）
```javascript
const opencode = exec(command, (error, stdout, stderr) => { ... });
```
**结果**: 失败，出现超时

#### 最终解决方案: 使用 execSync（同步）
```javascript
const { execSync } = require('child_process');
const stdout = execSync(command, { encoding: 'utf8', timeout: 120000 });
```
**结果**: 成功！

### 技术要点

1. **命令执行方式**: 使用 `execSync` 替代 `spawn`，解决了 Windows 兼容性问题
2. **JSON 格式处理**: opencode 输出格式为：
   ```json
   {"type":"text","part":{"text":"回复内容"}}
   ```
3. **错误处理**: 添加 try-catch 处理 JSON 解析错误
4. **超时设置**: 设置 120 秒超时避免长时间等待

### 最终代码
```javascript
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
```

### 测试结果
```bash
node minimal-claude.js "用一句话介绍自己"
# 输出: 我是 opencode，一个专注于帮助用户完成软件工程任务的智能 CLI 工具。
```

### 经验总结
1. Windows 上的 Node.js 子进程处理需要特别注意
2. `execSync` 在简单命令执行场景下比 `spawn` 更可靠
3. 需要充分测试不同平台上的兼容性
4. JSON 流式输出需要正确的解析逻辑