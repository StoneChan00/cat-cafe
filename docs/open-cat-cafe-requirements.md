# Open Cat Cafe 需求设计文档

## 文档目的

- 定义一个基于 `OpenCode CLI` 的多 Agent 协作系统需求与阶段路线。
- 系统采用“统一运行时 + 按需启动多个 agent invocation”的模式，而不是多 CLI 并存。
- 目标不是一次完成全部能力，而是先做最小可运行闭环，再逐步补齐工程化、上下文治理、知识管理和体验层能力。

## 参考来源

- `D:\projects\cat-cafe-tutorials\docs\lessons\01-sdk-to-cli.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\02-cli-engineering.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\03-meta-rules.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\04-a2a-routing.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\05-mcp-callback.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\06-vanished-28-seconds.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\08-session-management.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\09-context-engineering.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\10-knowledge-management.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\11-voice-pipeline.md`
- `D:\projects\cat-cafe-tutorials\docs\lessons\DEMO.md`

## 一、项目定位

- 这是一个多 Agent 协作系统，而不是单一聊天机器人。
- 用户在一个统一界面中与多个角色化 Agent 协作，而不是在多个工具间切换。
- 首期目标不是做“陪伴型完整平台”，而是先做“可工作的多 Agent 协作内核”。
- 设计原则来自课程主线：
  - 第 1-5 课提供最小协作闭环
  - 第 6-10 课提供工程化护栏
  - 第 11 课以后属于体验增强层

## 二、总体愿景

- 用户可以在一个 thread 中：
  - 指定某个 agent 开始任务
  - 让 agent 主动读取上下文
  - 让 agent 主动公开回传结果
  - 让 agent 在必要时 `@` 另一个 agent 接手
- 系统对用户表现为“多个角色化协作者”。
- 系统对底层实现表现为“统一 OpenCode runtime + 多次按需 invocation”。

## 三、核心设计决策

- **统一 CLI**
  - 所有 agent 一律通过 `opencode run` 启动。
  - 不再为不同模型维护不同官方 CLI 适配层。
- **按需 invocation**
  - 不常驻 3 个 CLI。
  - 只在当前需要某个 agent 时启动一次 `opencode run`。
  - A2A 路由本质上是下一次 invocation 的调度，而不是长驻并行人格。
- **动态 MCP 挂载**
  - 使用 `OPENCODE_CONFIG_CONTENT` 在每次 invocation 中临时注入 MCP 配置。
  - 参考当前 demo：`run-cat.js`。
- **单执行路径**
  - 所有 A2A 最终都只进入一个 worklist。
  - 不允许“文本触发一条路、回调触发另一条路然后并发执行”。
- **公开输出与内部输出分离**
  - 内部过程：OpenCode 事件流。
  - 公开发言：`cat_cafe_post_message`。
  - 上下文获取：`cat_cafe_get_context`。
- **先约束再扩展**
  - 首版优先保证：调用稳定、路由稳定、数据不乱、上下文不串。
  - Rich Blocks、语音、PWA、私聊都放后续阶段。

## 四、模型角色映射

- `gpt-5.4` 主开发/主架构
  - 模型：`codex_service/gpt-5.4`
  - 替代原教程中的 `Claude Opus 4.6`
  - 任务：复杂实现、方案主导、任务拆解、跨文件修改
- `glm-5` 审查/测试/安全
  - 模型：`bailian-coding-plan/glm-5`
  - 替代原教程中的 `Codex`
  - 任务：review、风险检查、测试建议、验收复核
- `glm-4.7` 创意/体验/补充分析
  - 模型：OpenCode 配置中的火山 `glm-4.7`
  - 替代原教程中的 `Gemini`
  - 任务：UI/交互/创意方向、文案、体验补充

说明：

- 角色绑定的是“职责”，不是“模型本体”。
- 后续如果模型切换，角色定义不变，只换 model id。

## 五、系统边界

