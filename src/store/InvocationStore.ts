/**
 * Invocation Store
 * 负责管理 invocation 的持久化和全生命周期追溯
 * Phase 2 核心组件：支持 transcript 归档和调用链追踪
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, readdir, appendFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { AgentRole, RunnerEvent, InvocationRecord, InvocationStatus } from '../types';

// ============ 类型扩展 ============

/**
 * 完整 Invocation 记录（包含事件流）
 */
export interface CompleteInvocationRecord {
  // 基础信息
  invocationId: string;
  threadId: string;
  agentId: AgentRole;
  model: string;
  
  // 时间线
  startedAt: string;
  endedAt?: string;
  
  // 状态
  status: InvocationStatus;
  error?: string;
  terminateReason?: string;
  
  // 输入
  prompt: string;
  workingDirectory?: string;
  
  // 完整事件流（用于追溯）
  events: RunnerEvent[];
  
  // 工具调用记录
  toolUses: Array<{
    tool: string;
    status: string;
    timestamp: string;
    input?: unknown;
    output?: unknown;
  }>;
  
  // 输出
  finalText?: string;
  publicMessages: string[];
  
  // A2A 链追踪
  parentInvocationId?: string;
  depth: number;
  
  // 性能指标
  metrics?: {
    durationMs: number;
    eventCount: number;
    textLength: number;
  };
}

/**
 * Invocation 查询选项
 */
