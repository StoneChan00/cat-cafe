# RFC 001: OpenCode 多 Agent 协作系统

**状态**: 草稿  
**作者**: Cat Café Team  
**创建日期**: 2026-03-22  
**最后更新**: 2026-03-22  

## 相关文档

- [需求设计文档](../open-cat-cafe-requirements.md)
- [参考教程: cat-cafe-tutorials](D:\projects\cat-cafe-tutorials)

---

## 1. 摘要

本文档描述了一个基于统一 OpenCode CLI 的多 Agent 协作系统架构，采用"按需启动多个 agent invocation"模式替代传统的多 CLI 方案，通过分阶段实施实现从最小协作内核到完整平台体验的演进。

---

## 2. 背景与动机

### 2.1 当前问题

**问题 1: 多 CLI 方案的工程债务**

原 Cat Café 系统使用三个不同的官方 CLI（Claude Code、Codex CLI、Gemini CLI），导致：
- 三套事件解析逻辑
- 三套 MCP 挂载方式
- 三套超时/取消处理
- 调试困难，问题定位成本高

参考: `D:\projects\cat-cafe-tutorials\docs\lessons\01-sdk-to-cli.md`

**问题 2: 并发路由的灾难**

第 4 课中，两条独立的 A2A 执行路径（worklist 路径和 callback 路径）叠加，导致：
- 两只猫同时执行
- 无限乒乓调用
- Stop 按钮失效
- 最终强制重启服务器

参考: `D:\projects\cat-cafe-tutorials\docs\lessons\04-a2a-routing.md`

**问题 3: Session 跨 Thread 污染**

第 8 课中，session key 缺少 `threadId` 维度，导致：
- Thread A 的 session 在 Thread B 被复用
- 猫"灵魂夺舍"，说出与当前对话无关的内容
- 两行代码修复，但前期难以发现

参考: `D:\projects\cat-cafe-tutorials\docs\lessons\08-session-management.md`

### 2.2 为什么现在做

- OpenCode CLI 支持多 provider 和 model 切换
- 统一的事件格式（NDJSON）简化解析
- `OPENCODE_CONFIG_CONTENT` 支持动态 MCP 挂载
- 国内环境下 OpenCode 的可用性优于官方 Claude Code

---

## 3. 目标与非目标

### 3.1 目标（Must Have）

| 优先级 | 目标 | 对应课程 |
|--------|------|----------|
| P0 | 统一 OpenCode CLI 运行时 | L1-L2 |
| P0 | 按需启动 agent invocation | L1-L5 |
| P0 | 串行 A2A worklist 路由 | L4-L5 |
| P0 | MCP 回传机制 | L5 |
| P0 | Thread 级上下文隔离 | L8 |
| P1 | 基础元规则与 review 流程 | L3, L9 |
| P1 | Invocation 日志与可观测性 | L2, L6 |
| P2 | Session Chain 与历史检索 | L8 |
| P2 | 知识管理基础结构 | L10 |
| P3 | 富文本与体验层 | L7, L11 |

### 3.2 非目标（Won't Have）

**首期明确不做：**

1. **富文本消息系统（Rich Blocks）**
   - 原因: 依赖前端组件系统，拖慢核心闭环
   - 计划: Phase 4 引入

2. **语音输入输出**
   - 原因: 需要 ASR/TTS 模型部署，复杂度极高（第11课经历9次失败）
   - 计划: Phase 5 引入

3. **PWA 与移动端**
   - 原因: 首版专注桌面端协作内核
   - 计划: Phase 5 引入

4. **私聊/Whisper 系统**
   - 原因: 消息可见性控制增加复杂度，首期用公开频道足够
   - 计划: Phase 4 引入

5. **自动 PR/GitHub 闭环**
   - 原因: 需要云端服务集成，超出首版范围
   - 计划: Phase 3+ 评估

6. **多 agent 并行执行**
   - 原因: 避免复刻第4课并发事故，首期只支持串行
   - 计划: 长期可能考虑，但需充分验证

---

