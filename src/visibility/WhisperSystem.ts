/**
 * Whisper System
 * 私聊/Whisper 系统
 * Phase 4 核心组件：支持私密消息和定向通信
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, readdir, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import type { AgentRole } from '../types';

// ============ 类型定义 ============

/**
 * 消息可见性
 */
export type MessageVisibility = 'public' | 'private' | 'whisper';

/**
 * Whisper 消息
 */
export interface WhisperMessage {
  id: string;
  threadId: string;
  sessionId?: string;
  
  // 发送者
  from: {
    type: 'user' | 'agent';
    id?: string; // agentId 如果是 agent
    name: string;
  };
  
  // 接收者
  to: {
    type: 'user' | 'agent' | 'agents';
    id?: string;
    agentIds?: AgentRole[]; // 多个 agent
  };
  
  // 内容
  content: string;
  visibility: MessageVisibility;
  
  // 时间戳
  timestamp: string;
  
  // 元数据
  metadata?: {
    replyTo?: string; // 回复的消息 ID
    expiresAt?: string; // 过期时间
    autoDelete?: boolean;
  };
}

/**
 * 可见性规则
 */
export interface VisibilityRule {
  id: string;
  name: string;
  description: string;
  
  // 谁可以发送
  allowFrom: Array<'user' | 'agent'>;
  
  // 谁可以接收
  allowTo: Array<'user' | 'agent'>;
  
  // 条件
  conditions?: {
    minAgentTrust?: number;
    requireApproval?: boolean;
    maxRecipients?: number;
  };
}

/**
 * 消息过滤器
 */
export interface MessageFilter {
  threadId?: string;
  visibility?: MessageVisibility;
  fromType?: 'user' | 'agent';
  toType?: 'user' | 'agent';
  agentId?: AgentRole;
  since?: Date;
  until?: Date;
  includeExpired?: boolean;
}

/**
 * 可见性上下文
 */
export interface VisibilityContext {
  threadId: string;
  currentUser: string;
  currentAgent?: AgentRole;
  participantAgents: AgentRole[];
  allowedVisibility: MessageVisibility[];
}

/**
 * 可见性检查结果
 */