- **首期必须支持**
  - 单 thread 对话
  - 多 agent 配置
  - 按需启动 invocation
  - MCP 回传
  - A2A worklist 串行路由
  - 元规则注入
  - 基础日志/状态/超时/取消
- **首期明确不做**
  - 富文本消息系统
  - 语音输入输出
  - PWA
  - 私聊/whisper
  - 长期知识中心
  - 自动 PR / GitHub 云端闭环
- **后续再做**
  - Session Chain
  - Context engineering 守门器
  - Knowledge hub
  - Rich Blocks
  - Voice pipeline

## 六、总体架构

- **入口层**
  - 用户消息输入
  - `@agent` 识别
  - thread 管理
- **调度层**
  - Agent registry
  - Router
  - Worklist engine
  - Invocation tracker
- **运行层**
  - `OpenCodeAgentRunner`
  - 负责启动 `opencode run --format json --model ...`
  - 负责 stdout/stderr/NDJSON 解析
- **上下文与回传层**
  - Callback server
  - MCP server
  - `get_context`
  - `post_message`
- **治理层**
  - Meta rules
  - Prompt templates
  - Review gate
  - A2A policy
- **存储层**
  - thread messages
  - invocation records
  - public messages
  - session metadata
  - route state

## 七、关键模块需求

- **Agent Registry**
  - 定义系统中的 agent 集合
  - 每个 agent 至少包含：
    - `id`
    - `name`
    - `model`
    - `role`
    - `systemPrompt`
    - `toolsPolicy`
    - `a2aPolicy`
- **OpenCodeAgentRunner**
  - 输入：
    - prompt
    - model
    - working directory
    - thread context
    - callback env
  - 输出：
    - 事件流
    - tool use 记录
    - 最终文本
    - 错误/超时状态
  - 约束：
    - stdout/stderr 都算活跃信号
    - 支持取消
    - 支持超时
- **Worklist Engine**
  - 用户消息先生成 worklist
  - 每个 invocation 完成后可追加新的 agent
  - 串行执行
  - 最大深度限制
  - 共享 abort/cancel
- **Callback Server**
  - 负责公开输出接收与 thread context 提供
  - 首版只需：
    - `POST /api/callbacks/post-message`
    - `GET /api/callbacks/thread-context`
- **MCP Server**
  - 首版只提供两个工具：
    - `cat_cafe_get_context`
    - `cat_cafe_post_message`
- **Prompt Builder**
  - 生成每个 agent 的完整 prompt
  - 包含：
    - 身份
    - 当前任务
    - 元规则
    - 工具规则
    - A2A 规则
- **Thread Store**
  - 保存：
    - 原始用户消息
    - 公开消息
    - invocation 状态
    - 调度链路
  - 首版可采用轻量文件或本地数据库
  - 但必须支持 thread 隔离

## 八、关键运行流程

- **流程 A：单 agent 执行**
  - 用户输入 `@开发猫 实现 X`
  - Router 识别目标 agent
  - Runner 生成 prompt
  - 通过 `OPENCODE_CONFIG_CONTENT` 动态挂 MCP
  - 启动 `opencode run`
  - agent 先调 `cat_cafe_get_context`
  - agent 完成后调用 `cat_cafe_post_message`
  - 系统记录 invocation 与公开消息

- **流程 B：A2A 接力**
  - 开发猫完成后在公开消息中触发 `@reviewer`
  - Router 不直接并发拉起 reviewer
  - Router 只 enqueue 到 worklist
  - 当前 invocation 结束后，worklist 拉起 reviewer invocation
  - reviewer 完成后可继续 `@开发猫`
  - 直到无人再接力或达到深度上限

- **流程 C：取消**
  - 用户点 stop
  - 调度器终止当前 invocation
  - worklist 停止继续调度
  - thread 状态恢复可编辑

## 九、元规则需求

参考第 3 课与第 9 课，首版至少需要以下规则：

