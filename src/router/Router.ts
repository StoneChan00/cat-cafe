/**
 * Router
 * 负责 @agent 检测、路由和 Worklist 管理
 */

import type { AgentRole, ParsedUserInput, A2ATrigger, WorklistItem, ThreadContext } from '../types';
import { resolveAgentAlias, getAgentConfig, AGENT_CONFIGS } from '../config/agents';

// @agent 正则表达式
const AGENT_MENTION_REGEX = /@([\w\u4e00-\u9fa5]+)/g;

// 最大 A2A 深度
const MAX_A2A_DEPTH = 5;

/**
 * 解析用户输入
 * 提取 @agent 召唤和实际内容
 */
export function parseUserInput(input: string): ParsedUserInput {
  const mentions: string[] = [];
  let match;
  
  // 提取所有 @mentions
  while ((match = AGENT_MENTION_REGEX.exec(input)) !== null) {
    mentions.push(match[1]);
  }
  
  // 移除 @mentions 后的内容
  let content = input.replace(AGENT_MENTION_REGEX, '').trim();
  
  // 解析第一个有效的 agent
  let targetAgent: AgentRole | undefined;
  let hasExplicitAgent = false;
  
  for (const mention of mentions) {
    const resolved = resolveAgentAlias(mention);
    if (resolved) {
      targetAgent = resolved;
      hasExplicitAgent = true;
      break;
    }
  }
  
  return {
    targetAgent,
    content,
    hasExplicitAgent
  };
}

/**
 * 从公开消息中提取 A2A 触发
 */
export function extractA2ATriggers(
  message: string,
  triggeredBy: AgentRole
): A2ATrigger[] {
  const triggers: A2ATrigger[] = [];
  let match;
  
  // 重置正则状态
  AGENT_MENTION_REGEX.lastIndex = 0;
  
  while ((match = AGENT_MENTION_REGEX.exec(message)) !== null) {
    const targetAgent = resolveAgentAlias(match[1]);
    if (targetAgent && targetAgent !== triggeredBy) {
      triggers.push({
        targetAgent,
        reason: `Mentioned by ${triggeredBy}`,
        triggeredBy
      });
    }
  }
  
  return triggers;
}

/**
 * WorklistEngine 类
 * 管理 A2A 工作队列
 */
export class WorklistEngine {
  private maxDepth: number;
  
  constructor(maxDepth: number = MAX_A2A_DEPTH) {
    this.maxDepth = maxDepth;
  }
  
  /**
   * 创建初始 Worklist
   */
  createInitialWorklist(targetAgent: AgentRole, reason: string): WorklistItem[] {
    return [{
      agentId: targetAgent,
      reason,
      triggeredBy: 'user' as AgentRole,
      addedAt: new Date().toISOString()
    }];
  }
  
  /**
   * 添加 A2A 工作项
   */
  addWorkItem(
    thread: ThreadContext,
    trigger: A2ATrigger
  ): boolean {
    // 检查深度限制
    if (thread.worklist.length >= this.maxDepth) {
      console.warn('[worklist] max depth reached, ignoring A2A request');
      return false;
    }
    
    // 检查是否已有相同 agent 在队列中
    const existing = thread.worklist.find(item => item.agentId === trigger.targetAgent);
    if (existing) {
      console.warn(`[worklist] agent ${trigger.targetAgent} already in queue`);
      return false;
    }
    
    thread.worklist.push({
      agentId: trigger.targetAgent,
      reason: trigger.reason,
      triggeredBy: trigger.triggeredBy,
      addedAt: new Date().toISOString()
    });
    
    return true;
  }
  
  /**
   * 获取下一个工作项
   */
  getNextWorkItem(thread: ThreadContext): WorklistItem | null {
    return thread.worklist.length > 0 ? thread.worklist[0] : null;
  }
  
  /**
   * 完成当前工作项
   */
  completeCurrentWorkItem(thread: ThreadContext): WorklistItem | null {
    return thread.worklist.shift() || null;
  }
  
  /**
   * 清空 Worklist
   */
  clearWorklist(thread: ThreadContext): void {
    thread.worklist = [];
  }
  
  /**
   * 检查是否有待处理工作
   */
  hasPendingWork(thread: ThreadContext): boolean {
    return thread.worklist.length > 0;
  }
  
  /**
   * 获取 Worklist 状态
   */
  getWorklistStatus(thread: ThreadContext): {
    total: number;
    current: WorklistItem | null;
    remaining: number;
  } {
    return {
      total: thread.worklist.length,
      current: this.getNextWorkItem(thread),
      remaining: thread.worklist.length
    };
  }
}

/**
 * Router 类
 * 整合路由和 Worklist 功能
 */
export class Router {
  private worklistEngine: WorklistEngine;
  
  constructor(maxDepth?: number) {
    this.worklistEngine = new WorklistEngine(maxDepth);
  }
  
  /**
   * 路由用户输入
   * 返回应该处理此输入的 agent
   */
  routeUserInput(input: string, thread?: ThreadContext): {
    agent: AgentRole;
    worklist: WorklistItem[];
  } {
    const parsed = parseUserInput(input);
    
    // 如果明确指定了 agent
    if (parsed.targetAgent) {
      const worklist = this.worklistEngine.createInitialWorklist(
        parsed.targetAgent,
        `User requested: ${parsed.content.slice(0, 50)}`
      );
      
      return {
        agent: parsed.targetAgent,
        worklist
      };
    }
    
    // 如果有当前 agent，继续使用
    if (thread?.currentAgent) {
      return {
        agent: thread.currentAgent,
        worklist: thread.worklist
      };
    }
    
    // 默认使用 developer
    const worklist = this.worklistEngine.createInitialWorklist(
      'developer',
      `Default routing: ${input.slice(0, 50)}`
    );
    
    return {
      agent: 'developer',
      worklist
    };
  }
  
  /**
   * 处理 A2A 触发
   */
  processA2A(
    thread: ThreadContext,
    message: string,
    triggeredBy: AgentRole
  ): A2ATrigger[] {
    const triggers = extractA2ATriggers(message, triggeredBy);
    
    for (const trigger of triggers) {
      this.worklistEngine.addWorkItem(thread, trigger);
    }
    
    return triggers;
  }
  
  /**
   * 获取下一个要执行的 agent
   */
  getNextAgent(thread: ThreadContext): AgentRole | null {
    const nextItem = this.worklistEngine.getNextWorkItem(thread);
    return nextItem?.agentId || null;
  }
  
  /**
   * 完成当前 agent 执行
   */
  completeCurrentAgent(thread: ThreadContext): void {
    this.worklistEngine.completeCurrentWorkItem(thread);
  }
  
  /**
   * 取消所有待处理工作
   */
  cancelAll(thread: ThreadContext): void {
    this.worklistEngine.clearWorklist(thread);
  }
  
  /**
   * 获取 WorklistEngine
   */
  getWorklistEngine(): WorklistEngine {
    return this.worklistEngine;
  }
}