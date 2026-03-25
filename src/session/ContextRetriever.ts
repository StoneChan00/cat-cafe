/**
 * Context Retriever
 * 按需历史检索与上下文切片
 * Phase 3 核心组件：支持智能上下文选择和关键信息提取
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { access, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { ThreadContext, ThreadMessage } from '../types';
import type { SessionRecord } from './SessionManager';

// ============ 类型定义 ============

/**
 * 上下文检索策略
 */
export type RetrievalStrategy = 
  | 'recent'        // 最近的 N 条消息
  | 'summary'       // Session 摘要
  | 'key_decisions' // 关键决策
  | 'user_only'     // 仅用户消息
  | 'agent_only'    // 仅 agent 消息
  | 'custom';       // 自定义过滤

/**
 * 上下文切片选项
 */
export interface ContextSliceOptions {
  strategy: RetrievalStrategy;
  maxTokens?: number;      // 最大 token 限制
  maxMessages?: number;    // 最大消息数
  includeMetadata?: boolean;
  includeSystemPrompt?: boolean;
  keywords?: string[];     // 关键词过滤
  since?: Date;            // 时间过滤
  agentFilter?: string[];  // Agent 过滤
}

/**
 * 上下文切片结果
 */
export interface ContextSlice {
  messages: ThreadMessage[];
  summary?: string;
  tokenEstimate: number;
  source: 'current_session' | 'sealed_session' | 'mixed';
  truncated: boolean;
  reason: string;
}

/**
 * 历史检索结果
 */
export interface HistoryRetrievalResult {
  sessions: SessionRecord[];
  relevantMessages: ThreadMessage[];
  keyDecisions: string[];
  openQuestions: string[];
  tokenEstimate: number;
}

/**
 * 语义匹配选项
 */
export interface SemanticMatchOptions {
  query: string;
  threshold?: number;      // 相似度阈值
  maxResults?: number;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getThreadsDir(): string {
  return join(getDataDir(), 'threads');
}

function getThreadFilePath(threadId: string): string {
  return join(getThreadsDir(), `${threadId}.json`);
}

// ============ Token 估算 ============

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars + otherChars / 4);
}

function estimateMessageTokens(msg: ThreadMessage): number {
  return estimateTokens(msg.content) + 50; // 格式开销
}

// ============ 核心函数 ============

/**
 * 加载 Thread
 */
