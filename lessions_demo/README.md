# cat-cafe

一个最小的 MCP 回传演示项目，用来理解“AI 内部输出”和“AI 主动公开发言”之间的区别。

当前版本基于 `opencode` 运行，核心演示链路是：

- `run-cat.js` 启动 `opencode run --format json`
- `opencode` 在本次会话里加载本地 MCP 服务 `cat-cafe-mcp.js`
- MCP 工具再回调 `callback-server.js`
- 终端 2 显示内部过程，终端 1 只显示 AI 主动发送的公开内容

## 当前文件结构

```text
.
├─ callback-server.js   # 回调服务端，模拟聊天室
├─ cat-cafe-mcp.js      # 本地 MCP Server，提供两个工具
├─ run-cat.js           # 用 opencode 跑任务并打印内部输出
├─ DEVELOPMENT_LOG.md   # 当前开发日志
├─ his/                 # 已归档的历史脚本和旧日志
├─ package.json
└─ package-lock.json
```

## 核心机制

这个 demo 主要展示两条不同的输出通道：

### 1. 内部输出

`run-cat.js` 会解析 `opencode run --format json` 的 NDJSON 事件，并把这些内容直接打印到当前终端。

这里能看到的通常包括：

- 文本输出 `text`
- 推理片段 `reasoning`
- 工具调用 `tool_use`
- 步骤开始/结束 `step_start`、`step_finish`

这部分相当于“AI 在工作时的内部过程”。

### 2. 主动公开发言

AI 如果决定调用 `cat_cafe_post_message`，`cat-cafe-mcp.js` 会发 HTTP 请求到 `callback-server.js`：

- `POST /api/callbacks/post-message`

服务端验证 `invocationId` 和 `callbackToken` 后，会把消息打印到另一个终端，模拟“消息发到了聊天室”。

这部分相当于“AI 选择公开给用户看的内容”。

## 依赖

运行前需要本机具备：

- `node`
- `opencode`

并且当前 `opencode` 所使用的模型/provider 在你的环境里可正常调用。

项目依赖：

- `@modelcontextprotocol/sdk`
- `zod`

如果依赖还没装，可以运行：

```bash
npm install
```

## 三个核心文件

### `callback-server.js`

原生 `http` 服务器，监听 `3200` 端口。

提供两个接口：

- `POST /api/callbacks/post-message`
- `GET /api/callbacks/thread-context`

启动时会生成：

- `invocationId`
- `callbackToken`

并打印到终端，用于本次调用链鉴权。

### `cat-cafe-mcp.js`

最小 MCP Server，提供两个工具：

- `cat_cafe_post_message(content)`
- `cat_cafe_get_context()`

它会从环境变量中读取：

- `CAT_CAFE_API_URL`
- `CAT_CAFE_INVOCATION_ID`
- `CAT_CAFE_CALLBACK_TOKEN`

然后通过 HTTP 与 `callback-server.js` 通信。

### `run-cat.js`

运行入口，负责：

- 调用 `opencode run --format json --model ...`
- 通过 `OPENCODE_CONFIG_CONTENT` 为这次子进程临时注入 MCP 配置
- 加载本地 `cat-cafe-mcp.js`
- 解析 `opencode` 的 NDJSON 输出并打印到当前终端

默认模型是：

```text
bailian-coding-plan/glm-5
```

也可以通过环境变量覆盖：

```powershell
$env:CAT_CAFE_MODEL = "codex_service/gpt-5.4"
```

## 运行方式

### PowerShell

终端 1：启动回调服务端

```powershell
node .\callback-server.js
```

你会看到类似：

```text
Server listening on :3200
invocationId: xxx
callbackToken: yyy
```

终端 2：设置环境变量并启动 runner

```powershell
$env:CAT_CAFE_API_URL = "http://localhost:3200"
$env:CAT_CAFE_INVOCATION_ID = "xxx"
$env:CAT_CAFE_CALLBACK_TOKEN = "yyy"
node .\run-cat.js
```

如果要切模型：

```powershell
$env:CAT_CAFE_API_URL = "http://localhost:3200"
$env:CAT_CAFE_INVOCATION_ID = "xxx"
$env:CAT_CAFE_CALLBACK_TOKEN = "yyy"
$env:CAT_CAFE_MODEL = "codex_service/gpt-5.4"
node .\run-cat.js
```

### npm scripts

```bash
npm run start:callback
npm run start:cat
```

注意：`npm run start:cat` 仍然依赖你先在当前 shell 中设置好回调相关环境变量。

## 默认提示词

如果不传命令行参数，`run-cat.js` 会使用一段默认提示词，让模型：

1. 先调用 `cat_cafe_get_context`
2. 写一首关于猫的诗
3. 再调用 `cat_cafe_post_message` 把最终诗句发到聊天室
4. 不把思考过程发出去

你也可以直接传自己的 prompt：

```powershell
node .\run-cat.js "先获取上下文，再写一句猫咖开场白，最后发到聊天室"
```

