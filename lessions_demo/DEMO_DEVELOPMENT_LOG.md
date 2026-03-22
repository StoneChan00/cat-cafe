# demo开发日志-Phase0
此处为demo的开发日志，不再更新

## 2026-03-22 - 切换到 MCP 回传 demo 主线

### 背景

项目最初是围绕 `invoke.js` 的 `opencode` 模型调用封装展开，后续需求切换为：

1. 搭建一个最小 MCP 回传系统
2. 理解“AI 内部输出”和“AI 主动公开发言”的差别
3. 在中国大陆环境下避开官方 Claude Code 直连限制

### 本次整理后的主线文件

- `callback-server.js`
- `cat-cafe-mcp.js`
- `run-cat.js`

### 核心设计

#### 1. `callback-server.js`

用原生 `http` 模块实现本地回调服务器：

- `POST /api/callbacks/post-message`
- `GET /api/callbacks/thread-context`

服务启动时生成一组：

- `invocationId`
- `callbackToken`

用于当前会话鉴权。

#### 2. `cat-cafe-mcp.js`

使用 `@modelcontextprotocol/sdk` 实现最小 MCP Server，暴露两个工具：

- `cat_cafe_post_message`
- `cat_cafe_get_context`

工具本身并不负责显示消息，而是把内容通过 HTTP 回传给 `callback-server.js`。

#### 3. `run-cat.js`

最初版本基于 `claude` CLI，但由于官方 Anthropic 服务在中国大陆不可直接使用，后续改为基于 `opencode`：

- 使用 `opencode run --format json --model ...`
- 通过 `OPENCODE_CONFIG_CONTENT` 临时注入本地 MCP 配置
- 将 `cat-cafe-mcp.js` 作为本地 stdio MCP 服务加载
- 解析 `opencode` 的 NDJSON 输出，展示内部过程

### 为什么这样设计

这个结构能清楚地区分两种输出：

1. **内部输出**：`run-cat.js` 终端中看到的 `text` / `reasoning` / `tool_use`
2. **公开输出**：`callback-server.js` 终端中收到的 `cat_cafe_post_message`

这样就能直观看到“模型想了什么”和“模型决定公开什么”不是同一条通道。

### 兼容性处理

#### Windows / PowerShell

`run-cat.js` 在 Windows 下使用：

```javascript
cmd.exe /c opencode ...
```

避免直接 `spawn('opencode')` 时的命令解析差异。

#### MCP 配置注入

`opencode` 不像 Claude CLI 那样使用 `--mcp-config` 直接传内联 JSON，而是通过配置层加载 MCP。

因此在 `run-cat.js` 中采用：

```javascript
OPENCODE_CONFIG_CONTENT
```

给当前子进程临时注入 MCP 配置，而不污染用户的全局 `opencode` 配置文件。

### 目录整理

由于历史上保留了上一轮模型调用封装脚本，根目录出现了混合状态。本次已将以下文件归档到 `his/`：

- `invoke.js`
- `minimal-glm.js`
- `minimal-codex.js`
- 旧的 `DEVELOPMENT_LOG.md`
- 会话记录 `session-ses_2ebf.md`

同时移除了空的 `sessions_log/` 目录，使根目录只保留当前 MCP demo 需要的运行文件。

## 2026-03-22 - 文档与元数据同步

### 更新内容

1. 重写 `README.md`，改为说明当前 MCP 回传 demo
2. 修正 `package.json` 的 `main`，从旧的 `invoke.js` 改成 `run-cat.js`
3. 增加 `npm run check`，统一校验三个运行文件语法

## 2026-03-22 - 补充故障排查文档

### 更新内容

围绕当前 `opencode + MCP 回传 demo`，在 `README.md` 中补充了一段集中式故障排查，覆盖：

1. `opencode` 不在 PATH
2. PowerShell 环境变量未生效
3. 回调服务未启动或鉴权信息过期
4. provider / model 配置不可用
5. 模型没有实际触发 MCP 工具
6. SDK 依赖缺失或 MCP 服务启动失败

### 目的

让项目从“能运行的 demo”进一步变成“别人也更容易排查并复现的 demo”，减少后续重复口头说明成本。

### 当前建议维护方式

后续如果继续扩展这个项目，优先围绕以下三部分演进：

- `callback-server.js`：聊天室侧
- `cat-cafe-mcp.js`：工具桥接侧
- `run-cat.js`：Agent 运行侧

历史脚本保留在 `his/` 仅作参考，不建议继续在主线功能里直接复用。


## 2026-03-22 - 增加 session 重置接口

### 需求
在自动续聊的基础上，增加显式的 session 管理能力，支持：

1. 重置单个模型的会话
2. 一次性清空全部会话

### 实现方案

#### 1. 增加 `resetSession(cli)`
按模型别名删除对应的 session 记录：

```javascript
function resetSession(cli) {
  if (!isSupportedCli(cli)) {
    throw new Error(`不支持的 cli: ${cli}`);
  }

  const sessions = readSessions();
  delete sessions[cli];
  writeSessions(sessions);
}
```