- **交接五件套**
  - What
  - Why
  - Tradeoff
  - Open Questions
  - Next Action
- **Review 规则**
  - 禁止只说“looks good”
  - 发现问题必须分级
  - P1/P2 阻断放行
- **不确定先问**
  - 缺前提时不得硬猜
- **工具使用规则**
  - 需要上下文时先调 `cat_cafe_get_context`
  - 公开结果必须用 `cat_cafe_post_message`
  - 不要把思考过程公开发到聊天室
- **A2A 规则**
  - 只有确实需要接力时才 `@` 下一只 agent
  - `@` 必须明确目标和预期动作
- **结束规则**
  - 如果任务到自己结束，不要无意义继续 `@`

## 十、上下文工程需求

参考 `D:\projects\cat-cafe-tutorials\docs\lessons\09-context-engineering.md`，首版不追求复杂体系，但必须先做最小版本：

- **Layer 0：描述即路由信号**
  - 每个 agent 的说明必须能帮助系统和用户理解“何时找它”
- **Layer 1：信息分层**
  - prompt 中只注入必要上下文
  - 不把所有历史一口气塞入
- **Layer 2：愿景守护简化版**
  - 对需要 review 的任务，必须附带原始目标摘要
  - reviewer 不能只看代码差异，要看“用户原始意图”
- **首版暂不做**
  - 冷启动 verifier agent
  - 任务派发中心 Mission Hub

## 十一、会话与上下文隔离需求

参考 `D:\projects\cat-cafe-tutorials\docs\lessons\08-session-management.md`：

- 所有 session/invocation/thread 相关状态必须显式绑定 `threadId`
- 不允许任何默认“按用户+agent 复用”而缺少 thread 维度
- 首版可以不做完整 Session Chain
- 但必须为后续 Session Chain 预留数据结构：
  - invocation transcript
  - session metadata
  - thread → multiple sessions mapping

## 十二、可靠性与安全需求

参考 `D:\projects\cat-cafe-tutorials\docs\lessons\02-cli-engineering.md` 和 `D:\projects\cat-cafe-tutorials\docs\lessons\06-vanished-28-seconds.md`：

- stdout/stderr 都是活跃信号
- 必须有超时控制
- 必须有用户取消能力
- 必须有 thread 级状态追踪
- 必须有环境隔离
- 必须避免 AI 直接误碰真实危险资源
- 首版必须有最小可恢复能力：
  - invocation 日志
  - thread 数据导出
  - callback 请求日志
- 任何“依赖 agent 自觉不要乱来”的地方都不算有效设计

## 十三、知识管理需求

参考 `D:\projects\cat-cafe-tutorials\docs\lessons\10-knowledge-management.md`：

首版先做最小化版本，不一次引入完整知识体系。

- **Phase 1**
  - 一个精简 backlog
  - 一个设计文档目录
  - 一份 feature 索引
- **Phase 2**
  - 每个 feature 一个聚合文档
  - 原始文档加 frontmatter
- **Phase 3**
  - 归档策略
  - lesson learned 模板
  - 可检索知识索引

原则：

- 文档不是越多越好
- 必须可查、可归档、可聚合
- 不要让 agent 随意散落无 schema markdown

## 十四、分阶段实施路线

### Phase 0：最小运行验证

目标：验证 OpenCode 多模型 + MCP 回传链路可行

范围：

- 单 agent
- 单 thread
- `opencode run`
- `cat_cafe_get_context`
- `cat_cafe_post_message`
- 终端事件流可见

验收：

- 可以指定模型启动
- 可以成功获取上下文
- 可以成功把最终结果发回聊天室

不做：

- 多 agent
- A2A
- thread 管理 UI

### Phase 1：最小多 Agent 协作内核

目标：做出“像 Cat Café”的最小版本

范围：

- 3 个 agent 配置
- `@agent` 召唤
- 按需启动 invocation
- worklist 串行 A2A
- 最大深度限制
- 统一 prompt builder
- 基础元规则
- 基础 thread 存储
- 超时/取消/日志

