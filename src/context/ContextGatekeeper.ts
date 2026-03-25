/**
 * Context Gatekeeper
 * Context Engineering 守门器
 * Phase 3 核心组件：智能上下文管理和质量把关
 */

import type { ThreadContext, ThreadMessage, AgentConfig } from '../types';
import type { ContextSlice, ContextSliceOptions, RetrievalStrategy } from '../session/ContextRetriever';

// ============ 类型定义 ============

/**
 * 上下文质量评估结果
 */
export interface ContextQualityAssessment {
  score: number;           // 0-100 分
  tokenCount: number;
  messageCount: number;
  relevanceScore: number;  // 相关性得分
  completenessScore: number; // 完整性得分
  issues: ContextQualityIssue[];
  suggestions: string[];
}

/**
 * 上下文质量问题
 */
export interface ContextQualityIssue {
  type: 'warning' | 'error' | 'info';
  message: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

/**
 * 上下文注入决策
 */
export interface ContextInjectionDecision {
  shouldInject: boolean;
  strategy: RetrievalStrategy;
  maxTokens: number;
  reason: string;
  optimizedSlice?: ContextSlice;
}

/**
 * 守门器配置
 */
export interface GatekeeperConfig {
  maxContextTokens: number;
  minContextTokens: number;
  relevanceThreshold: number;
  enableOptimization: boolean;
  enableCaching: boolean;
  preserveSystemMessages: boolean;
  preserveFirstUserMessage: boolean;
}

/**
 * 上下文分层
 */
export interface ContextLayer {
  layer: 'essential' | 'important' | 'relevant' | 'optional';
  messages: ThreadMessage[];
  tokenCount: number;
  priority: number;
}

/**
 * 注入验证结果
 */
export interface InjectionValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  finalTokenCount: number;
  estimatedQuality: number;
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: GatekeeperConfig = {
  maxContextTokens: 150000,
  minContextTokens: 5000,
  relevanceThreshold: 0.3,
  enableOptimization: true,
  enableCaching: true,
  preserveSystemMessages: true,
  preserveFirstUserMessage: true
};

// ============ Token 估算 ============

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars + otherChars / 4);
}

function estimateMessageTokens(msg: ThreadMessage): number {
  return estimateTokens(msg.content) + 50;
}

// ============ 核心函数 ============

/**
 * 评估上下文质量
 */
export function assessContextQuality(
  thread: ThreadContext,
  slice: ContextSlice,
  config: GatekeeperConfig = DEFAULT_CONFIG
): ContextQualityAssessment {
  const issues: ContextQualityIssue[] = [];
  const suggestions: string[] = [];
  
  // 计算基础分数
  const tokenCount = slice.tokenEstimate;
  const messageCount = slice.messages.length;
  
  // 检查 token 数量
  if (tokenCount > config.maxContextTokens * 0.9) {
    issues.push({
      type: 'warning',
      message: `Token 数量接近上限: ${tokenCount}/${config.maxContextTokens}`,
      severity: 'medium',
      suggestion: '建议启用上下文压缩或摘要'
    });
  }
  
  if (tokenCount < config.minContextTokens) {
    issues.push({
      type: 'info',
      message: `Token 数量较少: ${tokenCount}`,
      severity: 'low',
      suggestion: '可考虑加载更多历史上下文'
    });
  }
  
  // 检查消息分布
  const userMessages = slice.messages.filter(m => m.role === 'user');
  const agentMessages = slice.messages.filter(m => m.role === 'agent');
  
  if (userMessages.length === 0) {
    issues.push({
      type: 'error',
      message: '缺少用户消息',
      severity: 'high',
      suggestion: '必须包含至少一条用户消息作为原始意图'
    });
  }
  
  if (agentMessages.length === 0) {
    issues.push({
      type: 'warning',
      message: '缺少 Agent 响应',
      severity: 'medium',
      suggestion: '可能需要重新加载上下文'
    });
  }
  
  // 检查是否包含第一条用户消息
  const firstUserMessage = thread.messages.find(m => m.role === 'user');
  if (firstUserMessage && config.preserveFirstUserMessage) {
    const hasFirstUser = slice.messages.some(m => m.id === firstUserMessage.id);
    if (!hasFirstUser) {
      issues.push({
        type: 'warning',
        message: '未包含第一条用户消息（原始意图）',
        severity: 'medium',
        suggestion: '建议保留原始意图消息'
      });
    }
  }
  
  // 检查消息顺序
  let inOrder = true;
  for (let i = 1; i < slice.messages.length; i++) {
    const prevTime = new Date(slice.messages[i - 1].timestamp).getTime();
    const currTime = new Date(slice.messages[i].timestamp).getTime();
    if (currTime < prevTime) {
      inOrder = false;
      break;
    }
  }
  
  if (!inOrder) {
    issues.push({
      type: 'error',
      message: '消息顺序混乱',
      severity: 'high',
      suggestion: '请检查上下文加载逻辑'
    });
  }
  
  // 计算相关性得分（简化版）
  const relevanceScore = calculateRelevanceScore(slice);
  
  // 计算完整性得分
  const completenessScore = calculateCompletenessScore(thread, slice);
  
  // 综合质量分数
  const score = Math.round(
    (relevanceScore * 0.4 + completenessScore * 0.4 + 
    (issues.filter(i => i.severity === 'high').length === 0 ? 100 : 50) * 0.2)
  );
  
  // 生成建议
  if (tokenCount > config.maxContextTokens * 0.8) {
    suggestions.push('启用上下文压缩以减少 token 使用');
  }
  
  if (relevanceScore < 0.5) {
    suggestions.push('考虑使用更精确的检索策略');
  }
  
  return {
    score,
    tokenCount,
    messageCount,
    relevanceScore: Math.round(relevanceScore * 100),
    completenessScore: Math.round(completenessScore * 100),
    issues,
    suggestions
  };
}

