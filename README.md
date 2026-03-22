# cat-cafe

一个最小化的 Node.js 调用封装，用 `opencode` 统一访问两套模型：

- `glm` -> `bailian-coding-plan/glm-5`
- `codex` -> `codex_service/gpt-5.4`

项目核心是 `invoke(cli, prompt, options)`，支持：

- 按模型别名调用 `opencode run --format json`
- 流式输出模型文本
- 返回完整回复内容
- 自动记住会话，并在下次调用时继续对话
- 同时用 stdout 和 stderr 作为活跃信号，避免误判超时
- 支持空闲超时、总时长超时，以及优雅终止子进程

## 文件结构

```text
.
├─ invoke.js            # 共享调用入口
├─ minimal-glm.js       # GLM 命令行入口
├─ minimal-codex.js     # Codex 命令行入口
├─ DEVELOPMENT_LOG.md   # 开发日志
└─ .invoke-sessions.json  # 运行后自动生成，用于保存 session
```

## 运行前提

需要本机已安装并可直接执行：

- `node`
- `opencode`

同时需要在 `C:\Users\chens\.config\opencode\opencode.json` 中配置好对应 provider，当前项目依赖：

- `bailian-coding-plan`
- `codex_service`

## 命令行用法

### 调用 GLM

```bash
node minimal-glm.js "你好"
```

### 调用 Codex 模型

```bash
node minimal-codex.js "你好"
```

这两个脚本都会：

- 把提示词传给 `opencode`
- 实时打印流式输出
- 自动复用上一次该模型对应的 session

## 编程方式调用

### 基本用法

```javascript
const { invoke } = require('./invoke');

async function main() {
  await invoke('glm', '你好');
  await invoke('codex', '你好');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### 继续同一个会话

```javascript
const { invoke } = require('./invoke');

async function main() {
  await invoke('glm', '你好');
  await invoke('glm', '继续刚才的话题');

  await invoke('codex', '你好');
  await invoke('codex', '继续展开');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`invoke(cli, prompt, options)` 的特性：

- `cli` 目前支持 `glm` 和 `codex`
- `prompt` 为空时默认使用 `你好`
- 返回 `Promise<string>`，结果为完整回复文本
- 调用过程中会同步把流式文本打印到 stdout
- `options.idleTimeoutMs` 可覆盖空闲超时，默认 10 分钟
- `options.hardTimeoutMs` 可覆盖总时长超时，默认 30 分钟

## Session 管理

除了自动续聊，`invoke.js` 还导出了两个手动管理会话的接口：

- `resetSession(cli)`：删除指定模型的 session
- `clearAllSessions()`：清空所有已保存的 session

### 重置单个模型会话

```javascript
const { invoke, resetSession } = require('./invoke');

async function main() {
  resetSession('glm');
  await invoke('glm', '重新开始一个新对话');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### 清空所有会话

```javascript
const { clearAllSessions } = require('./invoke');

const cleared = clearAllSessions();
console.log(`cleared sessions: ${cleared}`);
```

### 自定义超时

```javascript
const { invoke } = require('./invoke');

async function main() {
  await invoke('codex', '请分析这个问题', {
    idleTimeoutMs: 15 * 60 * 1000,
    hardTimeoutMs: 45 * 60 * 1000
  });
}

main().catch((error) => {
  console.error(error.message);
  console.error(error.details);
  process.exit(1);
});
```

## Session 机制

项目会在根目录生成 `.invoke-sessions.json`，按 `cli` 分别保存 session：

```json
{
  "glm": {
    "sessionID": "ses_xxx",
    "updatedAt": "2026-03-22T07:30:00.000Z"
  },
  "codex": {
    "sessionID": "ses_yyy",
    "updatedAt": "2026-03-22T07:31:00.000Z"
  }
}
```

下次调用时，`invoke.js` 会自动：

1. 读取对应 `cli` 的 `sessionID`
2. 调用 `opencode run --session <sessionID>`
3. 从新的 JSON 事件里继续提取并更新 `sessionID`

这意味着：

- `glm` 和 `codex` 各自独立续聊
- 不需要手动管理 `--session`
- 可以通过 `resetSession(cli)` 重置单个会话
- 可以通过 `clearAllSessions()` 清空全部会话
- 删除 `.invoke-sessions.json` 仍然可以直接重置所有会话

## 实现说明

`invoke.js` 的核心流程：

1. 根据 `cli` 选择模型名
2. 构造 `opencode run --format json --model ...` 命令
3. 如果本地已有 session，则自动追加 `--session`
4. 为 stdout 和 stderr 同时挂活跃监听，刷新空闲超时
5. 逐行解析 NDJSON 输出
6. 遇到 `type === "text"` 且存在 `part.text` 时，输出并收集文本
7. 超时时先发 `SIGTERM`，等待 5 秒后再 `SIGKILL`
8. 进程结束后返回完整文本，或抛出带上下文的错误

## 超时与进程清理

当前实现包含两层超时控制：

- `idleTimeoutMs`：空闲超时，如果 stdout/stderr 在指定时间内都没有新输出，则触发终止
- `hardTimeoutMs`：总时长超时，无论是否有输出，到达上限后都触发终止

终止顺序如下：

1. 发送 `SIGTERM`
2. 等待 5 秒
3. 子进程仍未退出时发送 `SIGKILL`

此外，父进程收到 `SIGINT`、`SIGTERM` 或退出时，也会尝试清理当前子进程。

## 错误信息

失败时，`invoke()` 抛出的错误对象会附带 `error.details`，包含：

- `cli`
- `model`
- `sessionID`
- `command` 与 `args`
- `idleTimeoutMs` / `hardTimeoutMs`
- `terminationReason`
- `runtimeMs`
- `stderrTail`

这能帮助定位是模型退出、超时终止、父进程中断，还是底层启动失败。

## 校验命令

```bash
node --check invoke.js
node --check minimal-glm.js
node --check minimal-codex.js
```

## 注意事项

- 当前项目是最小封装，没有 `package.json`、测试框架或构建脚本
- 运行依赖本机已有可用的 `opencode` 命令
- 如果 provider 配置或本地环境变化，模型调用可能失败
