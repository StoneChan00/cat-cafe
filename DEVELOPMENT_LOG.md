# 开发日志

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