/**
 * 计算相关性得分
 */
function calculateRelevanceScore(slice: ContextSlice): number {
  // 简化实现：检查消息内容是否包含关键信息
  const hasDecisions = slice.messages.some(m => 
    /决定|采用|选择|方案/.test(m.content)
  );
  const hasQuestions = slice.messages.some(m => 
    /问题|疑问|待确认/.test(m.content)
  );
  const hasActions = slice.messages.some(m => 
    /下一步|待办|TODO/.test(m.content)
  );
  
  let score = 0.5;
  if (hasDecisions) score += 0.2;
  if (hasQuestions) score += 0.15;
  if (hasActions) score += 0.15;
  
  return Math.min(score, 1);
}

/**
 * 计算完整性得分
 */
function calculateCompletenessScore(thread: ThreadContext, slice: ContextSlice): number {
  const totalMessages = thread.messages.length;
  const sliceMessages = slice.messages.length;
  
  if (totalMessages === 0) return 1;
  
  // 检查是否包含首尾消息
  const hasFirst = slice.messages.some(m => m.id === thread.messages[0]?.id);
  const hasLast = slice.messages.some(m => m.id === thread.messages[thread.messages.length - 1]?.id);
  
  let score = sliceMessages / totalMessages;
  if (hasFirst) score += 0.1;
  if (hasLast) score += 0.1;
  
  return Math.min(score, 1);
}

/**
 * 对上下文进行分层
 */
export function layerContext(
  thread: ThreadContext,
  config: GatekeeperConfig = DEFAULT_CONFIG
): ContextLayer[] {
  const layers: ContextLayer[] = [];
  
  // 第一层：必需消息
  const essential: ThreadMessage[] = [];
  
  // 保留第一条用户消息（原始意图）
  const firstUser = thread.messages.find(m => m.role === 'user');
  if (firstUser && config.preserveFirstUserMessage) {
    essential.push(firstUser);
  }
  
  // 保留最后几条消息（当前上下文）
  const lastFew = thread.messages.slice(-5);
  for (const msg of lastFew) {
    if (!essential.some(m => m.id === msg.id)) {
      essential.push(msg);
    }
  }
  
  layers.push({
    layer: 'essential',
    messages: essential,
    tokenCount: essential.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
    priority: 100
  });
  
  // 第二层：重要消息（关键决策）
  const important = thread.messages.filter(m => 
    /决定|采用|选择|方案|确定|结论/.test(m.content) &&
    !essential.some(e => e.id === m.id)
  ).slice(-10);
  
  if (important.length > 0) {
    layers.push({
      layer: 'important',
      messages: important,
      tokenCount: important.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
      priority: 80
    });
  }
  
  // 第三层：相关消息（问题和行动项）
  const relevant = thread.messages.filter(m => 
    (/问题|疑问|下一步|待办/.test(m.content)) &&
    !essential.some(e => e.id === m.id) &&
    !important.some(i => i.id === m.id)
  ).slice(-15);
  
  if (relevant.length > 0) {
    layers.push({
      layer: 'relevant',
      messages: relevant,
      tokenCount: relevant.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
      priority: 60
    });
  }
  
  // 第四层：可选消息（其他）
  const optional = thread.messages.filter(m => 
    !essential.some(e => e.id === m.id) &&
    !important.some(i => i.id === m.id) &&
    !relevant.some(r => r.id === m.id)
  );
  
  if (optional.length > 0) {
    layers.push({
      layer: 'optional',
      messages: optional,
      tokenCount: optional.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
      priority: 40
    });
  }
  
  return layers.sort((a, b) => b.priority - a.priority);
}