async function loadThread(threadId: string): Promise<ThreadContext | null> {
  try {
    const filePath = getThreadFilePath(threadId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ThreadContext;
  } catch {
    return null;
  }
}

/**
 * 切片上下文（按策略）
 */
export function sliceContext(
  thread: ThreadContext,
  options: ContextSliceOptions
): ContextSlice {
  let messages: ThreadMessage[] = [...thread.messages];
  let tokenEstimate = 0;
  let reason = '';
  let truncated = false;
  
  // 应用时间过滤
  if (options.since) {
    messages = messages.filter(m => new Date(m.timestamp) >= options.since!);
    reason += `时间过滤后: ${messages.length} 条; `;
  }
  
  // 应用 Agent 过滤
  if (options.agentFilter && options.agentFilter.length > 0) {
    messages = messages.filter(m => 
      m.role === 'user' || (m.agentId && options.agentFilter!.includes(m.agentId))
    );
    reason += `Agent 过滤后: ${messages.length} 条; `;
  }
  
  // 应用关键词过滤
  if (options.keywords && options.keywords.length > 0) {
    messages = messages.filter(m => 
      options.keywords!.some(kw => m.content.toLowerCase().includes(kw.toLowerCase()))
    );
    reason += `关键词过滤后: ${messages.length} 条; `;
  }
  
  // 应用策略
  switch (options.strategy) {
    case 'recent':
      // 取最近的 N 条
      if (options.maxMessages && messages.length > options.maxMessages) {
        messages = messages.slice(-options.maxMessages);
        reason += `取最近 ${options.maxMessages} 条; `;
      }
      break;
      
    case 'summary':
      // 只取关键摘要信息（第一条用户消息 + 最后几条）
      const firstUser = messages.find(m => m.role === 'user');
      const lastFew = messages.slice(-3);
      messages = firstUser ? [firstUser, ...lastFew.filter(m => m.id !== firstUser.id)] : lastFew;
      reason += '摘要模式: 首条+末3条; ';
      break;
      
    case 'key_decisions':
      // 提取包含决策关键词的消息
      messages = messages.filter(m => 
        /决定|采用|选择|方案|确定|结论/.test(m.content)
      );
      reason += `关键决策: ${messages.length} 条; `;
      break;
      
    case 'user_only':
      messages = messages.filter(m => m.role === 'user');
      reason += `仅用户消息: ${messages.length} 条; `;
      break;
      
    case 'agent_only':
      messages = messages.filter(m => m.role === 'agent');
      reason += `仅 Agent 消息: ${messages.length} 条; `;
      break;
      
    case 'custom':
      // 保持当前过滤结果
      reason += '自定义过滤; ';
      break;
  }
  
  // 计算 token
  tokenEstimate = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  
  // 应用 token 限制
  if (options.maxTokens && tokenEstimate > options.maxTokens) {
    // 从最早的消息开始移除，直到满足 token 限制
    while (tokenEstimate > options.maxTokens && messages.length > 1) {
      const removed = messages.shift()!;
      tokenEstimate -= estimateMessageTokens(removed);
      truncated = true;
    }
    reason += `Token 截断后: ${messages.length} 条; `;
  }
  
  return {
    messages,
    tokenEstimate,
    source: 'current_session',
    truncated,
    reason: reason.trim() || '完整上下文'
  };
}

/**
 * 从 Sealed Session 检索历史
 */
export async function retrieveFromSealedSession(
  session: SessionRecord,
  options: ContextSliceOptions
): Promise<ContextSlice> {
  if (!session.summary) {
    return {
      messages: [],
      summary: 'Session 无摘要',
      tokenEstimate: 0,
      source: 'sealed_session',
      truncated: false,
      reason: 'Session 未生成摘要'
    };
  }
  
  // 构建摘要消息
  const summaryContent = [
    '## 历史 Session 摘要',
    '',
    '### 关键决策',
    ...session.summary.keyDecisions.map(d => `- ${d}`),
    '',
    '### 未解决问题',
    ...session.summary.openQuestions.map(q => `- ${q}`),
    '',
    '### 重要上下文',
    session.summary.criticalContext
  ].join('\n');
  
  const summaryMessage: ThreadMessage = {
    id: `session-${session.sessionId}`,
    role: 'agent',
    content: summaryContent,
    timestamp: session.sealedAt || session.createdAt,
    isPublic: false
  };
  
  return {
    messages: [summaryMessage],
    summary: summaryContent,
    tokenEstimate: estimateTokens(summaryContent),
    source: 'sealed_session',
    truncated: false,
    reason: `从 Sealed Session ${session.sessionId} 检索`
  };
}

/**
 * 混合检索（当前 + 历史）
 */
export async function retrieveMixedContext(
  currentThread: ThreadContext,
  sealedSessions: SessionRecord[],
  options: ContextSliceOptions
): Promise<ContextSlice> {
  const slices: ContextSlice[] = [];
  let totalTokens = 0;
  const maxTokens = options.maxTokens || 150000;
  
  // 1. 首先获取当前 Session 的上下文
  const currentSlice = sliceContext(currentThread, {
    ...options,
    maxTokens: Math.floor(maxTokens * 0.6) // 当前 Session 占 60%
  });
  slices.push(currentSlice);
  totalTokens += currentSlice.tokenEstimate;
  
  // 2. 从最近的 Sealed Session 补充历史
  if (totalTokens < maxTokens * 0.8 && sealedSessions.length > 0) {
    const remainingTokens = maxTokens - totalTokens;
    const historySlice = await retrieveFromSealedSession(sealedSessions[0], {
      ...options,
      maxTokens: Math.floor(remainingTokens * 0.5)
    });
    slices.push(historySlice);
    totalTokens += historySlice.tokenEstimate;
  }
  
  // 合并消息
  const allMessages = slices.flatMap(s => s.messages);
  
  return {
    messages: allMessages,
    tokenEstimate: totalTokens,
    source: 'mixed',
    truncated: slices.some(s => s.truncated),
    reason: `混合检索: ${slices.map(s => s.reason).join('; ')}`
  };
}

/**
 * 语义相似度计算（简化版：基于关键词匹配）
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * 语义搜索（简化版）
 */
export async function semanticSearchMessages(
  thread: ThreadContext,
  options: SemanticMatchOptions
): Promise<Array<{ message: ThreadMessage; score: number }>> {
  const query = options.query.toLowerCase();
  const threshold = options.threshold || 0.1;
  const maxResults = options.maxResults || 10;
  
  const results = thread.messages
    .map(msg => ({
      message: msg,
      score: calculateSimilarity(msg.content, query)
    }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  
  return results;
}

/**
 * 提取关键信息
 */
export function extractKeyInformation(thread: ThreadContext): {
  keyDecisions: string[];
  openQuestions: string[];
  actionItems: string[];
  technicalTerms: string[];
} {
  const keyDecisions: string[] = [];
  const openQuestions: string[] = [];
  const actionItems: string[] = [];
  const technicalTerms: Set<string> = new Set();
  
  for (const msg of thread.messages) {
    // 提取决策
    const decisionMatch = msg.content.match(/(?:决定|采用|选择|方案)[：:]\s*([^\n]+)/gi);
    if (decisionMatch) {
      keyDecisions.push(...decisionMatch.map(m => m.trim()));
    }
    
    // 提取问题
    const questionMatch = msg.content.match(/(?:问题|疑问)[：:]\s*([^\n]+)/gi);
    if (questionMatch) {
      openQuestions.push(...questionMatch.map(m => m.trim()));
    }
    
    // 提取行动项
    const actionMatch = msg.content.match(/(?:下一步|待办|TODO)[：:]\s*([^\n]+)/gi);
    if (actionMatch) {
      actionItems.push(...actionMatch.map(m => m.trim()));
    }
    
    // 提取技术术语（简化）
    const codeTerms = msg.content.match(/`([^`]+)`/g);
    if (codeTerms) {
      codeTerms.forEach(term => technicalTerms.add(term.replace(/`/g, '')));
    }
  }
  
  return {
    keyDecisions: keyDecisions.slice(-10),
    openQuestions: openQuestions.slice(-10),
    actionItems: actionItems.slice(-10),
    technicalTerms: Array.from(technicalTerms).slice(-20)
  };
}