export interface VisibilityCheckResult {
  canSee: boolean;
  canReply: boolean;
  visibility: MessageVisibility;
  reason?: string;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getWhispersDir(): string {
  return join(getDataDir(), 'whispers');
}

function getWhisperFilePath(whisperId: string): string {
  return join(getWhispersDir(), `${whisperId}.json`);
}

function getThreadWhispersDir(threadId: string): string {
  return join(getWhispersDir(), 'by-thread', threadId);
}

// ============ 默认规则 ============

const DEFAULT_VISIBILITY_RULES: VisibilityRule[] = [
  {
    id: 'public',
    name: '公开消息',
    description: '所有参与者可见',
    allowFrom: ['user', 'agent'],
    allowTo: ['user', 'agent']
  },
  {
    id: 'private',
    name: '私聊消息',
    description: '仅发送者和接收者可见',
    allowFrom: ['user', 'agent'],
    allowTo: ['user', 'agent'],
    conditions: {
      maxRecipients: 1
    }
  },
  {
    id: 'whisper',
    name: '耳语消息',
    description: '临时私密消息，可自动删除',
    allowFrom: ['user', 'agent'],
    allowTo: ['user', 'agent'],
    conditions: {
      requireApproval: false,
      maxRecipients: 5
    }
  }
];

// ============ 核心函数 ============

/**
 * 创建 Whisper 消息
 */
export function createWhisperMessage(
  threadId: string,
  from: WhisperMessage['from'],
  to: WhisperMessage['to'],
  content: string,
  visibility: MessageVisibility = 'whisper',
  metadata?: WhisperMessage['metadata']
): WhisperMessage {
  return {
    id: randomUUID(),
    threadId,
    from,
    to,
    content,
    visibility,
    timestamp: new Date().toISOString(),
    metadata
  };
}

/**
 * 保存 Whisper 消息
 */
export async function saveWhisperMessage(message: WhisperMessage): Promise<void> {
  const filePath = getWhisperFilePath(message.id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(message, null, 2), 'utf-8');
  
  // 同时保存到 thread 目录便于查询
  const threadDir = getThreadWhispersDir(message.threadId);
  await mkdir(threadDir, { recursive: true });
  const threadFilePath = join(threadDir, `${message.id}.json`);
  await writeFile(threadFilePath, JSON.stringify(message, null, 2), 'utf-8');
}

/**
 * 加载 Whisper 消息
 */
export async function loadWhisperMessage(whisperId: string): Promise<WhisperMessage | null> {
  try {
    const filePath = getWhisperFilePath(whisperId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as WhisperMessage;
  } catch {
    return null;
  }
}

/**
 * 检查可见性
 */
export function checkVisibility(
  message: WhisperMessage,
  context: VisibilityContext
): VisibilityCheckResult {
  // 公开消息所有人可见
  if (message.visibility === 'public') {
    return {
      canSee: true,
      canReply: true,
      visibility: 'public'
    };
  }
  
  // 检查是否是发送者
  const isSender = 
    (message.from.type === 'user' && context.currentUser) ||
    (message.from.type === 'agent' && message.from.id === context.currentAgent);
  
  // 检查是否是接收者
  let isRecipient = false;
  if (message.to.type === 'user' && context.currentUser) {
    isRecipient = true;
  } else if (message.to.type === 'agent' && message.to.id === context.currentAgent) {
    isRecipient = true;
  } else if (message.to.type === 'agents' && message.to.agentIds) {
    isRecipient = message.to.agentIds.includes(context.currentAgent!);
  }
  
  // 私聊/耳语：只有发送者和接收者可见
  if (isSender || isRecipient) {
    return {
      canSee: true,
      canReply: true,
      visibility: message.visibility
    };
  }
  
  // 不可见
  return {
    canSee: false,
    canReply: false,
    visibility: message.visibility,
    reason: 'Not authorized to view this message'
  };
}

/**
 * 查询消息
 */
export async function queryWhisperMessages(
  filter: MessageFilter = {}
): Promise<WhisperMessage[]> {
  const messages: WhisperMessage[] = [];
  const whispersDir = getWhispersDir();
  
  try {
    // 如果指定了 threadId，从 thread 目录查询
    if (filter.threadId) {
      const threadDir = getThreadWhispersDir(filter.threadId);
      try {
        await access(threadDir);
        const files = await readdir(threadDir);
        
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const message = await loadWhisperMessage(basename(file, '.json'));
          if (!message) continue;
          
          // 应用过滤器
          if (!applyFilter(message, filter)) continue;
          
          messages.push(message);
        }
      } catch {
        // 目录不存在
      }
    } else {
      // 从全局目录查询
      await access(whispersDir);
      const files = await readdir(whispersDir);
      
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'by-thread') continue;
        const message = await loadWhisperMessage(basename(file, '.json'));
        if (!message) continue;
        
        // 应用过滤器
        if (!applyFilter(message, filter)) continue;
        
        messages.push(message);
      }
    }
    
    // 按时间排序
    messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    return messages;
  } catch {
    return [];
  }
}

/**
 * 应用过滤器
 */
function applyFilter(message: WhisperMessage, filter: MessageFilter): boolean {
  // 可见性过滤
  if (filter.visibility && message.visibility !== filter.visibility) {
    return false;
  }
  
  // 发送者类型过滤
  if (filter.fromType && message.from.type !== filter.fromType) {
    return false;
  }
  
  // 接收者类型过滤
  if (filter.toType && message.to.type !== filter.toType) {
    return false;
  }
  
  // Agent ID 过滤
  if (filter.agentId) {
    const isRelated = 
      message.from.id === filter.agentId ||
      message.to.id === filter.agentId ||
      message.to.agentIds?.includes(filter.agentId);
    if (!isRelated) return false;
  }
  
  // 时间过滤
  if (filter.since) {
    const timestamp = new Date(message.timestamp);
    if (timestamp < filter.since) return false;
  }
  
  if (filter.until) {
    const timestamp = new Date(message.timestamp);
    if (timestamp > filter.until) return false;
  }
  
  // 过期检查
  if (!filter.includeExpired && message.metadata?.expiresAt) {
    const expiresAt = new Date(message.metadata.expiresAt);
    if (expiresAt < new Date()) return false;
  }
  
  return true;
}

