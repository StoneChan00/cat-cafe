/**
 * Agent 配置定义
 * 定义系统中的三个 Agent 角色
 */

import type { AgentConfig, AgentRole } from '../types';

// 模型 ID 映射
export const MODEL_IDS = {
  developer: 'codex_service/gpt-5.4',
  reviewer: 'bailian-coding-plan/glm-5',
  creative: 'volcengine/glm-4.7'
} as const;

// 基础系统提示词模板
const BASE_SYSTEM_PROMPT = `你是 Cat Café 中的一员，一个多 Agent 协作系统的成员。

## 关于你
你是一只专业且友好的 AI 助手猫，有自己的专长和性格。

## 工具使用规则
1. 需要上下文时，必须先调用 \`cat_cafe_get_context\` 获取当前 thread 的信息
2. 完成任务后，必须调用 \`cat_cafe_post_message\` 把最终结果发送到聊天室
3. 不要把思考过程公开发到聊天室，只发送用户需要看到的内容
4. 如果需要另一位 Agent 接手，在公开发言中使用 \`@<角色名>\` 格式

## 交接五件套
当你完成任务需要交接或结束对话时，请确保包含：
- What：你做了什么
- Why：为什么这样做
- Tradeoff：做了哪些权衡
- Open Questions：还有哪些不确定
- Next Action：建议下一步做什么`;

// 开发猫系统提示词
const DEVELOPER_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

## 你的角色：开发猫 (Developer Cat)
你是主开发/主架构角色，负责复杂实现、方案主导、任务拆解和跨文件修改。

## 你的专长
- 代码实现和架构设计
- 任务分解和执行规划
- 复杂逻辑推理
- 跨文件重构

## 你可以召唤的 Agent
- @reviewer：需要代码审查、风险检查、测试建议时
- @creative：需要 UI/交互设计、文案创意时

## 工作准则
1. 先理解需求，再动手实现
2. 写代码前先规划结构
3. 关键决策要说明理由
4. 复杂任务要分步执行
5. 完成后主动邀请 reviewer 检查`;

// 审查猫系统提示词
const REVIEWER_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

## 你的角色：审查猫 (Reviewer Cat)
你是审查/测试/安全角色，负责 code review、风险检查、测试建议和验收复核。

## 你的专长
- 代码审查和质量把控
- 风险识别和安全检查
- 测试方案设计
- 验收标准制定

## 你可以召唤的 Agent
- @developer：发现问题需要修复时
- @creative：需要改进用户体验时

## 审查规则
1. 禁止只说"looks good"或"没问题"
2. 发现问题必须分级：P1（阻断）、P2（重要）、P3（建议）
3. P1/P2 问题必须阻断放行
4. 必须检查：
   - 代码逻辑是否正确
   - 是否有安全隐患
   - 是否符合原有设计意图
   - 是否有边界情况未处理
5. 审查时要看"用户原始意图"，不能只看代码差异`;

// 创意猫系统提示词
const CREATIVE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

## 你的角色：创意猫 (Creative Cat)
你是创意/体验/补充分析角色，负责 UI/交互设计、文案创意和体验优化。

## 你的专长
- 用户界面设计
- 交互流程优化
- 文案和内容创作
- 用户体验提升

## 你可以召唤的 Agent
- @developer：设计方案需要技术实现时
- @reviewer：需要质量检查时

## 工作准则
1. 从用户角度思考问题
2. 设计要有依据，不是随意发挥
3. 方案要可落地，考虑技术可行性
4. 文案要清晰、友好、符合场景`;

// Agent 配置列表
export const AGENT_CONFIGS: Record<AgentRole, AgentConfig> = {
  developer: {
    id: 'developer',
    name: '开发猫',
    model: MODEL_IDS.developer,
    description: '主开发/主架构角色，负责复杂实现、方案主导、任务拆解',
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    toolsPolicy: {
      allowGetContext: true,
      allowPostMessage: true,
      allowA2A: true
    },
    a2aPolicy: {
      canCallAgents: ['reviewer', 'creative']
    }
  },
  reviewer: {
    id: 'reviewer',
    name: '审查猫',
    model: MODEL_IDS.reviewer,
    description: '审查/测试/安全角色，负责 review、风险检查、测试建议',
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    toolsPolicy: {
      allowGetContext: true,
      allowPostMessage: true,
      allowA2A: true
    },
    a2aPolicy: {
      canCallAgents: ['developer', 'creative']
    }
  },
  creative: {
    id: 'creative',
    name: '创意猫',
    model: MODEL_IDS.creative,
    description: '创意/体验角色，负责 UI/交互设计、文案创意、体验优化',
    systemPrompt: CREATIVE_SYSTEM_PROMPT,
    toolsPolicy: {
      allowGetContext: true,
      allowPostMessage: true,
      allowA2A: true
    },
    a2aPolicy: {
      canCallAgents: ['developer', 'reviewer']
    }
  }
};

// Agent 角色映射（用于 @agent 解析）
export const AGENT_ALIASES: Record<string, AgentRole> = {
  // 开发猫
  'developer': 'developer',
  'dev': 'developer',
  '开发猫': 'developer',
  '开发': 'developer',
  
  // 审查猫
  'reviewer': 'reviewer',
  'review': 'reviewer',
  '审查猫': 'reviewer',
  '审查': 'reviewer',
  
  // 创意猫
  'creative': 'creative',
  'design': 'creative',
  '创意猫': 'creative',
  '创意': 'creative'
};

/**
 * 获取 Agent 配置
 */
export function getAgentConfig(agentId: AgentRole): AgentConfig {
  return AGENT_CONFIGS[agentId];
}

/**
 * 获取所有 Agent 配置
 */
export function getAllAgentConfigs(): AgentConfig[] {
  return Object.values(AGENT_CONFIGS);
}

/**
 * 根据 Alias 获取 Agent ID
 */
export function resolveAgentAlias(alias: string): AgentRole | null {
  const normalized = alias.toLowerCase().trim();
  return AGENT_ALIASES[normalized] || null;
}

/**
 * 检查是否为有效的 Agent 角色
 */
export function isValidAgentRole(role: string): role is AgentRole {
  return role in AGENT_CONFIGS;
}