## 4. 方案详情

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Thread 列表   │  │ 消息输入框    │  │ Agent 状态栏     │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        调度层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Router       │  │ Worklist     │  │ Invocation      │   │
│  │ - 识别@agent  │  │ Engine       │  │ Tracker         │   │
│  │ - 生成prompt │  │ - 串行队列   │  │ - 状态监控      │   │
│  └──────────────┘  │ - 深度限制   │  └─────────────────┘   │
│                    │ - 取消传播   │                        │
│                    └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        运行时层                              │
│              OpenCodeAgentRunner                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  spawn('opencode', ['run', '--format', 'json', ...]) │  │
│  │  - stdout/stderr 双通道监听                          │  │
│  │  - OPENCODE_CONFIG_CONTENT 动态 MCP 挂载             │  │
│  │  - NDJSON 事件解析                                   │  │
│  │  - 超时/取消处理                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        MCP 层                               │
│  ┌──────────────────┐      ┌──────────────────────────┐   │
│  │ cat-cafe-mcp     │      │ Callback Server          │   │
│  │ - get_context    │◄────►│ - POST /post-message     │   │
│  │ - post_message   │      │ - GET  /thread-context   │   │
│  └──────────────────┘      └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        存储层                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Thread Store │  │ Invocation   │  │ Public Message  │   │
│  │ - 消息历史   │  │ Log          │  │ Store           │   │
│  │ - 元数据     │  │ - 完整记录   │  │ - 公开输出       │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 关键设计决策

#### 决策 1: 统一 CLI vs 多 CLI

**选项 A: 保留多 CLI 方案**
- 优点: 最大化利用各家原生能力，模型行为差异自然
- 缺点: 三套适配层，维护成本高，调试困难

**选项 B: 统一 OpenCode CLI**
- 优点: 单一事件格式，统一 MCP 挂载，简化调度
- 缺点: 可能错过某些 CLI 独占特性，需要更多 prompt 工程弥补模型差异

**决策**: 选择 **选项 B**

**理由**:
1. 第1课教训: SDK 到 CLI 的迁移已经证明统一运行时更可控
2. 第4课教训: 多路径并发是灾难根源，统一运行时更易保证单一路径
3. OpenCode 的 provider/model 配置足够灵活，可以通过配置切换模型
4. 工程成本显著降低，团队可以专注核心逻辑

#### 决策 2: 按需启动 vs 常驻进程

**选项 A: 三只猫常驻，长驻内存**
- 优点: 响应更快，状态保持
- 缺点: 资源浪费，session 管理复杂，容易引入并发 bug

**选项 B: 按需启动，一次一 invocation**
- 优点: 资源高效，状态隔离简单，避免第4课并发问题
- 缺点: 每次调用有启动开销，需要频繁加载上下文

**决策**: 选择 **选项 B**

**理由**:
1. 第4课教训: 常驻并行是事故温床
2. 第8课教训: session 跨 thread 污染难以根除，无状态更安全
3. 现代 CLI 启动速度足够快（秒级），启动开销可接受
4. 上下文可以通过 `get_context` 工具按需加载，不需要常驻记忆

#### 决策 3: 单路径 worklist vs 多路径并发

**选项 A: 支持并发，callback 直接触发执行**
- 优点: 更快的响应，更灵活的路由
- 缺点: 状态同步复杂，容易双触发，Stop 难实现

**选项 B: 统一 enqueue 到 worklist，串行执行**
- 优点: 状态简单，可预测，易于取消
- 缺点: 延迟增加，无法真正并行

**决策**: 选择 **选项 B**

**理由**:
1. 第4课教训: "单一路径"是修复并发事故的关键
2. 串行执行让状态管理变得简单，整个 worklist 共享一个 AbortController
3. 多猫协作场景下，串行更符合"接力"语义
4. 如果真有并行需求，可以通过启动多个独立 thread 实现，而不是在一个 thread 内并发

### 4.3 关键模块设计

#### 4.3.1 Agent Registry

