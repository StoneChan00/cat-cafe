/**
 * Session Search
 * Session 搜索工具
 * Phase 3 核心组件：支持跨 Session 历史检索
 */

import { access, readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { SessionRecord, SessionStatus } from './SessionManager';
import type { AgentRole } from '../types';

// ============ 类型定义 ============

/**
 * Session 搜索选项
 */
export interface SessionSearchOptions {
  threadId?: string;
  agentId?: AgentRole;
  status?: SessionStatus;
  keyword?: string;
  startDate?: Date;
  endDate?: Date;
  hasSummary?: boolean;
  invocationCount?: {
    min?: number;
    max?: number;
  };
  contextUsage?: {
    minPercentage?: number;
    maxPercentage?: number;
  };
  limit?: number;
  offset?: number;
}

/**
 * Session 搜索结果
 */
export interface SessionSearchResult {
  session: SessionRecord;
  relevanceScore: number;
  matchReasons: string[];
}

/**
 * 消息搜索选项
 */
export interface MessageSearchOptions {
  threadId: string;
  keyword: string;
  agentId?: AgentRole;
  role?: 'user' | 'agent';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

/**
 * 消息搜索结果
 */
export interface MessageSearchResult {
  sessionId: string;
  messageId: string;
  role: string;
  agentId?: AgentRole;
  content: string;
  timestamp: string;
  relevanceScore: number;
}

/**
 * Session 时间线
 */
export interface SessionTimeline {
  sessions: Array<{
    sessionId: string;
    status: SessionStatus;
    startedAt: string;
    endedAt?: string;
    durationMs: number;
    invocationCount: number;
    contextUsagePercentage: number;
  }>;
  totalDurationMs: number;
  totalInvocations: number;
  averageContextUsage: number;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getSessionsDir(): string {
  return join(getDataDir(), 'sessions');
}

function getTranscriptDir(): string {
  return join(getDataDir(), 'transcripts');
}

function getSessionFilePath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.json`);
}

// ============ 核心函数 ============

/**
 * 搜索 Sessions
 */
export async function searchSessions(
  options: SessionSearchOptions = {}
): Promise<SessionSearchResult[]> {
  const sessionsDir = getSessionsDir();
  const results: SessionSearchResult[] = [];
  
  try {
    await access(sessionsDir);
    const files = await readdir(sessionsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('chain-'));
    
    for (const file of jsonFiles) {
      const sessionId = basename(file, '.json');
      
      try {
        const content = await readFile(join(sessionsDir, file), 'utf-8');
        const session: SessionRecord = JSON.parse(content);
        
        let relevanceScore = 0;
        const matchReasons: string[] = [];
        
        // Thread ID 过滤
        if (options.threadId && session.threadId !== options.threadId) {
          continue;
        }
        
        // Agent ID 过滤
        if (options.agentId) {
          const hasAgent = session.metadata.agentSwitches.includes(options.agentId);
          if (!hasAgent) continue;
          relevanceScore += 5;
          matchReasons.push(`包含 Agent ${options.agentId}`);
        }
        
        // 状态过滤
        if (options.status && session.status !== options.status) {
          continue;
        }
        
        // 关键词搜索
        if (options.keyword) {
          const keyword = options.keyword.toLowerCase();
          const inSummary = session.summary?.criticalContext?.toLowerCase().includes(keyword);
          const inDecisions = session.summary?.keyDecisions.some(d => 
            d.toLowerCase().includes(keyword)
          );
          
          if (inSummary || inDecisions) {
            relevanceScore += 10;
            matchReasons.push('关键词匹配摘要');
          }
        }
        
        // 日期过滤
        if (options.startDate) {
          const createdAt = new Date(session.createdAt);
          if (createdAt < options.startDate) continue;
        }
        
        if (options.endDate) {
          const createdAt = new Date(session.createdAt);
          if (createdAt > options.endDate) continue;
        }
        
        // 是否有摘要
        if (options.hasSummary !== undefined) {
          const hasSummary = !!session.summary;
          if (hasSummary !== options.hasSummary) continue;
          if (hasSummary) {
            relevanceScore += 3;
            matchReasons.push('包含摘要');
          }
        }
        
        // Invocation 数量过滤
        if (options.invocationCount) {
          const count = session.invocationIds.length;
          if (options.invocationCount.min && count < options.invocationCount.min) continue;
          if (options.invocationCount.max && count > options.invocationCount.max) continue;
        }
        
        // 上下文使用率过滤
        if (options.contextUsage) {
          const usage = session.contextBudget.usedTokens / session.contextBudget.maxTokens;
          if (options.contextUsage.minPercentage && usage < options.contextUsage.minPercentage) {
            continue;
          }
          if (options.contextUsage.maxPercentage && usage > options.contextUsage.maxPercentage) {
            continue;
          }
        }
        
        // 基础分数
        relevanceScore += 1;
        
        results.push({
          session,
          relevanceScore,
          matchReasons: matchReasons.length > 0 ? matchReasons : ['基本匹配']
        });
      } catch {
        // 解析失败，跳过
      }
    }
    
    // 排序
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // 分页
    const offset = options.offset || 0;
    const limit = options.limit || results.length;
    return results.slice(offset, offset + limit);
    
  } catch {
    return [];
  }
}

/**
 * 搜索消息
 */
export async function searchMessages(
  options: MessageSearchOptions
): Promise<MessageSearchResult[]> {
  const results: MessageSearchResult[] = [];
  const keyword = options.keyword.toLowerCase();
  
  // 从 transcript 搜索
  const transcriptDir = getTranscriptDir();
  
  try {
    await access(transcriptDir);
    const files = await readdir(transcriptDir);
    const ndjsonFiles = files.filter(f => f.endsWith('.ndjson'));
    
    for (const file of ndjsonFiles) {
      const threadId = basename(file, '.ndjson');
      
      // Thread ID 过滤
      if (options.threadId && threadId !== options.threadId) {
        continue;
      }
      
      const filePath = join(transcriptDir, file);
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream });
      
      for await (const line of rl) {
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          
          // Agent 过滤
          if (options.agentId && entry.agentId !== options.agentId) continue;
          
          // 角色过滤
          if (options.role && entry.role !== options.role) continue;
          
          // 关键词搜索（这里简化处理，实际应该加载完整消息）
          if (entry.content && entry.content.toLowerCase().includes(keyword)) {
            results.push({
              sessionId: entry.invocationId,
              messageId: entry.invocationId,
              role: entry.agentId ? 'agent' : 'user',
              agentId: entry.agentId,
              content: entry.content.substring(0, 200),
              timestamp: entry.startedAt,
              relevanceScore: 1
            });
          }
        } catch {
          // 解析失败，跳过
        }
      }
    }
  } catch {
    // 目录不存在
  }
  
  // 排序和限制
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results.slice(0, options.limit || 50);
}

/**
 * 获取 Session 时间线
 */
export async function getSessionTimeline(threadId: string): Promise<SessionTimeline> {
  const sessions = await searchSessions({ threadId });
  
  const timeline = sessions.map(result => {
    const session = result.session;
    const startedAt = new Date(session.createdAt);
    const endedAt = session.sealedAt ? new Date(session.sealedAt) : null;
    const durationMs = endedAt 
      ? endedAt.getTime() - startedAt.getTime()
      : Date.now() - startedAt.getTime();
    
    return {
      sessionId: session.sessionId,
      status: session.status,
      startedAt: session.createdAt,
      endedAt: session.sealedAt,
      durationMs,
      invocationCount: session.invocationIds.length,
      contextUsagePercentage: Math.round(
        (session.contextBudget.usedTokens / session.contextBudget.maxTokens) * 100
      )
    };
  });
  
  // 排序
  timeline.sort((a, b) => 
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  
  const totalDurationMs = timeline.reduce((sum, t) => sum + t.durationMs, 0);
  const totalInvocations = timeline.reduce((sum, t) => sum + t.invocationCount, 0);
  const averageContextUsage = timeline.length > 0
    ? Math.round(timeline.reduce((sum, t) => sum + t.contextUsagePercentage, 0) / timeline.length)
    : 0;
  
  return {
    sessions: timeline,
    totalDurationMs,
    totalInvocations,
    averageContextUsage
  };
}

/**
 * 查找相似 Session
 */
export async function findSimilarSessions(
  sessionId: string,
  limit: number = 5
): Promise<SessionSearchResult[]> {
  // 加载目标 Session
  const targetSession = await searchSessions({ limit: 1 })
    .then(results => results.find(r => r.session.sessionId === sessionId)?.session);
  
  if (!targetSession) return [];
  
  const allSessions = await searchSessions({
    threadId: targetSession.threadId,
    limit: 100
  });
  
  const scored = allSessions
    .filter(r => r.session.sessionId !== sessionId)
    .map(result => {
      const session = result.session;
      let score = 0;
      const reasons: string[] = [];
      
      // Agent 重叠
      const commonAgents = session.metadata.agentSwitches.filter(a => 
        targetSession.metadata.agentSwitches.includes(a)
      );
      score += commonAgents.length * 2;
      if (commonAgents.length > 0) {
        reasons.push(`共同 Agent: ${commonAgents.join(', ')}`);
      }
      
      // 相似的消息数
      const msgDiff = Math.abs(
        session.metadata.messageCount - targetSession.metadata.messageCount
      );
      if (msgDiff < 5) {
        score += 3;
        reasons.push('相似的消息数量');
      }
      
      // 相似的上下文使用
      const usage1 = session.contextBudget.usedTokens / session.contextBudget.maxTokens;
      const usage2 = targetSession.contextBudget.usedTokens / targetSession.contextBudget.maxTokens;
      if (Math.abs(usage1 - usage2) < 0.1) {
        score += 2;
        reasons.push('相似的上下文使用率');
      }
      
      return {
        session,
        relevanceScore: score,
        matchReasons: reasons.length > 0 ? reasons : ['结构相似']
      };
    });
  
  return scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

/**
 * 生成搜索报告
 */
export async function generateSearchReport(
  options: SessionSearchOptions
): Promise<string> {
  const results = await searchSessions(options);
  
  const lines: string[] = [];
  lines.push('## Session 搜索报告');
  lines.push('');
  lines.push(`搜索条件: ${JSON.stringify(options)}`);
  lines.push(`找到结果: ${results.length} 个 Session`);
  lines.push('');
  
  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const result = results[i];
    const session = result.session;
    
    lines.push(`### ${i + 1}. ${session.sessionId}`);
    lines.push(`- Thread: ${session.threadId}`);
    lines.push(`- 状态: ${session.status}`);
    lines.push(`- Invocation 数: ${session.invocationIds.length}`);
    lines.push(`- 上下文使用: ${Math.round(
      (session.contextBudget.usedTokens / session.contextBudget.maxTokens) * 100
    )}%`);
    lines.push(`- 相关度: ${result.relevanceScore}`);
    lines.push(`- 匹配原因: ${result.matchReasons.join(', ')}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

// ============ SessionSearch 类 ============

/**
 * SessionSearch 类
 * 提供高级 Session 搜索功能
 */
export class SessionSearch {
  private cache: Map<string, SessionSearchResult[]> = new Map();
  
  /**
   * 搜索 Sessions
   */
  async search(options: SessionSearchOptions): Promise<SessionSearchResult[]> {
    const cacheKey = JSON.stringify(options);
    
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    const results = await searchSessions(options);
    this.cache.set(cacheKey, results);
    return results;
  }
  
  /**
   * 搜索消息
   */
  async searchMessages(options: MessageSearchOptions): Promise<MessageSearchResult[]> {
    return searchMessages(options);
  }
  
  /**
   * 获取时间线
   */
  async getTimeline(threadId: string): Promise<SessionTimeline> {
    return getSessionTimeline(threadId);
  }
  
  /**
   * 查找相似 Session
   */
  async findSimilar(sessionId: string, limit?: number): Promise<SessionSearchResult[]> {
    return findSimilarSessions(sessionId, limit);
  }
  
  /**
   * 生成报告
   */
  async generateReport(options: SessionSearchOptions): Promise<string> {
    return generateSearchReport(options);
  }
  
  /**
   * 获取统计
   */
  async getStats(threadId?: string): Promise<{
    totalSessions: number;
    byStatus: Record<SessionStatus, number>;
    averageInvocations: number;
    averageContextUsage: number;
  }> {
    const sessions = await this.search({ threadId, limit: 1000 });
    
    const byStatus: Partial<Record<SessionStatus, number>> = {};
    let totalInvocations = 0;
    let totalContextUsage = 0;
    
    for (const result of sessions) {
      const session = result.session;
      byStatus[session.status] = (byStatus[session.status] || 0) + 1;
      totalInvocations += session.invocationIds.length;
      totalContextUsage += session.contextBudget.usedTokens / session.contextBudget.maxTokens;
    }
    
    return {
      totalSessions: sessions.length,
      byStatus: byStatus as Record<SessionStatus, number>,
      averageInvocations: sessions.length > 0 ? totalInvocations / sessions.length : 0,
      averageContextUsage: sessions.length > 0 ? totalContextUsage / sessions.length : 0
    };
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