export interface InvocationQueryOptions {
  threadId?: string;
  agentId?: AgentRole;
  status?: InvocationStatus;
  startTime?: Date;
  endTime?: Date;
  parentInvocationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Invocation 统计信息
 */
export interface InvocationStats {
  totalCount: number;
  byStatus: Record<InvocationStatus, number>;
  byAgent: Record<AgentRole, number>;
  averageDurationMs: number;
  totalEvents: number;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getInvocationsDir(): string {
  return join(getDataDir(), 'invocations');
}

function getInvocationFilePath(invocationId: string): string {
  return join(getInvocationsDir(), `${invocationId}.json`);
}

function getTranscriptFilePath(threadId: string): string {
  return join(getInvocationsDir(), 'transcripts', `${threadId}.ndjson`);
}

// ============ 核心函数 ============

/**
 * 创建新的 Invocation 记录
 */
export function createInvocationRecord(
  threadId: string,
  agentId: AgentRole,
  model: string,
  prompt: string,
  options?: {
    workingDirectory?: string;
    parentInvocationId?: string;
    depth?: number;
  }
): CompleteInvocationRecord {
  return {
    invocationId: randomUUID(),
    threadId,
    agentId,
    model,
    startedAt: new Date().toISOString(),
    status: 'pending',
    prompt,
    workingDirectory: options?.workingDirectory,
    events: [],
    toolUses: [],
    publicMessages: [],
    parentInvocationId: options?.parentInvocationId,
    depth: options?.depth || 0
  };
}

/**
 * 保存 Invocation 到文件
 */
export async function saveInvocation(invocation: CompleteInvocationRecord): Promise<void> {
  const filePath = getInvocationFilePath(invocation.invocationId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(invocation, null, 2), 'utf-8');
}

/**
 * 加载 Invocation 记录
 */
export async function loadInvocation(invocationId: string): Promise<CompleteInvocationRecord | null> {
  try {
    const filePath = getInvocationFilePath(invocationId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as CompleteInvocationRecord;
  } catch {
    return null;
  }
}

/**
 * 添加事件到 Invocation
 */
export async function addEventToInvocation(
  invocationId: string,
  event: RunnerEvent
): Promise<boolean> {
  const invocation = await loadInvocation(invocationId);
  if (!invocation) return false;
  
  invocation.events.push(event);
  
  // 如果是工具调用事件，同时记录到 toolUses
  if (event.type === 'tool_use' && event.part?.tool) {
    invocation.toolUses.push({
      tool: event.part.tool,
      status: event.part.state?.status || 'unknown',
      timestamp: new Date().toISOString(),
      input: event.part.state?.input,
      output: event.part.state?.output
    });
  }
  
  await saveInvocation(invocation);
  return true;
}

/**
 * 更新 Invocation 状态
 */
export async function updateInvocationStatus(
  invocationId: string,
  status: InvocationStatus,
  options?: {
    error?: string;
    finalText?: string;
    terminateReason?: string;
  }
): Promise<boolean> {
  const invocation = await loadInvocation(invocationId);
  if (!invocation) return false;
  
  invocation.status = status;
  invocation.endedAt = new Date().toISOString();
  
  if (options?.error) {
    invocation.error = options.error;
  }
  
  if (options?.finalText) {
    invocation.finalText = options.finalText;
  }
  
  if (options?.terminateReason) {
    invocation.terminateReason = options.terminateReason;
  }
  
  // 计算性能指标
  if (invocation.startedAt && invocation.endedAt) {
    const durationMs = new Date(invocation.endedAt).getTime() - new Date(invocation.startedAt).getTime();
    invocation.metrics = {
      durationMs,
      eventCount: invocation.events.length,
      textLength: invocation.finalText?.length || 0
    };
  }
  
  await saveInvocation(invocation);
  return true;
}

/**
 * 添加公开消息到 Invocation
 */
export async function addPublicMessageToInvocation(
  invocationId: string,
  message: string
): Promise<boolean> {
  const invocation = await loadInvocation(invocationId);
  if (!invocation) return false;
  
  invocation.publicMessages.push(message);
  await saveInvocation(invocation);
  return true;
}

/**
 * 归档 Transcript（NDJSON 格式，便于追加和流式读取）
 */
export async function archiveTranscript(
  threadId: string,
  invocation: CompleteInvocationRecord
): Promise<void> {
  const filePath = getTranscriptFilePath(threadId);
  await mkdir(dirname(filePath), { recursive: true });
  
  // 构建 transcript 条目
  const transcriptEntry = {
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
    metrics: invocation.metrics
  };
  
  // 追加到 NDJSON 文件
  const line = JSON.stringify(transcriptEntry) + '\n';
  await appendFile(filePath, line, 'utf-8');
}

/**
 * 查询 Invocations
 */
export async function queryInvocations(
  options: InvocationQueryOptions = {}
): Promise<CompleteInvocationRecord[]> {
  const invocationsDir = getInvocationsDir();
  
  try {
    const files = await readdir(invocationsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('transcript'));
    
    const invocations: CompleteInvocationRecord[] = [];
    
    for (const file of jsonFiles) {
      const invocationId = file.replace('.json', '');
      const invocation = await loadInvocation(invocationId);
      if (!invocation) continue;
      
      // 应用过滤条件
      if (options.threadId && invocation.threadId !== options.threadId) continue;
      if (options.agentId && invocation.agentId !== options.agentId) continue;
      if (options.status && invocation.status !== options.status) continue;
      if (options.parentInvocationId && invocation.parentInvocationId !== options.parentInvocationId) continue;
      
      if (options.startTime) {
        const startedAt = new Date(invocation.startedAt);
        if (startedAt < options.startTime) continue;
      }
      
      if (options.endTime) {
        const startedAt = new Date(invocation.startedAt);
        if (startedAt > options.endTime) continue;
      }
      
      invocations.push(invocation);
    }
    
    // 按时间排序（最新的在前）
    invocations.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    
    // 应用分页
    const offset = options.offset || 0;
    const limit = options.limit || invocations.length;
    return invocations.slice(offset, offset + limit);
    
  } catch {
    return [];
  }
}

/**
 * 获取 Invocation 统计信息
 */
export async function getInvocationStats(threadId?: string): Promise<InvocationStats> {
  const invocations = await queryInvocations({ threadId });
  
  const byStatus: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  let totalEvents = 0;
  
  for (const inv of invocations) {
    // 状态统计
    byStatus[inv.status] = (byStatus[inv.status] || 0) + 1;
    
    // Agent 统计
    byAgent[inv.agentId] = (byAgent[inv.agentId] || 0) + 1;
    
    // 持续时间统计
    if (inv.metrics?.durationMs) {
      totalDuration += inv.metrics.durationMs;
      durationCount++;
    }
    
    // 事件统计
    totalEvents += inv.events.length;
  }
  
  return {
    totalCount: invocations.length,
    byStatus: byStatus as Record<InvocationStatus, number>,
    byAgent: byAgent as Record<AgentRole, number>,
    averageDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    totalEvents
  };
}

/**
 * 获取 A2A 调用链
 */
export async function getA2AChain(invocationId: string): Promise<CompleteInvocationRecord[]> {
  const chain: CompleteInvocationRecord[] = [];
  
  // 先找到根节点
  let current = await loadInvocation(invocationId);
  while (current?.parentInvocationId) {
    current = await loadInvocation(current.parentInvocationId);
  }
  
  // 从根节点开始遍历
  if (current) {
    chain.push(current);
    
    // 查找子节点
    const children = await queryInvocations({ parentInvocationId: current.invocationId });
    for (const child of children) {
      const childChain = await getA2AChain(child.invocationId);
      chain.push(...childChain.slice(1)); // 避免重复添加当前节点
    }
  }
  
  return chain.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

/**
 * 导出 Thread 的完整记录（用于调试和审计）
 */
export async function exportThreadAuditLog(threadId: string): Promise<{
  threadId: string;
  exportedAt: string;
  invocations: CompleteInvocationRecord[];
  stats: InvocationStats;
}> {
  const invocations = await queryInvocations({ threadId });
  const stats = await getInvocationStats(threadId);
  
  return {
    threadId,
    exportedAt: new Date().toISOString(),
    invocations,
    stats
  };
}

// ============ InvocationStore 类 ============

/**
 * InvocationStore 类
 * 提供高级 Invocation 管理功能
 */
export class InvocationStore {
  private cache: Map<string, CompleteInvocationRecord> = new Map();
  private transcriptCache: Map<string, string[]> = new Map();
  
  /**
   * 创建新的 Invocation
   */
  create(
    threadId: string,
    agentId: AgentRole,
    model: string,
    prompt: string,
    options?: {
      workingDirectory?: string;
      parentInvocationId?: string;
      depth?: number;
    }
  ): CompleteInvocationRecord {
    const invocation = createInvocationRecord(threadId, agentId, model, prompt, options);
    this.cache.set(invocation.invocationId, invocation);
    return invocation;
  }
  
  /**
   * 获取 Invocation
   */
  async get(invocationId: string): Promise<CompleteInvocationRecord | null> {
    // 先查缓存
    const cached = this.cache.get(invocationId);
    if (cached) return cached;
    
    // 再从文件加载
    const invocation = await loadInvocation(invocationId);
    if (invocation) {
      this.cache.set(invocationId, invocation);
    }
    return invocation;
  }
  
  /**
   * 保存 Invocation
   */
  async save(invocation: CompleteInvocationRecord): Promise<void> {
    this.cache.set(invocation.invocationId, invocation);
    await saveInvocation(invocation);
  }
  
  /**
   * 添加事件
   */
  async addEvent(invocationId: string, event: RunnerEvent): Promise<boolean> {
    const invocation = await this.get(invocationId);
    if (!invocation) return false;
    
    invocation.events.push(event);
    
    if (event.type === 'tool_use' && event.part?.tool) {
      invocation.toolUses.push({
        tool: event.part.tool,
        status: event.part.state?.status || 'unknown',
        timestamp: new Date().toISOString(),
        input: event.part.state?.input,
        output: event.part.state?.output
      });
    }
    
    await this.save(invocation);
    return true;
  }
  
  /**
   * 更新状态
   */
  async updateStatus(
    invocationId: string,
    status: InvocationStatus,
    options?: {
      error?: string;
      finalText?: string;
      terminateReason?: string;
    }
  ): Promise<boolean> {
    const invocation = await this.get(invocationId);
    if (!invocation) return false;
    
    invocation.status = status;
    invocation.endedAt = new Date().toISOString();
    
    if (options?.error) invocation.error = options.error;
    if (options?.finalText) invocation.finalText = options.finalText;
    if (options?.terminateReason) invocation.terminateReason = options.terminateReason;
    
    // 计算性能指标
    if (invocation.startedAt && invocation.endedAt) {
      const durationMs = new Date(invocation.endedAt).getTime() - new Date(invocation.startedAt).getTime();
      invocation.metrics = {
        durationMs,
        eventCount: invocation.events.length,
        textLength: invocation.finalText?.length || 0
      };
    }
    
    await this.save(invocation);
    
    // 完成后归档到 transcript
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      await archiveTranscript(invocation.threadId, invocation);
    }
    
    return true;
  }
  
  /**
   * 添加公开消息
   */
  async addPublicMessage(invocationId: string, message: string): Promise<boolean> {
    const invocation = await this.get(invocationId);
    if (!invocation) return false;
    
    invocation.publicMessages.push(message);
    await this.save(invocation);
    return true;
  }
  
  /**
   * 查询
   */
  async query(options: InvocationQueryOptions = {}): Promise<CompleteInvocationRecord[]> {
    return queryInvocations(options);
  }
  
  /**
   * 获取统计
   */
  async getStats(threadId?: string): Promise<InvocationStats> {
    return getInvocationStats(threadId);
  }
  
  /**
   * 获取 A2A 链
   */
  async getChain(invocationId: string): Promise<CompleteInvocationRecord[]> {
    return getA2AChain(invocationId);
  }
  
  /**
   * 导出审计日志
   */
  async exportAuditLog(threadId: string): Promise<ReturnType<typeof exportThreadAuditLog>> {
    return exportThreadAuditLog(threadId);
  }
  
  /**
   * 获取缓存的 Invocation 数量
   */
  getCacheSize(): number {
    return this.cache.size;
  }
  
  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}