#### 2. 增加 `clearAllSessions()`
统一清空 `.invoke-sessions.json` 中的所有记录：

```javascript
function clearAllSessions() {
  const cleared = Object.keys(readSessions()).length;
  writeSessions({});
  return cleared;
}
```

#### 3. 统一 CLI 校验
新增 `isSupportedCli(cli)`，让 `invoke()` 和 `resetSession()` 共用同一套模型别名校验：

```javascript
function isSupportedCli(cli) {
  return Object.prototype.hasOwnProperty.call(MODELS, cli);
}
```

### 技术要点

1. **显式重置能力**: 不再只能靠手动删除 `.invoke-sessions.json` 来清理会话
2. **按模型隔离管理**: 支持只重置 `glm` 或只重置 `codex`
3. **接口更完整**: `invoke.js` 现在同时导出调用、单个重置、批量清空三类能力

### 使用方式

```javascript
const { invoke, resetSession, clearAllSessions } = require('./invoke');

resetSession('glm');
await invoke('glm', '重新开始');

clearAllSessions();
```

### 验证通过
✅ `resetSession(cli)` 已导出
✅ `clearAllSessions()` 已导出
✅ README 已同步更新示例

## 2026-03-22 - 强化子进程超时与生命周期管理

### 需求
检查并修复 CLI 子进程调用中的稳定性问题，重点包括：

1. 超时检测不能只看 stdout
2. 长任务需要更合理的超时配置
3. 超时后需要优雅终止子进程
4. 父进程退出时需要清理子进程
5. 错误信息需要足够详细，便于调试

### 问题分析

原实现虽然已经具备基础的 NDJSON 解析能力，但仍存在以下风险：

1. **活跃信号不完整**：stderr 虽然会打印，但不会刷新超时活动时间
2. **超时策略过于简单**：固定 120 秒不适合复杂推理或工具调用任务
3. **缺少优雅退出**：没有 `SIGTERM -> 等待 -> SIGKILL` 的分级清理
4. **缺少父进程信号处理**：收到 `SIGINT`/`SIGTERM` 时不会主动回收子进程
5. **错误上下文不足**：异常退出时缺少模型、session、stderr 摘要等调试信息

### 实现方案

#### 1. 引入双层超时配置
新增默认空闲超时与总时长超时：

```javascript
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000;
const FORCE_KILL_GRACE_MS = 5 * 1000;
```

并让 `invoke` 支持通过第三个参数覆盖：

```javascript
await invoke('codex', '请分析这个问题', {
  idleTimeoutMs: 15 * 60 * 1000,
  hardTimeoutMs: 45 * 60 * 1000
});
```

#### 2. 同时监听 stdout 与 stderr 活跃信号
只监听 stdout 容易把 thinking 或工具调用误判为空闲，因此改为双通道刷新活动时间：

```javascript
const markActivity = () => {
  lastActivity = Date.now();
  refreshIdleTimer();
};

child.stdout.on('data', () => {
  markActivity();
});

child.stderr.on('data', () => {
  markActivity();
});
```

#### 3. 增加优雅终止机制
超时或父进程信号触发时，先发 `SIGTERM`，等待 5 秒后仍未退出再发 `SIGKILL`：

```javascript
const terminateChild = (reason) => {
  child.kill('SIGTERM');

  forceKillTimer = setTimeout(() => {
    child.kill('SIGKILL');
  }, FORCE_KILL_GRACE_MS);
};
```

#### 4. 增加父进程信号清理
对 `SIGINT`、`SIGTERM` 和 `exit` 做统一清理，降低残留子进程风险：

```javascript
process.on('SIGINT', () => {
  terminateChild('parent-sigint');
});

process.on('SIGTERM', () => {
  terminateChild('parent-sigterm');
});
```

#### 5. 补充错误上下文
为错误对象附加更多调试信息：

```javascript
const error = new Error(message);
error.details = {
  cli,
  model,
  sessionID,
  args,
  idleTimeoutMs,
  hardTimeoutMs,
  stderrTail
};
```

### 技术要点

1. **空闲超时与总时长超时分离**：避免单一超时策略误杀正常任务
2. **stderr 也算活跃输出**：更适合 LLM CLI 的 thinking / tool-call 场景
3. **优雅退出优先**：先 `SIGTERM` 再 `SIGKILL`，减少异常中断副作用
4. **错误可诊断性增强**：失败后可以直接看到模型、session、超时和 stderr 摘要
5. **兼容现有调用方式**：保留 `await invoke('glm', '你好')`，仅额外支持 `options`

### 验证结果

```bash
node --check invoke.js
node --check minimal-glm.js
node --check minimal-codex.js
```

### 验证通过
✅ 双通道活跃检测已接入
✅ 空闲超时与总时长超时已支持
✅ 子进程优雅终止机制已接入
✅ 父进程退出清理逻辑已接入
✅ 错误信息已包含调试上下文

## 2026-03-22 - 抽取共享 invoke 并支持会话续聊