/**
 * 优化上下文切片
 */
export function optimizeContextSlice(
  thread: ThreadContext,
  targetTokens: number,
  config: GatekeeperConfig = DEFAULT_CONFIG
): ContextSlice {
  const layers = layerContext(thread, config);
  
  const selected: ThreadMessage[] = [];
  let currentTokens = 0;
  
  // 按优先级选择消息
  for (const layer of layers) {
    for (const msg of layer.messages) {
      const msgTokens = estimateMessageTokens(msg);
      
      if (currentTokens + msgTokens <= targetTokens) {
        selected.push(msg);
        currentTokens += msgTokens;
      }
    }
  }
  
  // 按时间排序
  selected.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  return {
    messages: selected,
    tokenEstimate: currentTokens,
    source: 'current_session',
    truncated: selected.length < thread.messages.length,
    reason: `分层优化: 必需${layers[0]?.messages.length || 0} + 重要${layers[1]?.messages.length || 0} + 相关${layers[2]?.messages.length || 0}`
  };
}

/**
 * 决定是否注入上下文
 */
export function decideContextInjection(
  thread: ThreadContext,
  agent: AgentConfig,
  config: GatekeeperConfig = DEFAULT_CONFIG
): ContextInjectionDecision {
  const tokenEstimate = thread.messages.reduce(
    (sum, m) => sum + estimateMessageTokens(m), 0
  );
  
  // 根据 token 数量决定策略
  if (tokenEstimate < config.maxContextTokens * 0.5) {
    return {
      shouldInject: true,
      strategy: 'recent',
      maxTokens: config.maxContextTokens,
      reason: '上下文充足，使用完整上下文'
    };
  }
  
  if (tokenEstimate < config.maxContextTokens * 0.8) {
    return {
      shouldInject: true,
      strategy: 'summary',
      maxTokens: Math.floor(config.maxContextTokens * 0.8),
      reason: '上下文较大，使用摘要策略'
    };
  }
  
  // token 接近上限，必须优化
  return {
    shouldInject: true,
    strategy: 'key_decisions',
    maxTokens: Math.floor(config.maxContextTokens * 0.7),
    reason: '上下文接近上限，启用关键决策策略',
    optimizedSlice: optimizeContextSlice(
      thread,
      Math.floor(config.maxContextTokens * 0.7),
      config
    )
  };
}

/**
 * 验证注入
 */
export function validateInjection(
  slice: ContextSlice,
  config: GatekeeperConfig = DEFAULT_CONFIG
): InjectionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 验证 token 数量
  if (slice.tokenEstimate > config.maxContextTokens) {
    errors.push(`Token 数量超出限制: ${slice.tokenEstimate}/${config.maxContextTokens}`);
  }
  
  // 验证消息数量
  if (slice.messages.length === 0) {
    errors.push('上下文为空');
  }
  
  // 验证消息完整性
  const hasUser = slice.messages.some(m => m.role === 'user');
  if (!hasUser) {
    errors.push('上下文中缺少用户消息');
  }
  
  // 警告
  if (slice.truncated) {
    warnings.push('上下文已被截断');
  }
  
  if (slice.tokenEstimate > config.maxContextTokens * 0.8) {
    warnings.push('Token 使用接近上限');
  }
  
  // 估算质量
  const estimatedQuality = Math.max(0, 100 - errors.length * 20 - warnings.length * 10);
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    finalTokenCount: slice.tokenEstimate,
    estimatedQuality
  };
}

