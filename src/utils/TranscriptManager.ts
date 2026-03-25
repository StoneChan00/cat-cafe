/**
 * Transcript Manager
 * 负责 invocation 归档、检索和全生命周期追溯
 * Phase 2 核心组件：支持历史记录查询和 Session Chain
 */

import { mkdir, readFile, writeFile, readdir, appendFile, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { CompleteInvocationRecord, InvocationStats } from '../store/InvocationStore';
import type { AgentRole, InvocationStatus } from '../types';

// ============ 类型定义 ============

/**
 * Transcript 条目（轻量级，用于归档）
 */
export interface TranscriptEntry {
  invocationId: string;
  threadId: string;
  agentId: AgentRole;
  model: string;
  startedAt: string;
  endedAt?: string;
  status: InvocationStatus;
  depth: number;
  parentInvocationId?: string;
  eventCount: number;
  toolUseCount: number;
  publicMessageCount: number;
  durationMs?: number;
}

/**
 * Session 摘要（用于快速浏览）
 */
export interface SessionSummary {
  sessionId: string;
  threadId: string;
  startedAt: string;
  endedAt?: string;
  invocationCount: number;
  agentSequence: AgentRole[];
  totalDurationMs: number;
  finalStatus: InvocationStatus;
}

/**
 * 搜索选项
 */
export interface TranscriptSearchOptions {
  threadId?: string;
  agentId?: AgentRole;
  status?: InvocationStatus;
  startTime?: Date;
  endTime?: Date;
  keyword?: string;
  hasError?: boolean;
  minDurationMs?: number;
  maxDurationMs?: number;
  limit?: number;
}

/**
 * 归档选项
 */
export interface ArchiveOptions {
  compress?: boolean;
  includeEvents?: boolean;
  includeTranscript?: boolean;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getTranscriptDir(): string {
  return join(getDataDir(), 'transcripts');
}

function getSessionDir(): string {
  return join(getDataDir(), 'sessions');
}

function getArchiveDir(): string {
  return join(getDataDir(), 'archives');
}

function getTranscriptFilePath(threadId: string): string {
  return join(getTranscriptDir(), `${threadId}.ndjson`);
}

function getSessionFilePath(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.json`);
}

// ============ 核心函数 ============

/**
 * 归档单个 Invocation 到 Transcript
 */
export async function archiveInvocation(
  invocation: CompleteInvocationRecord
): Promise<TranscriptEntry> {
  const filePath = getTranscriptFilePath(invocation.threadId);
  await mkdir(dirname(filePath), { recursive: true });
  
  const entry: TranscriptEntry = {
    invocationId: invocation.invocationId,
    threadId: invocation.threadId,
    agentId: invocation.agentId,
    model: invocation.model,
    startedAt: invocation.startedAt,
    endedAt: invocation.endedAt,
    status: invocation.status,
    depth: invocation.depth,
    parentInvocationId: invocation.parentInvocationId,
    eventCount: invocation.events.length,
    toolUseCount: invocation.toolUses.length,
    publicMessageCount: invocation.publicMessages.length,
    durationMs: invocation.metrics?.durationMs
  };
  
  // 追加到 NDJSON 文件
  const line = JSON.stringify(entry) + '\n';
  await appendFile(filePath, line, 'utf-8');
  
  return entry;
}

/**
 * 读取 Thread 的 Transcript
 */
export async function readTranscript(threadId: string): Promise<TranscriptEntry[]> {
  const filePath = getTranscriptFilePath(threadId);
  
  try {
    await access(filePath);
  } catch {
    return [];
  }
  
  const entries: TranscriptEntry[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        entries.push(entry);
      } catch {
        // 忽略解析错误的行
      }
    }
  }
  
  return entries.sort((a, b) => 
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
}

/**
 * 流式读取 Transcript（用于大文件）
 */
export async function* streamTranscript(
  threadId: string
): AsyncGenerator<TranscriptEntry, void, unknown> {
  const filePath = getTranscriptFilePath(threadId);
  
  try {
    await access(filePath);
  } catch {
    return;
  }
  
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream });
  
  for await (const line of rl) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        yield entry;
      } catch {
        // 忽略解析错误的行
      }
    }
  }
}

/**
 * 搜索 Transcript
 */
export async function searchTranscripts(
  options: TranscriptSearchOptions = {}
): Promise<TranscriptEntry[]> {
  const transcriptDir = getTranscriptDir();
  const results: TranscriptEntry[] = [];
  
  try {
    const files = await readdir(transcriptDir);
    const ndjsonFiles = files.filter(f => f.endsWith('.ndjson'));
    
    for (const file of ndjsonFiles) {
      const threadId = basename(file, '.ndjson');
      
      // 如果指定了 threadId，只搜索该 thread
      if (options.threadId && threadId !== options.threadId) {
        continue;
      }
      
      // 流式读取，避免内存占用过大
      for await (const entry of streamTranscript(threadId)) {
        // 应用过滤条件
        if (options.agentId && entry.agentId !== options.agentId) continue;
        if (options.status && entry.status !== options.status) continue;
        if (options.hasError !== undefined) {
          const hasError = entry.status === 'failed' || entry.status === 'cancelled';
          if (hasError !== options.hasError) continue;
        }
        
        if (options.startTime) {
          const startedAt = new Date(entry.startedAt);
          if (startedAt < options.startTime) continue;
        }
        
        if (options.endTime) {
          const startedAt = new Date(entry.startedAt);
          if (startedAt > options.endTime) continue;
        }
        
        if (options.minDurationMs !== undefined) {
          if ((entry.durationMs || 0) < options.minDurationMs) continue;
        }
        
        if (options.maxDurationMs !== undefined) {
          if ((entry.durationMs || 0) > options.maxDurationMs) continue;
        }
        
        // 关键词搜索（简单实现，可优化）
        if (options.keyword) {
          const keyword = options.keyword.toLowerCase();
          const searchable = `${entry.agentId} ${entry.model} ${entry.status}`.toLowerCase();
          if (!searchable.includes(keyword)) continue;
        }
        
        results.push(entry);
      }
    }
    
    // 按时间排序
    results.sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    
    // 应用限制
    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }
    
    return results;
    
  } catch {
    return [];
  }
}

/**
 * 获取 Session 摘要
 */
export async function buildSessionSummary(threadId: string): Promise<SessionSummary | null> {
  const entries = await readTranscript(threadId);
  if (entries.length === 0) return null;
  
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  
  const agentSequence = entries.map(e => e.agentId);
  const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  
  // 确定最终状态
  const hasFailed = entries.some(e => e.status === 'failed');
  const hasCancelled = entries.some(e => e.status === 'cancelled');
  const allCompleted = entries.every(e => e.status === 'completed');
  
  let finalStatus: InvocationStatus = 'completed';
  if (hasFailed) finalStatus = 'failed';
  else if (hasCancelled) finalStatus = 'cancelled';
  else if (!allCompleted) finalStatus = 'running';
  
  return {
    sessionId: threadId, // 简化：使用 threadId 作为 sessionId
    threadId,
    startedAt: firstEntry.startedAt,
    endedAt: lastEntry.endedAt,
    invocationCount: entries.length,
    agentSequence,
    totalDurationMs: totalDuration,
    finalStatus
  };
}

/**
 * 导出完整 Session 记录
 */
export async function exportSession(
  threadId: string,
  options: ArchiveOptions = {}
): Promise<{
  threadId: string;
  exportedAt: string;
  summary: SessionSummary | null;
  entries: TranscriptEntry[];
}> {
  const entries = await readTranscript(threadId);
  const summary = await buildSessionSummary(threadId);
  
  const exportData = {
    threadId,
    exportedAt: new Date().toISOString(),
    summary,
    entries
  };
  
  // 可选：保存到归档目录
  if (options.includeTranscript) {
    const archiveDir = getArchiveDir();
    await mkdir(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${threadId}-${Date.now()}.json`);
    await writeFile(archivePath, JSON.stringify(exportData, null, 2), 'utf-8');
  }
  
  return exportData;
}