验收：

- 用户可以召唤任意 agent
- agent 可以主动调用 `get_context` 和 `post_message`
- agent 可以 `@` 另一位 agent
- A2A 链不会并发失控
- 用户可以 stop 当前链路

这是建议的第一个真正交付版本。

### Phase 2：工程化护栏与上下文治理

目标：让系统从“能演示”变成“能持续开发”

范围：

- thread/session 严格隔离
- invocation transcript 持久化
- review 原始目标摘要注入
- 轻量知识索引
- feature 聚合文档
- 安全操作护栏
- 更强状态监控

验收：

- 不会串 thread
- review 能对齐原始需求
- 能追溯一条 invocation 的上下文和结果
- 文档与 feature 状态可聚合查询

### Phase 3：Session Chain 与按需历史检索

目标：处理长链路任务与上下文耗尽

范围：

- session sealing
- transcript archive
- session search/read 工具
- 新 session bootstrap
- 按需历史拉取

验收：

- 长任务不会因上下文满而完全失忆
- session 不需要濒死写遗书
- 新 session 能基于旧记录继续工作

### Phase 4：体验层增强

目标：从协作内核升级到更完整的平台体验

范围：

- Rich Blocks
- 更强状态栏
- 配置面板
- 多项目切换
- skills/commands
- whisper/private visibility

验收：

- 用户能看见更结构化的输出
- 多项目配置切换可用
- 不同 agent 能加载不同能力集

### Phase 5：陪伴与多模态

目标：进入课程后半段“Cats & U”路线

范围：

- PWA
- ASR
- TTS
- voice identity
- auto play / mobile polish

验收：

- 可语音输入输出
- 每个 agent 有稳定声线
- 手机端体验可用

## 十五、首版 MVP 明确范围

建议真正开始实现时，把 MVP 锁定为下面这些：

- 单界面 thread
- 三个 agent
- 统一 OpenCode runner
- 动态 MCP 挂载
- `get_context` / `post_message`
- 串行 A2A worklist
- 元规则最小集
- stop/cancel
- invocation logging
- thread isolation

凡是不在这张清单里的，都不进入首版。

## 十六、主要风险

- **工具调用遵循度不稳定**
  - 不同模型不一定稳定按 prompt 调工具
- **A2A 格式漂移**
  - 不同 agent 输出风格不同，`@` 解析容易出偏差
- **上下文污染**
  - 如果 thread/session 键设计不严，会重演第 8 课问题
- **并发复杂度提前引入**
  - 如果首版就追求多 agent 并行，会很快复刻第 4 课事故
- **文档失控**
  - 如果没有 schema 和聚合入口，后续知识会很快散乱
- **把体验功能过早拉进来**
  - 语音、富文本、PWA 都会显著拖慢核心闭环落地

## 十七、成功标准

首版成功，不是看“功能数量”，而是看这 6 件事是否同时成立：

- 用户能在一个 thread 中召唤任意 agent
- agent 能按需读取上下文
- agent 能通过公开通道发消息
- agent 能触发另一个 agent 接力
- 调度链可取消、不会失控
- thread 上下文与 invocation 状态可追踪

如果这 6 条成立，就说明内核完成了。

## 十八、建议的项目原则

- 先做协作内核，不做平台外观
- 先做串行路由，不做并行炫技
- 先做上下文与状态隔离，不做长期记忆幻觉
- 先做最小知识结构，不做 markdown 大爆炸
- 先做清晰的角色职责，不做模型神话

## 结论

- 这套系统最适合的建设方式，不是“一口气复刻完整教程”，而是：
  - 用 `OpenCode CLI` 先收敛运行时
  - 用按需 invocation 建立最小协作闭环
  - 用课程 1-10 课提炼出的护栏，逐步补上工程化能力
  - 把课程 7、11 那类体验增强放到后期