```typescript
interface AgentConfig {
  id: string;                    // 唯一标识: 'architect', 'reviewer', 'creative'
  name: string;                  // 显示名称: '主开发猫', '审查猫'
  model: string;                 // OpenCode model: 'codex_service/gpt-5.4'
  role: 'architect' | 'reviewer' | 'creative';
  systemPrompt: string;          // 基础 system prompt
  toolsPolicy: ToolsPolicy;      // 可用工具与权限
  a2aPolicy: A2APolicy;          // A2A 行为规则
  contextBudget: number;         // token 预算 (默认 150k)
}

interface ToolsPolicy {
  allowed: string[];             // ['cat_cafe_get_context', 'cat_cafe_post_message']
  requireConfirmation: string[]; // 需要确认的工具
}

interface A2APolicy {
  canInitiateA2A: boolean;       // 是否可以主动 @ 其他 agent
  allowedTargets: string[];      // 可以呼叫的目标
  maxDepth: number;              // 该 agent 触发的 A2A 深度限制
}
```

#### 4.3.2 OpenCodeAgentRunner

```typescript
interface RunnerInput {
  prompt: string;
  model: string;
  workingDirectory?: string;
  threadContext: ThreadContext;
  callbackEnv: {
    CAT_CAFE_API_URL: string;
    CAT_CAFE_INVOCATION_ID: string;
    CAT_CAFE_CALLBACK_TOKEN: string;
  };
  timeoutMs?: number;            // 默认 5min，可配置
  signal?: AbortSignal;          // 取消信号
}

interface RunnerOutput {
  events: AsyncIterable<OpenCodeEvent>;
  invocationId: string;
  finalText: string;
  toolUses: ToolUseRecord[];
  status: 'completed' | 'cancelled' | 'timeout' | 'error';
}
```

**关键约束**:
- 同时监听 stdout 和 stderr（第2课教训）
- stderr 也是活跃信号，用于刷新超时计时器
- 支持通过 AbortSignal 取消

#### 4.3.3 Worklist Engine

```typescript
interface WorklistItem {
  agentId: string;
  prompt: string;
  depth: number;                 // 当前 A2A 深度
  parentInvocationId?: string;   // 用于追踪调用链
}

class WorklistEngine {
  private worklist: WorklistItem[] = [];
  private maxDepth: number = 15;  // 第4课设定的安全上限
  private signal: AbortSignal;
  
  async *execute(threadId: string): AsyncIterable<AgentMessage> {
    for (let i = 0; i < this.worklist.length && !this.signal.aborted; i++) {
      const item = this.worklist[i];
      
      if (item.depth > this.maxDepth) {
        yield { type: 'error', error: 'Max A2A depth exceeded' };
        break;
      }
      
      // 执行 agent
      const runner = new OpenCodeAgentRunner();
      const output = await runner.run(item);
      
      // 实时输出事件
      for await (const event of output.events) {
        yield event;
      }
      
      // 检测 A2A 触发
      const mentions = this.parseA2AMentions(output.finalText);
      if (mentions.length > 0) {
        for (const targetId of mentions) {
          this.worklist.push({
            agentId: targetId,
            prompt: this.buildA2APrompt(output.finalText),
            depth: item.depth + 1,
            parentInvocationId: output.invocationId
          });
        }
      }
    }
    
    yield { type: 'done', isFinal: true };
  }
}
```

#### 4.3.4 Prompt Builder

每个 agent 的完整 prompt 包含以下部分（按顺序）：

```
1. 身份定义
   "你是 {name}，负责 {role}..."

2. 元规则（第3课提炼）
   - 不确定就提问，不要硬猜
   - Review 必须铁面无私，禁止"looks good"
   - 交接必须写 Why/Tradeoff/Open Questions/Next Action

3. 工具规则
   - 开始前调用 cat_cafe_get_context 获取上下文
   - 公开结果必须调用 cat_cafe_post_message
   - 不要把思考过程发到聊天室

4. A2A 规则
   - 只有确实需要接力时才 @ 其他 agent
   - @ 必须明确目标和预期

5. 当前任务
   {user_prompt}

6. 历史上下文（按需注入）
   {thread_context_summary}
```

### 4.4 数据模型

#### 4.4.1 Thread

