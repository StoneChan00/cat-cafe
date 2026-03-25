"use strict";
/**
 * Prompt 构建器
 * 负责为每个 Agent 生成完整的 prompt
 * Phase 2 增强：支持 review 原始目标摘要注入
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptBuilder = exports.DEFAULT_META_RULES = void 0;
exports.buildPrompt = buildPrompt;
exports.buildSimplePrompt = buildSimplePrompt;
exports.buildReviewPrompt = buildReviewPrompt;
// 审查猫增强系统提示词（Phase 2）
const REVIEWER_ENHANCED_PROMPT = `## 审查猫增强规则（Phase 2）

### 原始目标对齐
审查时必须回顾用户的原始意图，不能只看代码差异：
1. 查看当前 Thread 中的第一条用户消息
2. 理解用户真正想要解决什么问题
3. 评估当前实现是否偏离原始目标

### 审查分级标准
- P1（阻断）：功能错误、安全隐患、性能灾难
- P2（重要）：代码质量、可维护性、边界情况
- P3（建议）：风格优化、命名改进、注释补充

### 强制检查项
- [ ] 是否满足原始需求？
- [ ] 是否有边界情况未处理？
- [ ] 是否有安全风险？
- [ ] 是否符合项目架构？
- [ ] 是否有适当的测试？

### 审查输出格式
\`\`\`
## 审查结果

### 原始目标回顾
<引用用户原始需求>

### 总体评价
<通过/有条件通过/不通过>

### 问题清单
- [P1] <问题描述> → <修复建议>
- [P2] <问题描述> → <修复建议>
- [P3] <问题描述> → <可选建议>

### 下一步行动
<建议 @developer 还是 @creative 接手>
\`\`\``;
exports.DEFAULT_META_RULES = [
    {
        id: 'handoff',
        name: '交接五件套',
        description: '完成任务交接或结束对话时的标准格式',
        template: `## 交接五件套
- What：做了什么
- Why：为什么这样做
- Tradeoff：做了哪些权衡
- Open Questions：还有哪些不确定
- Next Action：建议下一步做什么`
    },
    {
        id: 'uncertainty',
        name: '不确定先问',
        description: '缺少前提时不得硬猜',
        template: `## 不确定先问
如果缺少必要信息或前提条件，不要猜测。先向用户确认：
- 具体需求是什么？
- 有哪些约束条件？
- 期望的输出格式？`
    },
    {
        id: 'tool-usage',
        name: '工具使用规则',
        description: 'MCP 工具的正确使用方式',
        template: `## 工具使用规则
1. 需要上下文时，先调用 cat_cafe_get_context
2. 公开结果必须用 cat_cafe_post_message
3. 不要把思考过程公开发到聊天室
4. 内部思考是私有的，公开消息是给用户看的`
    },
    {
        id: 'a2a',
        name: 'A2A 规则',
        description: 'Agent 间协作规则',
        template: `## A2A 规则
1. 只有确实需要接力时才 @ 下一只 agent
2. @ 必须明确目标和预期动作
3. 如果任务到自己结束，不要无意义继续 @
4. 可用角色：@developer, @reviewer, @creative`
    }
];
/**
 * 构建原始目标摘要（用于 reviewer）
 * 从 Thread 中提取第一条用户消息作为原始意图
 */
function buildOriginalGoalSummary(threadContext) {
    if (!threadContext?.messages?.length) {
        return '';
    }
    // 找到第一条用户消息
    const firstUserMessage = threadContext.messages.find(m => m.role === 'user');
    if (!firstUserMessage) {
        return '';
    }
    const content = firstUserMessage.content;
    // 截断过长的内容
    const maxLength = 500;
    const summary = content.length > maxLength
        ? content.slice(0, maxLength) + '...'
        : content;
    return `## 原始目标回顾
这是用户在当前 Thread 中提出的第一个请求，代表他们的核心意图：

> ${summary}

**审查时必须对齐此目标进行评价，不能只看实现细节。**`;
}
/**
 * 构建上下文部分
 */