/**
 * 清理旧 Transcript
 */
export async function cleanupOldTranscripts(
  maxAgeDays: number = 30
): Promise<{ deleted: number; archived: number }> {
  const transcriptDir = getTranscriptDir();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
  
  let deleted = 0;
  let archived = 0;
  
  try {
    const files = await readdir(transcriptDir);
    const ndjsonFiles = files.filter(f => f.endsWith('.ndjson'));
    
    for (const file of ndjsonFiles) {
      const threadId = basename(file, '.ndjson');
      const entries = await readTranscript(threadId);
      
      if (entries.length === 0) continue;
      
      const lastEntry = entries[entries.length - 1];
      const lastActivity = new Date(lastEntry.endedAt || lastEntry.startedAt);
      
      if (lastActivity < cutoffDate) {
        // 归档到归档目录
        await exportSession(threadId, { includeTranscript: true });
        archived++;
        
        // 可选：删除原始文件（此处保留，仅标记为已归档）
        // await unlink(join(transcriptDir, file));
        // deleted++;
      }
    }
    
    return { deleted, archived };
  } catch {
    return { deleted, archived };
  }
}

/**
 * 获取统计信息
 */
export async function getTranscriptStats(): Promise<{
  totalThreads: number;
  totalInvocations: number;
  byAgent: Record<AgentRole, number>;
  byStatus: Record<InvocationStatus, number>;
  averageDurationMs: number;
}> {
  const transcriptDir = getTranscriptDir();
  let totalInvocations = 0;
  const byAgent: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  let threadCount = 0;
  
  try {
    const files = await readdir(transcriptDir);
    const ndjsonFiles = files.filter(f => f.endsWith('.ndjson'));
    threadCount = ndjsonFiles.length;
    
    for (const file of ndjsonFiles) {
      const threadId = basename(file, '.ndjson');
      
      for await (const entry of streamTranscript(threadId)) {
        totalInvocations++;
        
        byAgent[entry.agentId] = (byAgent[entry.agentId] || 0) + 1;
        byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
        
        if (entry.durationMs) {
          totalDuration += entry.durationMs;
          durationCount++;
        }
      }
    }
    
    return {
      totalThreads: threadCount,
      totalInvocations,
      byAgent: byAgent as Record<AgentRole, number>,
      byStatus: byStatus as Record<InvocationStatus, number>,
      averageDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0
    };
  } catch {
    return {
      totalThreads: 0,
      totalInvocations: 0,
      byAgent: {} as Record<AgentRole, number>,
      byStatus: {} as Record<InvocationStatus, number>,
      averageDurationMs: 0
    };
  }
}