/**
 * 生成上下文报告
 */
export function generateContextReport(
  assessment: ContextQualityAssessment,
  decision: ContextInjectionDecision
): string {
  const lines: string[] = [];
  
  lines.push('## Context Gatekeeper 报告');
  lines.push('');
  lines.push('### 质量评估');
  lines.push(`- 综合得分: ${assessment.score}/100`);
  lines.push(`- 相关性: ${assessment.relevanceScore}%`);
  lines.push(`- 完整性: ${assessment.completenessScore}%`);
  lines.push(`- Token 数: ${assessment.tokenCount}`);
  lines.push(`- 消息数: ${assessment.messageCount}`);
  lines.push('');
  
  if (assessment.issues.length > 0) {
    lines.push('### 问题');
    for (const issue of assessment.issues) {
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`  建议: ${issue.suggestion}`);
      }
    }
    lines.push('');
  }
  
  lines.push('### 注入决策');
  lines.push(`- 策略: ${decision.strategy}`);
  lines.push(`- 最大 Token: ${decision.maxTokens}`);
  lines.push(`- 原因: ${decision.reason}`);
  lines.push('');
  
  if (assessment.suggestions.length > 0) {
    lines.push('### 建议');
    for (const suggestion of assessment.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }
  
  return lines.join('\n');
}

// ============ ContextGatekeeper 类 ============

/**
 * ContextGatekeeper 类
 * 提供高级上下文管理功能
 */
export class ContextGatekeeper {
  private config: GatekeeperConfig;
  private cache: Map<string, ContextSlice> = new Map();
  
  constructor(config: Partial<GatekeeperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * 评估上下文质量
   */
  assessQuality(thread: ThreadContext, slice: ContextSlice): ContextQualityAssessment {
    return assessContextQuality(thread, slice, this.config);
  }
  
  /**
   * 分层上下文
   */
  layer(thread: ThreadContext): ContextLayer[] {
    return layerContext(thread, this.config);
  }
  
  /**
   * 优化切片
   */
  optimize(thread: ThreadContext, targetTokens?: number): ContextSlice {
    const target = targetTokens || Math.floor(this.config.maxContextTokens * 0.8);
    return optimizeContextSlice(thread, target, this.config);
  }
  
  /**
   * 决定注入策略
   */
  decide(thread: ThreadContext, agent: AgentConfig): ContextInjectionDecision {
    const decision = decideContextInjection(thread, agent, this.config);
    
    // 缓存优化后的切片
    if (decision.optimizedSlice && this.config.enableCaching) {
      const cacheKey = `${thread.threadId}-${decision.strategy}`;
      this.cache.set(cacheKey, decision.optimizedSlice);
    }
    
    return decision;
  }
  
  /**
   * 验证注入
   */
  validate(slice: ContextSlice): InjectionValidation {
    return validateInjection(slice, this.config);
  }
  
  /**
   * 完整处理流程
   */
  process(thread: ThreadContext, agent: AgentConfig): {
    decision: ContextInjectionDecision;
    assessment: ContextQualityAssessment;
    validation: InjectionValidation;
    report: string;
  } {
    // 1. 决定注入策略
    const decision = this.decide(thread, agent);
    
    // 2. 获取切片
    const slice = decision.optimizedSlice || {
      messages: thread.messages.slice(-50), // 默认最近50条
      tokenEstimate: thread.messages.slice(-50).reduce(
        (sum, m) => sum + estimateMessageTokens(m), 0
      ),
      source: 'current_session',
      truncated: thread.messages.length > 50,
      reason: '默认策略: 最近50条'
    };
    
    // 3. 评估质量
    const assessment = this.assessQuality(thread, slice);
    
    // 4. 验证
    const validation = this.validate(slice);
    
    // 5. 生成报告
    const report = generateContextReport(assessment, decision);
    
    return {
      decision,
      assessment,
      validation,
      report
    };
  }
  
  /**
   * 更新配置
   */
  updateConfig(config: Partial<GatekeeperConfig>): void {
    Object.assign(this.config, config);
  }
  
  /**
   * 获取配置
   */
  getConfig(): GatekeeperConfig {
    return { ...this.config };
  }
  
  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