function buildContextSection(threadContext) {
    if (!threadContext || threadContext.messages.length === 0) {
        return '';
    }
    const publicMessages = threadContext.messages.filter(m => m.isPublic);
    if (publicMessages.length === 0) {
        return '';
    }
    const lines = ['## 当前 Thread 上下文', ''];
    for (const msg of publicMessages) {
        const role = msg.role === 'user' ? '用户' : `${msg.agentId || 'Agent'}`;
        lines.push(`**${role}**: ${msg.content}`);
        lines.push('');
    }
    if (threadContext.worklist.length > 0) {
        lines.push('### 待处理任务');
        for (const item of threadContext.worklist) {
            lines.push(`- ${item.agentId}: ${item.reason}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
/**
 * 构建元规则部分
 */
function buildMetaRulesSection(rules) {
    if (rules.length === 0) {
        return '';
    }
    const lines = ['## 元规则', ''];
    for (const rule of rules) {
        lines.push(rule.template);
        lines.push('');
    }
    return lines.join('\n');
}
/**
 * 构建任务部分
 */
function buildTaskSection(task) {
    return `## 当前任务

${task}`;
}
/**
 * 构建完整 Prompt
 */
function buildPrompt(context) {
    const parts = [];
    // 1. 系统提示词
    parts.push(context.agent.systemPrompt);
    parts.push('');
    // 2. 元规则
    const metaRulesSection = buildMetaRulesSection(context.metaRules);
    if (metaRulesSection) {
        parts.push(metaRulesSection);
    }
    // 3. Phase 2 增强：为 reviewer 注入原始目标对齐规则
    if (context.agent.id === 'reviewer') {
        parts.push(REVIEWER_ENHANCED_PROMPT);
        // 注入原始目标摘要
        const goalSummary = buildOriginalGoalSummary(context.threadContext);
        if (goalSummary) {
            parts.push('');
            parts.push(goalSummary);
        }
    }
    // 4. 上下文
    const contextSection = buildContextSection(context.threadContext);
    if (contextSection) {
        parts.push(contextSection);
    }
    // 5. 当前任务
    parts.push(buildTaskSection(context.task));
    return parts.join('\n');
}
/**
 * 构建简单 Prompt（无上下文）
 */
function buildSimplePrompt(agent, task) {
    return buildPrompt({
        agent,
        task,
        metaRules: exports.DEFAULT_META_RULES
    });
}
/**
 * 构建 Review Prompt（Phase 2 增强版）
 * 专门为代码审查场景注入原始目标和上下文
 */
function buildReviewPrompt(agent, task, threadContext, codeToReview) {
    const parts = [];
    // 1. 系统提示词
    parts.push(agent.systemPrompt);
    parts.push('');
    // 2. 元规则
    const metaRulesSection = buildMetaRulesSection(exports.DEFAULT_META_RULES);
    if (metaRulesSection) {
        parts.push(metaRulesSection);
    }
    // 3. Phase 2 增强：原始目标对齐规则
    parts.push(REVIEWER_ENHANCED_PROMPT);
    // 4. 原始目标摘要
    const goalSummary = buildOriginalGoalSummary(threadContext);
    if (goalSummary) {
        parts.push('');
        parts.push(goalSummary);
    }
    // 5. 完整上下文
    const contextSection = buildContextSection(threadContext);
    if (contextSection) {
        parts.push(contextSection);
    }
    // 6. 当前任务
    parts.push(buildTaskSection(task));
    // 7. 要审查的代码
    parts.push('');
    parts.push('## 待审查内容');
    parts.push('');
    parts.push('```');
    parts.push(codeToReview);
    parts.push('```');
    return parts.join('\n');
}
/**
 * PromptBuilder 类
 */
class PromptBuilder {
    metaRules;
    constructor(metaRules = exports.DEFAULT_META_RULES) {
        this.metaRules = metaRules;
    }
    /**
     * 构建 Prompt
     */
    build(agent, task, threadContext) {
        return buildPrompt({
            agent,
            task,
            threadContext,
            metaRules: this.metaRules
        });
    }
    /**
     * 添加元规则
     */
    addMetaRule(rule) {
        this.metaRules.push(rule);
    }
    /**
     * 获取所有元规则
     */
    getMetaRules() {
        return [...this.metaRules];
    }
    /**
     * Phase 2：构建 Review Prompt
     * 为代码审查场景注入原始目标和完整上下文
     */
    buildReviewPrompt(agent, task, threadContext, codeToReview) {
        return buildReviewPrompt(agent, task, threadContext, codeToReview);
    }
    /**
     * Phase 2：获取原始目标摘要
     * 用于调试和验证 review 上下文注入
     */
    getOriginalGoalSummary(threadContext) {
        return buildOriginalGoalSummary(threadContext);
    }
}
exports.PromptBuilder = PromptBuilder;
//# sourceMappingURL=PromptBuilder.js.map