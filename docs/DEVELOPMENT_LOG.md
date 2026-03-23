# Open Cat Cafe 开发日志

## Phase 0：最小运行验证 ✅ 已完成

### 完成日期
2026-03-22

### 验证目标
验证 OpenCode 多模型 + MCP 回传链路可行

### 验证范围

| 功能 | 状态 |
|---|---|
| 单 agent | ✅ |
| 单 thread | ✅ |
| `opencode run` | ✅ |
| `cat_cafe_get_context` | ✅ |
| `cat_cafe_post_message` | ✅ |
| 终端事件流可见 | ✅ |

### 核心文件

验证代码位于 `lessions_demo/` 目录：

- `run-cat.js` - 运行入口，启动 opencode 子进程并解析 NDJSON 输出
- `cat-cafe-mcp.js` - MCP Server，提供 `cat_cafe_get_context` 和 `cat_cafe_post_message` 工具
- `callback-server.js` - 回调服务端，接收公开消息并提供上下文

### 关键设计决策

1. **统一 CLI**：所有 agent 通过 `opencode run` 启动，不维护多 CLI 适配层
2. **动态 MCP 挂载**：使用 `OPENCODE_CONFIG_CONTENT` 临时注入 MCP 配置
3. **公开/内部输出分离**：
   - 内部输出：OpenCode 事件流（text, reasoning, tool_use）
   - 公开输出：`cat_cafe_post_message` 回调

### 模型角色映射

| 角色 | 模型 | 职责 |
|---|---|---|
| 开发猫 | `codex_service/gpt-5.4` | 复杂实现、方案主导、任务拆解 |
| 审查猫 | `bailian-coding-plan/glm-5` | review、风险检查、测试建议 |
| 创意猫 | 火山 `glm-4.7` | UI/交互/创意方向、文案 |

### 验收结果

- ✅ 可以指定模型启动
- ✅ 可以成功获取上下文
- ✅ 可以成功把最终结果发回聊天室

---

## Phase 1：最小多 Agent 协作内核 ✅ 完成

### 目标
做出"像 Cat Café"的最小版本

### 范围

| 功能 | 状态 |
|---|---|
| 3 个 agent 配置 | ✅ 完成 |
| `@agent` 召唤 | ✅ 完成 |
| 按需启动 invocation | ✅ 完成 |
| worklist 串行 A2A | ✅ 完成 |
| 最大深度限制 | ✅ 完成 |
| 统一 prompt builder | ✅ 完成 |
| 基础元规则 | ✅ 完成 |
| 基础 thread 存储 | ✅ 完成 |
| 超时/取消/日志 | ✅ 完成 |

### 验收标准

1. 用户可以召唤任意 agent
2. agent 可以主动调用 `get_context` 和 `post_message`
3. agent 可以 `@` 另一位 agent
4. A2A 链不会并发失控
5. 用户可以 stop 当前链路

### 架构设计

```
入口层
├── 用户消息输入
├── @agent 识别
└── thread 管理

调度层
├── Agent Registry
├── Router
├── Worklist Engine
└── Invocation Tracker

运行层
└── OpenCodeAgentRunner
    ├── 启动 opencode run --format json
    └── stdout/stderr/NDJSON 解析

上下文与回传层
├── Callback Server
├── MCP Server
├── get_context
└── post_message

治理层
├── Meta Rules
├── Prompt Templates
└── A2A Policy

存储层
├── thread messages
├── invocation records
└── public messages
```

### 目录结构规划

```
src/
├── config/
│   └── agents.ts          # Agent 配置定义
├── runner/
│   └── OpenCodeAgentRunner.ts  # Agent 运行器
├── mcp/
│   └── cat-cafe-mcp.ts    # MCP Server
├── server/
│   └── CallbackServer.ts  # 回调服务
├── router/
│   ├── Router.ts          # 路由与 @agent 检测
│   └── WorklistEngine.ts  # A2A 工作队列
├── prompt/
│   └── PromptBuilder.ts   # Prompt 构建器
├── store/
│   └── ThreadStore.ts     # Thread 存储
├── types/
│   └── index.ts           # 类型定义
└── index.ts               # 入口
```

---

## 开发记录

### 2026-03-22 Phase 1 核心模块开发完成

**已完成：**
- Phase 0 验收确认
- 开发日志创建
- Phase 1 架构规划
- 项目初始化（package.json, tsconfig.json）
- 类型定义（src/types/index.ts）
- Agent 配置（src/config/agents.ts）
- Thread 存储（src/store/ThreadStore.ts）
- Prompt 构建器（src/prompt/PromptBuilder.ts）
- Agent 运行器（src/runner/OpenCodeAgentRunner.ts）
- 回调服务（src/server/CallbackServer.ts）
- 路由器（src/router/Router.ts）
- MCP Server（src/mcp/cat-cafe-mcp.ts）
- 主入口（src/index.ts）

**代码结构：**
```
src/
├── types/index.ts         # 类型定义
├── config/agents.ts       # Agent 配置（developer, reviewer, creative）
├── store/ThreadStore.ts   # Thread 持久化存储
├── prompt/PromptBuilder.ts # Prompt 构建器（含元规则）
├── runner/OpenCodeAgentRunner.ts # opencode 子进程管理
├── server/CallbackServer.ts # HTTP 回调服务
├── router/Router.ts       # @agent 解析 + Worklist 引擎
├── mcp/cat-cafe-mcp.ts    # MCP 工具（get_context, post_message）
└── index.ts               # 主入口 + CatCafe 类
```

**类型检查：** ✅ 通过

**集成测试：** ✅ 通过 (11/11)

**端到端测试：** ✅ 通过

**测试覆盖：**
- ThreadStore 持久化 (创建、消息添加)
- Router 功能 (@agent 解析、中文别名)
- A2A 触发提取
- Worklist Engine (创建、深度限制)
- Prompt Builder (生成、上下文包含)
- MCP 工具调用 (get_context, post_message)

**已发现问题：**
1. opencode 会给 MCP 工具名添加前缀 (如 `cat-cafe_cat_cafe_get_context`)
   - 解决：在 Runner 中处理前缀去除
2. 模型响应时间可能较长，需要合理设置超时
   - 默认超时：空闲 10 分钟，硬超时 30 分钟

**运行验证：**
```bash
# 快速验证
node test-quick.js

# 完整模块测试
npm test

# 实际运行
npm start
```

### 2026-03-22 Phase 1 开发启动

**已完成：**
- Phase 0 验收确认
- 开发日志创建
- Phase 1 架构规划

**进行中：**
- 项目初始化
- 核心模块实现

---

## 风险跟踪

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 工具调用遵循度不稳定 | 中 | 在 prompt 中强化工具调用要求 |
| A2A 格式漂移 | 中 | 使用明确格式规范，增加解析容错 |
| 上下文污染 | 高 | 严格 thread/session 隔离设计 |
| 并发复杂度提前引入 | 高 | 首版强制串行 worklist |