```typescript
interface Thread {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'archived';
  
  // 关联数据
  messages: Message[];
  invocations: Invocation[];
  worklistState?: WorklistState;  // 当前 A2A 队列状态
}
```

#### 4.4.2 Invocation

```typescript
interface Invocation {
  id: string;
  threadId: string;              // **关键**: 显式绑定 thread，防止跨 thread 污染
  agentId: string;
  model: string;
  
  // 时间线
  startedAt: Date;
  endedAt?: Date;
  
  // 状态
  status: 'running' | 'completed' | 'cancelled' | 'timeout' | 'error';
  
  // 记录
  prompt: string;
  events: OpenCodeEvent[];       // 完整 NDJSON 事件流
  toolUses: ToolUseRecord[];
  finalText?: string;
  publicMessages: string[];      // 通过 post_message 发送的消息 ID
  
  // 追踪
  parentInvocationId?: string;   // A2A 链的父节点
  depth: number;                 // A2A 深度
}
```

**关键设计**: `threadId` 必须显式存在于所有 stateful 对象的 key 中，这是第8课的核心教训。

---

## 5. 权衡与决策

### 5.1 模型选择权衡

| 模型 | 角色 | 优势 | 风险 |
|------|------|------|------|
| gpt-5.4 | 主开发 | 强推理、复杂任务 | 可能过度自信 |
| glm-5 | 审查 | 遵循规则、细致 | 创造力有限 |
| glm-4.7 | 创意 | 灵活、体验向 | 稳定性待验证 |

**决策**: 首版先用 gpt-5.4 + glm-5 两猫，glm-4.7 作为 Phase 2 引入。

**理由**: 降低变量，先跑通两猫协作，再引入第三只。

### 5.2 存储选择权衡

| 方案 | 优点 | 缺点 |
|------|------|------|
| JSON 文件 | 简单、可版本控制、易审计 | 查询慢、并发差 |
| SQLite | 结构查询、事务支持 | 需要 schema 迁移 |
| Redis | 高性能、适合实时 | 需要运维、第6课事故风险 |

**决策**: Phase 1-2 使用 JSON 文件存储，Phase 3 评估 SQLite。

**理由**: 
1. 首版数据量小，JSON 足够
2. 文件存储便于版本控制和审计（第6课教训）
3. 避免 Redis 运维风险，但保留未来切换可能

### 5.3 元规则执行方式权衡

| 方案 | 实现方式 | 优点 | 缺点 |
|------|----------|------|------|
| Prompt 注入 | 写入 system prompt | 简单、灵活 | 依赖模型遵循度 |
| 工具约束 | 通过工具 schema 限制 | 强制性强 | 限制灵活性 |
| 后置检查 | LLM 评审输出 | 可验证 | 增加延迟和成本 |

**决策**: 首版主要依赖 **Prompt 注入 + 工具约束**，关键流程（如 review）可加入后置检查。

---

## 6. 时间线与里程碑

### Phase 0: 最小运行验证（1-2 周）

**目标**: 验证 OpenCode 多模型 + MCP 回传链路可行

**交付物**:
- [ ] 可以指定模型启动 `opencode run`
- [ ] 可以成功获取上下文
- [ ] 可以成功把最终结果发回聊天室
- [ ] 终端事件流可见

**验收标准**:
```bash
node run-cat.js "测试消息"
# 期望输出:
# [tool_use] cat_cafe_get_context (completed)
# [tool_use] cat_cafe_post_message (completed)
# [done]
```

### Phase 1: 最小多 Agent 内核（3-4 周）

**目标**: 做出"像 Cat Café"的最小版本

**交付物**:
- [ ] 3 个 agent 配置
- [ ] `@agent` 召唤功能
- [ ] worklist 串行 A2A
- [ ] 基础元规则注入
- [ ] 超时/取消/日志

**验收标准**:
- 用户可以召唤任意 agent
- agent 可以互相 `@` 接力
- 调度链可取消、不会失控

### Phase 2: 工程化护栏（2-3 周）

**目标**: 从"能演示"变成"能持续开发"

**交付物**:
- [ ] thread/session 严格隔离验证
- [ ] invocation transcript 持久化
- [ ] 轻量知识索引

