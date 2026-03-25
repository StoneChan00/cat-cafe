/**
 * Session Manager
 * Session 生命周期管理与 Sealing 机制
 * Phase 3 核心组件：处理长链路任务与上下文耗尽
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, readdir, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import type { AgentRole, ThreadContext, ThreadMessage } from '../types';

// ============ 类型定义 ============

/**
 * Session 状态
 */
export type SessionStatus = 'active' | 'sealing' | 'sealed' | 'archived';

/**
 * Session 记录
 */
export interface SessionRecord {
  sessionId: string;
  threadId: string;
  parentSessionId?: string;
  status: SessionStatus;
  
  // 时间线
  createdAt: string;
  lastActiveAt: string;
  sealedAt?: string;
  archivedAt?: string;
  
  // 上下文预算
  contextBudget: {
    maxTokens: number;
    usedTokens: number;
    warningThreshold: number; // 默认 85%
    sealingThreshold: number; // 默认 90%
  };
  
  // 摘要信息（sealing 时生成）
  summary?: {
    keyDecisions: string[];
    openQuestions: string[];
    nextActions: string[];
    criticalContext: string;
  };
  
  // 包含的 invocation 列表
  invocationIds: string[];
  
  // 元数据
  metadata: {
    messageCount: number;
    agentSwitches: AgentRole[];
    totalDurationMs: number;
  };
}

/**
 * Session 创建选项
 */
export interface SessionCreateOptions {
  threadId: string;
  parentSessionId?: string;
  maxTokens?: number;
  warningThreshold?: number;
  sealingThreshold?: number;
}

/**
 * Session 查询选项
 */
export interface SessionQueryOptions {
  threadId?: string;
  status?: SessionStatus;
  parentSessionId?: string;
  includeArchived?: boolean;
  limit?: number;
}

/**
 * Context 使用统计
 */
export interface ContextUsageStats {
  sessionId: string;
  usedTokens: number;
  maxTokens: number;
  usagePercentage: number;
  estimatedRemaining: number;
  shouldSeal: boolean;
  shouldWarn: boolean;
}

/**
 * Sealing 原因
 */
export type SealingReason = 'budget_exhausted' | 'user_request' | 'task_completed' | 'error_recovery' | 'manual';

/**
 * Session 链
 */