/**
 * 生成上下文提示
 */
export function generateContextPrompt(slice: ContextSlice): string {
  const lines: string[] = [];
  
  lines.push('## 上下文信息');
  lines.push('');
  lines.push(`来源: ${slice.source}`);
  lines.push(`Token 估算: ${slice.tokenEstimate}`);
  lines.push(`原因: ${slice.reason}`);
  
  if (slice.truncated) {
    lines.push('*注意: 上下文已被截断以符合 token 限制*');
  }
  
  lines.push('');
  lines.push('### 消息历史');
  lines.push('');
  
  for (const msg of slice.messages) {
    const role = msg.role === 'user' ? '用户' : msg.agentId || 'Agent';
    lines.push(`**${role}**: ${msg.content.slice(0, 500)}`);
    if (msg.content.length > 500) {
      lines.push('...(截断)');
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

// ============ ContextRetriever 类 ============

/**
 * ContextRetriever 类
 * 提供高级上下文检索功能
 */
export class ContextRetriever {
  private cache: Map<string, ContextSlice> = new Map();
  
  /**
   * 切片上下文
   */
  slice(thread: ThreadContext, options: ContextSliceOptions): ContextSlice {
    const cacheKey = `${thread.threadId}-${JSON.stringify(options)}`;
    
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const slice = sliceContext(thread, options);
    this.cache.set(cacheKey, slice);
    return slice;
  }
  
  /**
   * 从 Sealed Session 检索
   */
  async retrieveFromSession(
    session: SessionRecord,
    options: ContextSliceOptions
  ): Promise<ContextSlice> {
    return retrieveFromSealedSession(session, options);
  }
  
  /**
   * 混合检索
   */
  async retrieveMixed(
    currentThread: ThreadContext,
    sealedSessions: SessionRecord[],
    options: ContextSliceOptions
  ): Promise<ContextSlice> {
    return retrieveMixedContext(currentThread, sealedSessions, options);
  }
  
  /**
   * 语义搜索
   */
  async search(
    thread: ThreadContext,
    query: string,
    maxResults?: number
  ): Promise<Array<{ message: ThreadMessage; score: number }>> {
    return semanticSearchMessages(thread, { query, maxResults });
  }
  
  /**
   * 提取关键信息
   */
  extractKeyInfo(thread: ThreadContext): ReturnType<typeof extractKeyInformation> {
    return extractKeyInformation(thread);
  }
  
  /**
   * 生成上下文提示
   */
  generatePrompt(slice: ContextSlice): string {
    return generateContextPrompt(slice);
  }
  
  /**
   * 智能选择检索策略
   */
  selectStrategy(thread: ThreadContext): ContextSliceOptions {
    const messageCount = thread.messages.length;
    const userMessageCount = thread.messages.filter(m => m.role === 'user').length;
    
    // 短对话：使用完整上下文
    if (messageCount <= 10) {
      return {
        strategy: 'recent',
        maxMessages: messageCount,
        includeMetadata: true
      };
    }
    
    // 中等长度：使用摘要 + 最近
    if (messageCount <= 50) {
      return {
        strategy: 'summary',
        maxTokens: 50000,
        includeMetadata: true
      };
    }
    
    // 长对话：使用关键决策 + 最近
    return {
      strategy: 'key_decisions',
      maxTokens: 30000,
      maxMessages: 20,
      includeMetadata: true
    };
  }
  
  /**
   * 获取最优上下文
   */
  async getOptimalContext(
    thread: ThreadContext,
    sealedSessions: SessionRecord[] = []
  ): Promise<ContextSlice> {
    if (sealedSessions.length === 0) {
      const options = this.selectStrategy(thread);
      return this.slice(thread, options);
    }
    
    return this.retrieveMixed(thread, sealedSessions, {
      strategy: 'recent',
      maxTokens: 100000
    });
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