注意：默认 prompt 会引导模型调用工具，但并不保证每次都真的触发 `cat_cafe_get_context` 和 `cat_cafe_post_message`。如果你看到客户端只是在终端里直接输出结果、服务端却没有出现 `[chatroom] received public message:`，通常说明这次模型没有实际调用 MCP 工具。

做演示或验收时，建议使用更强约束的 prompt，明确要求：

1. 必须先调用 `cat_cafe_get_context`
2. 必须最后调用 `cat_cafe_post_message`
3. 如果不调用工具，就算任务失败

例如：

```powershell
node .\run-cat.js "你必须严格按以下步骤执行：1）先调用 cat_cafe_get_context；2）根据上下文写一首关于猫的短诗；3）最后必须调用 cat_cafe_post_message 把最终诗发送到聊天室；4）如果不调用工具，这个任务就算失败。不要只在终端输出答案，必须调用工具。"
```

## 预期结果

成功时你会看到：

- 终端 2：`opencode` 的内部过程、推理、工具调用
- 终端 1：只有最终通过 `cat_cafe_post_message` 发回来的公开内容

这就是这个项目想说明的重点：

- 子进程终端里看到的是“AI 全部过程”
- 回调服务里看到的是“AI 主动选择公开的内容”

## 故障排查

### 1. `opencode` 找不到

如果运行 `node .\run-cat.js` 时提示找不到 `opencode`，先在当前终端确认：

```powershell
opencode --version
```

如果这条命令本身都不能执行，说明问题不在项目，而在本机环境变量或 `opencode` 安装。

### 2. 回调服务没有启动

如果 `run-cat.js` 启动后工具调用失败，先确认终端 1 的 `callback-server.js` 还在运行，并且确实打印了：

- `invocationId`
- `callbackToken`

如果终端 1 已关闭，终端 2 里的 MCP 工具就无法成功回调。

### 3. 环境变量没有设置到当前 PowerShell 会话

PowerShell 的环境变量只对当前会话生效。请确认你是在运行 `node .\run-cat.js` 的同一个终端里设置的：

```powershell
$env:CAT_CAFE_API_URL = "http://localhost:3200"
$env:CAT_CAFE_INVOCATION_ID = "xxx"
$env:CAT_CAFE_CALLBACK_TOKEN = "yyy"
```

可以直接检查：

```powershell
echo $env:CAT_CAFE_API_URL
echo $env:CAT_CAFE_INVOCATION_ID
echo $env:CAT_CAFE_CALLBACK_TOKEN
```

### 4. 模型不可用或 provider 配置不对

`run-cat.js` 默认用的是：

```text
bailian-coding-plan/glm-5
```

如果你本机 `opencode` 当前没有这个 provider/model 的可用配置，任务会在 `opencode` 层失败。你可以先单独验证：

```powershell
opencode run --format json --model bailian-coding-plan/glm-5 "你好"
```

如果这一步都失败，先修本机 `opencode` 配置，再回到这个 demo。

### 5. MCP 工具没有被调用

如果终端 2 只有普通文本输出，但终端 1 没收到任何消息，说明模型可能没有真的调用：

- `cat_cafe_get_context`
- `cat_cafe_post_message`

先看终端 2 里是否出现：

- `[tool_use] cat_cafe_get_context`
- `[tool_use] cat_cafe_post_message`

如果没有，通常是模型没有遵循提示词，或者当前模型工具调用能力不足。你可以把 prompt 写得更明确一些。

### 6. MCP 服务启动失败

如果 `cat-cafe-mcp.js` 依赖缺失，或者 SDK 无法加载，`opencode` 在工具侧会失败。先确认依赖已经安装：

```powershell
npm install
npm run check
```

如果 `npm run check` 正常，但运行时仍失败，重点看终端 2 的 stderr 输出。

### 7. 回调鉴权失败（401）

如果回调服务返回 `401 unauthorized`，说明：

- `CAT_CAFE_INVOCATION_ID` 不匹配
- `CAT_CAFE_CALLBACK_TOKEN` 不匹配

最常见原因是：你重启了 `callback-server.js`，但终端 2 还在用旧值。重启服务后，要重新复制一遍新的 `invocationId` 和 `callbackToken`。

### 8. 想确认现在到底走的是哪个模型

默认模型来自 `run-cat.js`：

```text
bailian-coding-plan/glm-5
```

如果你设置了：

```powershell
$env:CAT_CAFE_MODEL = "codex_service/gpt-5.4"
```

那本次运行会覆盖默认值。

### 9. 如何判断 demo 是否真正成功

最小成功标准是同时满足：

1. 终端 2 出现 `opencode` 的内部事件输出
2. 终端 2 出现 `cat_cafe_post_message` 的工具调用记录
3. 终端 1 打印出最终公开内容

如果只有第 1 条成立，那说明模型在运行，但“主动发言”这条链路还没打通。

## 历史文件

旧版本里与 `invoke.js`、`minimal-glm.js`、`minimal-codex.js` 相关的封装已经移到 `his/`，不再参与当前 MCP demo 的运行。

## 校验命令

```bash
node --check callback-server.js
node --check cat-cafe-mcp.js
node --check run-cat.js
```