/**
 * 获取用户可见消息
 */
export async function getVisibleMessages(
  threadId: string,
  context: VisibilityContext,
  since?: Date
): Promise<WhisperMessage[]> {
  const messages = await queryWhisperMessages({
    threadId,
    since
  });
  
  // 过滤不可见消息
  return messages.filter(msg => {
    const check = checkVisibility(msg, context);
    return check.canSee;
  });
}

/**
 * 发送 Whisper 给用户
 */
export async function whisperToUser(
  threadId: string,
  fromAgent: AgentRole,
  content: string,
  options?: {
    expiresInMinutes?: number;
    autoDelete?: boolean;
  }
): Promise<WhisperMessage> {
  const message = createWhisperMessage(
    threadId,
    {
      type: 'agent',
      id: fromAgent,
      name: fromAgent
    },
    {
      type: 'user'
    },
    content,
    'whisper',
    {
      expiresAt: options?.expiresInMinutes 
        ? new Date(Date.now() + options.expiresInMinutes * 60000).toISOString()
        : undefined,
      autoDelete: options?.autoDelete
    }
  );
  
  await saveWhisperMessage(message);
  return message;
}

/**
 * 发送私聊给 Agent
 */
export async function privateMessageToAgent(
  threadId: string,
  toAgent: AgentRole,
  content: string,
  fromUser: string = 'user'
): Promise<WhisperMessage> {
  const message = createWhisperMessage(
    threadId,
    {
      type: 'user',
      name: fromUser
    },
    {
      type: 'agent',
      id: toAgent
    },
    content,
    'private'
  );
  
  await saveWhisperMessage(message);
  return message;
}

/**
 * 广播给多个 Agent
 */
export async function broadcastToAgents(
  threadId: string,
  from: WhisperMessage['from'],
  agentIds: AgentRole[],
  content: string,
  visibility: MessageVisibility = 'whisper'
): Promise<WhisperMessage> {
  const message = createWhisperMessage(
    threadId,
    from,
    {
      type: 'agents',
      agentIds
    },
    content,
    visibility
  );
  
  await saveWhisperMessage(message);
  return message;
}

/**
 * 标记消息为已读
 */
export async function markAsRead(
  whisperId: string,
  readerId: string
): Promise<void> {
  // 这里可以实现已读回执逻辑
  // 简化处理：记录到元数据
}

/**
 * 删除消息
 */
