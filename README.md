# cat-cafe

一个最小化的 Node.js 调用封装，用 `opencode` 统一访问两套模型：

- `glm` -> `bailian-coding-plan/glm-5`
- `codex` -> `codex_service/gpt-5.4`

项目核心是 `invoke(cli, prompt)`，支持：

- 按模型别名调用 `opencode run --format json`
- 流式输出模型文本
- 返回完整回复内容
- 自动记住会话，并在下次调用时继续对话

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

`invoke(cli, prompt)` 的特性：

- `cli` 目前支持 `glm` 和 `codex`
- `prompt` 为空时默认使用 `你好`
- 返回 `Promise<string>`，结果为完整回复文本
- 调用过程中会同步把流式文本打印到 stdout

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
- 删除 `.invoke-sessions.json` 即可重置所有会话

## 实现说明

`invoke.js` 的核心流程：

1. 根据 `cli` 选择模型名
2. 构造 `opencode run --format json --model ...` 命令
3. 如果本地已有 session，则自动追加 `--session`
4. 逐行解析 NDJSON 输出
5. 遇到 `type === "text"` 且存在 `part.text` 时，输出并收集文本
6. 进程结束后返回完整文本

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