// ============ TranscriptManager 类 ============

/**
 * TranscriptManager 类
 * 提供高级 Transcript 管理功能
 */
export class TranscriptManager {
  private cache: Map<string, TranscriptEntry[]> = new Map();
  
  /**
   * 归档 Invocation
   */
  async archive(invocation: CompleteInvocationRecord): Promise<TranscriptEntry> {
    const entry = await archiveInvocation(invocation);
    
    // 更新缓存
    const cached = this.cache.get(invocation.threadId) || [];
    cached.push(entry);
    this.cache.set(invocation.threadId, cached);
    
    return entry;
  }
  
  /**
   * 读取 Transcript
   */
  async read(threadId: string): Promise<TranscriptEntry[]> {
    // 先查缓存
    const cached = this.cache.get(threadId);
    if (cached) return cached;
    
    // 从文件读取
    const entries = await readTranscript(threadId);
    this.cache.set(threadId, entries);
    return entries;
  }
  
  /**
   * 流式读取
   */
  async *stream(threadId: string): AsyncGenerator<TranscriptEntry, void, unknown> {
    yield* streamTranscript(threadId);
  }
  
  /**
   * 搜索
   */
  async search(options: TranscriptSearchOptions = {}): Promise<TranscriptEntry[]> {
    return searchTranscripts(options);
  }
  
  /**
   * 获取 Session 摘要
   */
  async getSessionSummary(threadId: string): Promise<SessionSummary | null> {
    return buildSessionSummary(threadId);
  }
  
  /**
   * 导出 Session
   */
  async export(threadId: string, options: ArchiveOptions = {}): Promise<ReturnType<typeof exportSession>> {
    return exportSession(threadId, options);
  }
  
  /**
   * 清理旧数据
   */
  async cleanup(maxAgeDays: number = 30): Promise<{ deleted: number; archived: number }> {
    return cleanupOldTranscripts(maxAgeDays);
  }
  
  /**
   * 获取统计
   */
  async getStats(): Promise<ReturnType<typeof getTranscriptStats>> {
    return getTranscriptStats();
  }
  
  /**
   * 获取 A2A 调用链
   */
  async getA2AChain(threadId: string, invocationId: string): Promise<TranscriptEntry[]> {
    const entries = await this.read(threadId);
    const chain: TranscriptEntry[] = [];
    
    // 找到目标 invocation
    const target = entries.find(e => e.invocationId === invocationId);
    if (!target) return [];
    
    // 找到根节点
    let current: TranscriptEntry | undefined = target;
    while (current?.parentInvocationId) {
      current = entries.find(e => e.invocationId === current!.parentInvocationId);
    }
    
    // 从根节点开始遍历
    if (current) {
      chain.push(current);
      
      // 递归查找子节点
      const findChildren = (parentId: string) => {
        const children = entries.filter(e => e.parentInvocationId === parentId);
        for (const child of children) {
          chain.push(child);
          findChildren(child.invocationId);
        }
      };
      
      findChildren(current.invocationId);
    }
    
    return chain.sort((a, b) => 
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
  }
  
  /**
   * 获取 Invocation 的上下文（前后各 N 条）
   */
  async getContext(threadId: string, invocationId: string, windowSize: number = 3): Promise<{
    before: TranscriptEntry[];
    current: TranscriptEntry | null;
    after: TranscriptEntry[];
  }> {
    const entries = await this.read(threadId);
    const index = entries.findIndex(e => e.invocationId === invocationId);
    
    if (index === -1) {
      return { before: [], current: null, after: [] };
    }
    
    const start = Math.max(0, index - windowSize);
    const end = Math.min(entries.length, index + windowSize + 1);
    
    return {
      before: entries.slice(start, index),
      current: entries[index],
      after: entries.slice(index + 1, end)
    };
  }
  
  /**
   * 清空缓存
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