export async function deleteWhisperMessage(whisperId: string): Promise<boolean> {
  try {
    const message = await loadWhisperMessage(whisperId);
    if (!message) return false;
    
    const { unlink } = await import('fs/promises');
    
    // 删除主文件
    const filePath = getWhisperFilePath(whisperId);
    await unlink(filePath);
    
    // 删除 thread 目录中的文件
    const threadFilePath = join(getThreadWhispersDir(message.threadId), `${whisperId}.json`);
    try {
      await unlink(threadFilePath);
    } catch {
      // 忽略错误
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理过期消息
 */
export async function cleanupExpiredMessages(): Promise<number> {
  const messages = await queryWhisperMessages({
    includeExpired: true
  });
  
  let deleted = 0;
  
  for (const message of messages) {
    if (message.metadata?.expiresAt) {
      const expiresAt = new Date(message.metadata.expiresAt);
      if (expiresAt < new Date()) {
        await deleteWhisperMessage(message.id);
        deleted++;
      }
    }
  }
  
  return deleted;
}

/**
 * 转换为公开消息格式
 */
export function toPublicMessage(message: WhisperMessage): {
  id: string;
  role: 'user' | 'agent';
  agentId?: string;
  content: string;
  timestamp: string;
  visibility: MessageVisibility;
} {
  return {
    id: message.id,
    role: message.from.type,
    agentId: message.from.id,
    content: message.content,
    timestamp: message.timestamp,
    visibility: message.visibility
  };
}

/**
 * 获取消息统计
 */
export async function getWhisperStats(
  threadId: string
): Promise<{
  total: number;
  byVisibility: Record<MessageVisibility, number>;
  byAgent: Record<AgentRole, number>;
}> {
  const messages = await queryWhisperMessages({ threadId });
  
  const byVisibility: Partial<Record<MessageVisibility, number>> = {};
  const byAgent: Partial<Record<AgentRole, number>> = {};
  
  for (const message of messages) {
    byVisibility[message.visibility] = (byVisibility[message.visibility] || 0) + 1;
    
    if (message.from.id) {
      byAgent[message.from.id as AgentRole] = (byAgent[message.from.id as AgentRole] || 0) + 1;
    }
  }
  
  return {
    total: messages.length,
    byVisibility: byVisibility as Record<MessageVisibility, number>,
    byAgent: byAgent as Record<AgentRole, number>
  };
}

// ============ WhisperSystem 类 ============

/**
 * WhisperSystem 类
 * 提供高级私聊管理功能
 */
export class WhisperSystem {
  private rules: VisibilityRule[] = [...DEFAULT_VISIBILITY_RULES];
  private cache: Map<string, WhisperMessage> = new Map();
  
  /**
   * 发送消息
   */
  async send(
    threadId: string,
    from: WhisperMessage['from'],
    to: WhisperMessage['to'],
    content: string,
    visibility: MessageVisibility = 'whisper'
  ): Promise<WhisperMessage> {
    const message = createWhisperMessage(threadId, from, to, content, visibility);
    await saveWhisperMessage(message);
    this.cache.set(message.id, message);
    return message;
  }
  
  /**
   * 获取消息
   */
  async get(whisperId: string): Promise<WhisperMessage | null> {
    const cached = this.cache.get(whisperId);
    if (cached) return cached;
    
    const message = await loadWhisperMessage(whisperId);
    if (message) {
      this.cache.set(whisperId, message);
    }
    return message;
  }
  
  /**
   * 查询消息
   */
  async query(filter: MessageFilter = {}): Promise<WhisperMessage[]> {
    return queryWhisperMessages(filter);
  }
  
  /**
   * 获取可见消息
   */
  async getVisible(
    threadId: string,
    context: VisibilityContext,
    since?: Date
  ): Promise<WhisperMessage[]> {
    return getVisibleMessages(threadId, context, since);
  }
  
  /**
   * 检查可见性
   */
  check(message: WhisperMessage, context: VisibilityContext): VisibilityCheckResult {
    return checkVisibility(message, context);
  }
  
  /**
   * Whisper 给用户
   */
  async whisperToUser(
    threadId: string,
    fromAgent: AgentRole,
    content: string,
    options?: { expiresInMinutes?: number; autoDelete?: boolean }
  ): Promise<WhisperMessage> {
    return whisperToUser(threadId, fromAgent, content, options);
  }
  
  /**
   * 私聊给 Agent
   */
  async privateToAgent(
    threadId: string,
    toAgent: AgentRole,
    content: string,
    fromUser?: string
  ): Promise<WhisperMessage> {
    return privateMessageToAgent(threadId, toAgent, content, fromUser);
  }
  
  /**
   * 广播给 Agents
   */
  async broadcast(
    threadId: string,
    from: WhisperMessage['from'],
    agentIds: AgentRole[],
    content: string
  ): Promise<WhisperMessage> {
    return broadcastToAgents(threadId, from, agentIds, content);
  }
  
  /**
   * 删除消息
   */
  async delete(whisperId: string): Promise<boolean> {
    const result = await deleteWhisperMessage(whisperId);
    if (result) {
      this.cache.delete(whisperId);
    }
    return result;
  }
  
  /**
   * 清理过期消息
   */
  async cleanup(): Promise<number> {
    const count = await cleanupExpiredMessages();
    this.cache.clear();
    return count;
  }
  
  /**
   * 获取统计
   */
  async getStats(threadId: string): Promise<ReturnType<typeof getWhisperStats>> {
    return getWhisperStats(threadId);
  }
  
  /**
   * 添加自定义规则
   */
  addRule(rule: VisibilityRule): void {
    this.rules.push(rule);
  }
  
  /**
   * 获取规则
   */
  getRules(): VisibilityRule[] {
    return [...this.rules];
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