**验收标准**:
- 不会串 thread
- 能追溯任意 invocation 的完整上下文

### Phase 3: Session Chain（2-3 周）

**目标**: 处理长链路任务

**交付物**:
- [ ] session sealing
- [ ] transcript archive
- [ ] session search 工具

### Phase 4+: 体验层（后续规划）

**目标**: Rich Blocks、PWA、语音等

**状态**: 待详细设计

---

## 7. 风险与缓解措施

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|----------|
| 工具调用遵循度不稳定 | agent 不按 prompt 调工具，流程中断 | 高 | 1. Prompt 中明确要求必须调用<br>2. 后置检查工具调用记录<br>3. 失败时自动重试或提示用户 |
| A2A 格式漂移 | `@` 解析错误，路由失败 | 中 | 1. 严格的行首匹配规则<br>2. 规范化输出格式要求<br>3. 解析失败时 fallback 到人工确认 |
| 上下文污染 | thread 隔离不严，agent 看到错误上下文 | 高 | 1. 所有 stateful key 必须包含 threadId<br>2. 自动化测试跨 thread 场景<br>3. 运行时断言检查 |
| 并发复杂度提前引入 | 首版追求并行，导致第4课事故重演 | 中 | **明确禁止**: 首版只做串行，任何并行需求都必须经过 RFC 评审 |
| 文档失控 | agent 生成大量无结构 markdown | 中 | 1. 强制 frontmatter schema<br>2. 定期归档策略<br>3. 聚合文档机制 |

---

## 8. 成功标准

首版成功不是看"功能数量"，而是看这 6 件事是否同时成立：

- [ ] 用户能在一个 thread 中召唤任意 agent
- [ ] agent 能按需读取上下文（通过 `get_context`）
- [ ] agent 能通过公开通道发消息（通过 `post_message`）
- [ ] agent 能触发另一个 agent 接力（通过 `@`）
- [ ] 调度链可取消、不会失控（Stop 有效）
- [ ] thread 上下文与 invocation 状态可追踪（不串、不丢）

**验证方式**:
- 自动化测试覆盖上述 6 个场景
- 人工走查一个完整 A2A 链
- 代码 review 检查 threadId 绑定

---

## 9. 未解决问题

1. **Session Chain 的具体阈值**
   - context 使用率达到多少触发 sealing？
   - 不同模型是否有不同阈值？
   - 需要运行数据支撑，首版暂定 85% 预警，90% 触发

2. **知识管理的查询效率**
   - JSON 文件存储在数据量大时查询性能如何？
   - 是否需要引入 SQLite？
   - 待 Phase 2 评估

3. **多项目切换**
   - 不同项目是否需要不同的 agent 配置？
   - 配置如何隔离？
   - 待 Phase 2 详细设计

4. **云端 review 集成**
   - 是否需要接入云端 review 服务？
   - 如何与本地 agent 协作？
   - 待 Phase 3+ 评估

---

## 10. 参考原则

本 RFC 的设计原则来自 Cat Café 教程的核心教训：

1. **不要靠猫自觉，要靠系统约束**（第6课）
2. **单一路径优于多路径并发**（第4课）
3. **显式绑定优于隐式复用**（第8课）
4. **按需拉取优于一次性灌入**（第8课）
5. **不确定就提问，不要硬猜**（第3课）
6. **先做协作内核，不做平台外观**（整体路线）

---

## 11. 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-22 | 0.1 | 初始版本 | Cat Café Team |

---

## 12. 附录

### 12.1 术语表

- **Invocation**: 一次 agent 执行，对应一次 `opencode run` 调用
- **Thread**: 用户对话线程，包含消息历史和 invocation 记录
- **Worklist**: A2A 任务队列，串行执行
- **MCP**: Model Context Protocol，提供工具调用能力
- **A2A**: Agent-to-Agent，agent 之间的协作调用

### 12.2 相关 RFC（预留）

- RFC 002: Session Chain 详细设计
- RFC 003: 知识管理架构
- RFC 004: Rich Blocks 管线
- RFC 005: Voice Pipeline 设计
