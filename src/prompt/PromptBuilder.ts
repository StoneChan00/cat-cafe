/**
 * Prompt 构建器
 * 负责为每个 Agent 生成完整的 prompt
 */

import type { AgentConfig, ThreadContext, MetaRule, PromptBuildContext } from '../types';

// 默认元规则
export const DEFAULT_META_RULES: MetaRule[] = [
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
 * 构建上下文部分
 */
function buildContextSection(threadContext?: ThreadContext): string {
  if (!threadContext || threadContext.messages.length === 0) {
    return '';
  }
  
  const publicMessages = threadContext.messages.filter(m => m.isPublic);
  if (publicMessages.length === 0) {
    return '';
  }
  
  const lines: string[] = ['## 当前 Thread 上下文', ''];
  
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
function buildMetaRulesSection(rules: MetaRule[]): string {
  if (rules.length === 0) {
    return '';
  }
  
  const lines: string[] = ['## 元规则', ''];
  
  for (const rule of rules) {
    lines.push(rule.template);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * 构建任务部分
 */
function buildTaskSection(task: string): string {
  return `## 当前任务

${task}`;
}

/**
 * 构建完整 Prompt
 */
export function buildPrompt(context: PromptBuildContext): string {
  const parts: string[] = [];
  
  // 1. 系统提示词
  parts.push(context.agent.systemPrompt);
  parts.push('');
  
  // 2. 元规则
  const metaRulesSection = buildMetaRulesSection(context.metaRules);
  if (metaRulesSection) {
    parts.push(metaRulesSection);
  }
  
  // 3. 上下文
  const contextSection = buildContextSection(context.threadContext);
  if (contextSection) {
    parts.push(contextSection);
  }
  
  // 4. 当前任务
  parts.push(buildTaskSection(context.task));
  
  return parts.join('\n');
}

/**
 * 构建简单 Prompt（无上下文）
 */
export function buildSimplePrompt(agent: AgentConfig, task: string): string {
  return buildPrompt({
    agent,
    task,
    metaRules: DEFAULT_META_RULES
  });
}

/**
 * PromptBuilder 类
 */
export class PromptBuilder {
  private metaRules: MetaRule[];
  
  constructor(metaRules: MetaRule[] = DEFAULT_META_RULES) {
    this.metaRules = metaRules;
  }
  
  /**
   * 构建 Prompt
   */
  build(
    agent: AgentConfig,
    task: string,
    threadContext?: ThreadContext
  ): string {
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
  addMetaRule(rule: MetaRule): void {
    this.metaRules.push(rule);
  }
  
  /**
   * 获取所有元规则
   */
  getMetaRules(): MetaRule[] {
    return [...this.metaRules];
  }
}