export interface SessionChain {
  sessions: SessionRecord[];
  totalSessions: number;
  totalInvocations: number;
  totalDurationMs: number;
  currentSessionId: string;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getSessionsDir(): string {
  return join(getDataDir(), 'sessions');
}

function getSessionFilePath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.json`);
}

function getChainIndexPath(threadId: string): string {
  return join(getSessionsDir(), `chain-${threadId}.json`);
}

// ============ Token 估算工具 ============

/**
 * 估算消息 token 数量（简化版：中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token）
 */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars + otherChars / 4);
}

/**
 * 估算 Thread 上下文 token 使用量
 */
export function estimateThreadContextUsage(thread: ThreadContext): number {
  let totalTokens = 0;
  
  // 系统提示词基础开销
  totalTokens += 500;
  
  // 每条消息的 token
  for (const msg of thread.messages) {
    totalTokens += estimateTokens(msg.content);
    totalTokens += 50; // 消息格式开销
  }
  
  // Worklist 开销
  totalTokens += thread.worklist.length * 100;
  
  return totalTokens;
}

// ============ 核心函数 ============

/**
 * 创建新 Session
 */
export function createSessionRecord(options: SessionCreateOptions): SessionRecord {
  const now = new Date().toISOString();
  
  return {
    sessionId: randomUUID(),
    threadId: options.threadId,
    parentSessionId: options.parentSessionId,
    status: 'active',
    createdAt: now,
    lastActiveAt: now,
    contextBudget: {
      maxTokens: options.maxTokens || 150000,
      usedTokens: 0,
      warningThreshold: options.warningThreshold || 0.85,
      sealingThreshold: options.sealingThreshold || 0.90
    },
    invocationIds: [],
    metadata: {
      messageCount: 0,
      agentSwitches: [],
      totalDurationMs: 0
    }
  };
}

/**
 * 保存 Session
 */
export async function saveSession(session: SessionRecord): Promise<void> {
  const filePath = getSessionFilePath(session.sessionId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * 加载 Session
 */
export async function loadSession(sessionId: string): Promise<SessionRecord | null> {
  try {
    const filePath = getSessionFilePath(sessionId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as SessionRecord;
  } catch {
    return null;
  }
}

/**
 * 更新 Session 上下文使用量
 */
export function updateSessionContextUsage(
  session: SessionRecord,
  thread: ThreadContext
): ContextUsageStats {
  const usedTokens = estimateThreadContextUsage(thread);
  session.contextBudget.usedTokens = usedTokens;
  session.lastActiveAt = new Date().toISOString();
  session.metadata.messageCount = thread.messages.length;
  
  const maxTokens = session.contextBudget.maxTokens;
  const usagePercentage = usedTokens / maxTokens;
  const warningThreshold = session.contextBudget.warningThreshold;
  const sealingThreshold = session.contextBudget.sealingThreshold;
  
  return {
    sessionId: session.sessionId,
    usedTokens,
    maxTokens,
    usagePercentage,
    estimatedRemaining: maxTokens - usedTokens,
    shouldSeal: usagePercentage >= sealingThreshold,
    shouldWarn: usagePercentage >= warningThreshold && usagePercentage < sealingThreshold
  };
}

/**
 * 执行 Sealing
 */
export async function sealSession(
  session: SessionRecord,
  reason: SealingReason,
  summary: SessionRecord['summary']
): Promise<SessionRecord> {
  if (session.status === 'sealed' || session.status === 'archived') {
    throw new Error(`Session ${session.sessionId} is already sealed or archived`);
  }
  
  session.status = 'sealing';
  
  // 生成摘要
  session.summary = summary || {
    keyDecisions: [],
    openQuestions: [],
    nextActions: [],
    criticalContext: ''
  };
  
  session.sealedAt = new Date().toISOString();
  session.status = 'sealed';
  
  await saveSession(session);
  return session;
}

/**
 * 创建新 Session（从已 sealed session 继续）
 */
export async function createNextSession(
  sealedSession: SessionRecord,
  thread: ThreadContext
): Promise<SessionRecord> {
  if (sealedSession.status !== 'sealed') {
    throw new Error('Can only create next session from a sealed session');
  }
  
  const newSession = createSessionRecord({
    threadId: sealedSession.threadId,
    parentSessionId: sealedSession.sessionId,
    maxTokens: sealedSession.contextBudget.maxTokens,
    warningThreshold: sealedSession.contextBudget.warningThreshold,
    sealingThreshold: sealedSession.contextBudget.sealingThreshold
  });
  
  await saveSession(newSession);
  return newSession;
}

/**
 * 查询 Sessions
 */
export async function querySessions(
  options: SessionQueryOptions = {}
): Promise<SessionRecord[]> {
  const sessionsDir = getSessionsDir();
  const sessions: SessionRecord[] = [];
  
  try {
    await access(sessionsDir);
    const files = await readdir(sessionsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('chain-'));
    
    for (const file of jsonFiles) {
      const sessionId = basename(file, '.json');
      const session = await loadSession(sessionId);
      if (!session) continue;
      
      // 应用过滤
      if (options.threadId && session.threadId !== options.threadId) continue;
      if (options.status && session.status !== options.status) continue;
      if (options.parentSessionId && session.parentSessionId !== options.parentSessionId) continue;
      if (!options.includeArchived && session.status === 'archived') continue;
      
      sessions.push(session);
    }
    
    // 按时间排序
    sessions.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    if (options.limit) {
      return sessions.slice(0, options.limit);
    }
    
    return sessions;
  } catch {
    return [];
  }
}

/**
 * 获取 Session 链
 */
export async function getSessionChain(
  threadId: string,
  currentSessionId?: string
): Promise<SessionChain> {
  const sessions = await querySessions({ threadId, includeArchived: true });
  
  // 构建链（从最早到最新）
  const chain = sessions.sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  
  const totalInvocations = chain.reduce((sum, s) => sum + s.invocationIds.length, 0);
  const totalDuration = chain.reduce((sum, s) => sum + s.metadata.totalDurationMs, 0);
  
  // 找到当前 active 或最新的 session
  const current = currentSessionId 
    ? chain.find(s => s.sessionId === currentSessionId)
    : chain.find(s => s.status === 'active') || chain[chain.length - 1];
  
  return {
    sessions: chain,
    totalSessions: chain.length,
    totalInvocations,
    totalDurationMs: totalDuration,
    currentSessionId: current?.sessionId || ''
  };
}

/**
 * 归档 Session
 */
export async function archiveSession(sessionId: string): Promise<SessionRecord | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;
  
  session.status = 'archived';
  session.archivedAt = new Date().toISOString();
  
  await saveSession(session);
  return session;
}

/**
 * 生成 Sealing 建议摘要
 */
export function generateSealingSummary(
  thread: ThreadContext,
  session: SessionRecord
): SessionRecord['summary'] {
  const userMessages = thread.messages.filter(m => m.role === 'user');
  const agentMessages = thread.messages.filter(m => m.role === 'agent');
  
  // 提取关键决策（从 agent 消息中提取包含"决定"/"采用"的内容）
  const keyDecisions = agentMessages
    .filter(m => /决定|采用|选择|方案/.test(m.content))
    .slice(-3)
    .map(m => m.content.slice(0, 100));
  
  // 提取未解决问题
  const openQuestions = agentMessages
    .filter(m => /问题|疑问|待确认|不确定/.test(m.content))
    .slice(-3)
    .map(m => m.content.slice(0, 100));
  
  // 生成关键上下文摘要
  const criticalContext = [
    `Thread 共 ${thread.messages.length} 条消息`,
    `Session 包含 ${session.invocationIds.length} 个 invocation`,
    `当前 Agent: ${session.metadata.agentSwitches[session.metadata.agentSwitches.length - 1] || '未指定'}`
  ].join('; ');
  
  return {
    keyDecisions: keyDecisions.length > 0 ? keyDecisions : ['暂无明确决策'],
    openQuestions: openQuestions.length > 0 ? openQuestions : ['暂无未解决问题'],
    nextActions: ['继续下一 Session'],
    criticalContext
  };
}

// ============ SessionManager 类 ============

/**
 * SessionManager 类
 * 提供高级 Session 管理功能
 */
export class SessionManager {
  private activeSessions: Map<string, SessionRecord> = new Map();
  
  /**
   * 创建新 Session
   */
  create(options: SessionCreateOptions): SessionRecord {
    const session = createSessionRecord(options);
    this.activeSessions.set(session.sessionId, session);
    return session;
  }
  
  /**
   * 获取 Session
   */
  async get(sessionId: string): Promise<SessionRecord | null> {
    const cached = this.activeSessions.get(sessionId);
    if (cached) return cached;
    return loadSession(sessionId);
  }
  
  /**
   * 保存 Session
   */
  async save(session: SessionRecord): Promise<void> {
    this.activeSessions.set(session.sessionId, session);
    await saveSession(session);
  }
  
  /**
   * 更新上下文使用量
   */
  async updateContextUsage(
    sessionId: string,
    thread: ThreadContext
  ): Promise<ContextUsageStats | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    
    const stats = updateSessionContextUsage(session, thread);
    await this.save(session);
    return stats;
  }
  
  /**
   * 检查是否需要 Sealing
   */
  async checkSealingNeeded(sessionId: string): Promise<{
    needed: boolean;
    reason?: SealingReason;
    stats?: ContextUsageStats;
  }> {
    const session = await this.get(sessionId);
    if (!session) return { needed: false };
    
    const usagePercentage = session.contextBudget.usedTokens / session.contextBudget.maxTokens;
    
    if (usagePercentage >= session.contextBudget.sealingThreshold) {
      return {
        needed: true,
        reason: 'budget_exhausted',
        stats: {
          sessionId: session.sessionId,
          usedTokens: session.contextBudget.usedTokens,
          maxTokens: session.contextBudget.maxTokens,
          usagePercentage,
          estimatedRemaining: session.contextBudget.maxTokens - session.contextBudget.usedTokens,
          shouldSeal: true,
          shouldWarn: false
        }
      };
    }
    
    return { needed: false };
  }
  
  /**
   * 执行 Sealing
   */
  async seal(
    sessionId: string,
    reason: SealingReason,
    thread: ThreadContext
  ): Promise<SessionRecord | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    
    // 生成摘要
    const summary = generateSealingSummary(thread, session);
    
    const sealed = await sealSession(session, reason, summary);
    this.activeSessions.delete(sessionId);
    
    return sealed;
  }
  
  /**
   * 创建下一个 Session
   */
  async createNext(
    sealedSessionId: string,
    thread: ThreadContext
  ): Promise<SessionRecord | null> {
    const sealed = await this.get(sealedSessionId);
    if (!sealed || sealed.status !== 'sealed') return null;
    
    const nextSession = await createNextSession(sealed, thread);
    this.activeSessions.set(nextSession.sessionId, nextSession);
    return nextSession;
  }
  
  /**
   * 添加 Invocation 到 Session
   */
  async addInvocation(
    sessionId: string,
    invocationId: string,
    agentId: AgentRole
  ): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;
    
    session.invocationIds.push(invocationId);
    
    // 记录 Agent 切换
    const lastAgent = session.metadata.agentSwitches[session.metadata.agentSwitches.length - 1];
    if (lastAgent !== agentId) {
      session.metadata.agentSwitches.push(agentId);
    }
    
    await this.save(session);
    return true;
  }
  
  /**
   * 查询 Sessions
   */
  async query(options: SessionQueryOptions = {}): Promise<SessionRecord[]> {
    return querySessions(options);
  }
  
  /**
   * 获取 Session 链
   */
  async getChain(threadId: string): Promise<SessionChain> {
    return getSessionChain(threadId);
  }
  
  /**
   * 归档 Session
   */
  async archive(sessionId: string): Promise<SessionRecord | null> {
    const archived = await archiveSession(sessionId);
    if (archived) {
      this.activeSessions.delete(sessionId);
    }
    return archived;
  }
  
  /**
   * 获取统计信息
   */
  async getStats(threadId: string): Promise<{
    totalSessions: number;
    activeSessions: number;
    sealedSessions: number;
    totalInvocations: number;
    averageContextUsage: number;
  }> {
    const sessions = await this.query({ threadId, includeArchived: true });
    
    const totalInvocations = sessions.reduce((sum, s) => sum + s.invocationIds.length, 0);
    const totalUsage = sessions.reduce((sum, s) => 
      sum + (s.contextBudget.usedTokens / s.contextBudget.maxTokens), 0
    );
    
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      sealedSessions: sessions.filter(s => s.status === 'sealed').length,
      totalInvocations,
      averageContextUsage: sessions.length > 0 ? totalUsage / sessions.length : 0
    };
  }
  
  /**
   * 获取当前 active 的 Session
   */
  async getActiveSession(threadId: string): Promise<SessionRecord | null> {
    const sessions = await this.query({ threadId, status: 'active' });
    return sessions[0] || null;
  }
  
  /**
   * 清理缓存
   */
  clearCache(): void {
    this.activeSessions.clear();
  }
  
  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.activeSessions.size;
  }
}