### 需求
将重复的模型调用脚本抽取成统一的 `invoke(cli, prompt)` 接口，同时支持：

1. `glm` -> `bailian-coding-plan/glm-5`
2. `codex` -> `codex_service/gpt-5.4`
3. 记住各自的会话，下次调用时自动继续对话

### 实现方案

#### 1. 抽取共享调用模块
新增 `invoke.js`，统一处理模型映射、子进程启动、JSON 流解析和错误处理：

```javascript
const MODELS = {
  glm: 'bailian-coding-plan/glm-5',
  codex: 'codex_service/gpt-5.4'
};

function invoke(cli, prompt) {
  const model = MODELS[cli];
  // 使用 opencode run --format json 调用对应模型
}
```

#### 2. 保留两个极简入口脚本
将原有重复逻辑收敛到共享模块后，两个入口只负责传入不同的 `cli`：

```javascript
const { invoke } = require('./invoke');

invoke('glm', process.argv[2] || '你好').catch((error) => {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
});
```

```javascript
const { invoke } = require('./invoke');

invoke('codex', process.argv[2] || '你好').catch((error) => {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
});
```

#### 3. 增加 session 持久化
为每个 `cli` 独立存储 `sessionID`，并在下次调用时自动追加 `--session <id>`：

```javascript
const SESSION_FILE = path.join(__dirname, '.invoke-sessions.json');

function getSessionId(cli) {
  const sessions = readSessions();
  return sessions[cli]?.sessionID || null;
}

function setSessionId(cli, sessionID) {
  sessions[cli] = {
    sessionID,
    updatedAt: new Date().toISOString()
  };
}
```

#### 4. 从流式事件中提取 sessionID
`opencode run --format json` 的每条事件都可能带有 `sessionID`，因此在解析输出时顺手落盘：

```javascript
function handleEvent(cli, data, chunks) {
  if (data.sessionID) {
    setSessionId(cli, data.sessionID);
  }

  if (data.type === 'text' && data.part?.text) {
    chunks.push(data.part.text);
    process.stdout.write(data.part.text);
  }
}
```

### 技术要点

1. **统一入口**: 用 `invoke(cli, prompt)` 消除 `minimal-glm.js` 与 `minimal-codex.js` 的重复逻辑
2. **模型隔离**: `glm` 和 `codex` 使用独立的模型映射与独立的 session
3. **续聊机制**: 通过持久化 `sessionID` 并传递 `--session` 实现稳定续聊
4. **兼容现有调用链**: 继续使用 `opencode run --format json`，不引入新的 CLI 依赖

### 当前文件结构

- `invoke.js` - 共享调用与 session 管理
- `minimal-glm.js` - GLM 入口脚本
- `minimal-codex.js` - Codex 模型入口脚本
- `.invoke-sessions.json` - 运行后自动生成的会话记录文件

### 使用方式

```javascript
const { invoke } = require('./invoke');

await invoke('glm', '你好');
await invoke('glm', '继续刚才的话题');

await invoke('codex', '你好');
await invoke('codex', '继续展开');
```

### 验证结果

```bash
node --check invoke.js
node --check minimal-glm.js
node --check minimal-codex.js
```

### 验证通过
✅ 共享 `invoke(cli, prompt)` 接口已抽取
✅ `glm` 与 `codex` 双入口已拆分
✅ session 自动持久化与续聊逻辑已接入
✅ 三个脚本语法检查通过

## 2026-03-16 - 将 execSync 改为 spawn

### 需求
将项目从同步的 `execSync` 改为异步的 `spawn`，实现更好的子进程控制。

### 实现方案

#### 1. 改用 spawn 创建子进程
```javascript
const { spawn } = require('child_process');
const command = process.platform === 'win32' ? 'cmd.exe' : 'opencode';
const args = process.platform === 'win32' 
  ? ['/c', 'opencode', 'run', '--format', 'json', '--model', model, prompt]
  : ['run', '--format', 'json', '--model', model, prompt];

const child = spawn(command, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 120000
});
```

#### 2. 处理 stdout 数据流
使用 buffer 处理跨数据块的 JSON 行：
```javascript
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
```

#### 3. 添加事件处理
- `stderr.on('data')`: 处理错误输出
- `close.on('close')`: 处理进程退出，处理剩余 buffer
- `error.on('error')`: 处理进程启动错误

### 技术要点

1. **Windows 兼容性**: 使用 `cmd.exe /c` 执行 opencode 命令
2. **流式处理**: 使用 buffer 处理跨数据块的 JSON 行
3. **错误处理**: 添加完整的事件监听和错误处理
4. **退出码检查**: 检查子进程退出码，非零则退出

### 测试结果
```bash
node minimal-claude.js "1+1=?"
# 输出: 2

node minimal-claude.js "写一个hello world函数"
# 输出:
# ```python
# def hello_world():
#     print("Hello, World!")
# ```
```

### 验证通过
✅ 简单提示测试通过
✅ 复杂提示测试通过
✅ 流式输出正常工作
✅ 错误处理正常工作

---

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
