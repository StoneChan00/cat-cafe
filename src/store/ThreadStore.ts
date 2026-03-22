/**
 * Thread 存储
 * 负责管理 thread 的持久化和状态
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { ThreadContext, ThreadMessage, ThreadStatus, WorklistItem } from '../types';

// 获取数据目录
function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getThreadsDir(): string {
  return join(getDataDir(), 'threads');
}

/**
 * 创建新的 Thread
 */
export async function createThread(): Promise<ThreadContext> {
  const threadId = randomUUID();
  const now = new Date().toISOString();
  
  const thread: ThreadContext = {
    threadId,
    messages: [],
    worklist: [],
    status: 'idle',
    createdAt: now,
    updatedAt: now
  };
  
  await saveThread(thread);
  return thread;
}

/**
 * 保存 Thread
 */
export async function saveThread(thread: ThreadContext): Promise<void> {
  await mkdir(getThreadsDir(), { recursive: true });
  const filePath = join(getThreadsDir(), `${thread.threadId}.json`);
  await writeFile(filePath, JSON.stringify(thread, null, 2), 'utf-8');
}

/**
 * 加载 Thread
 */
export async function loadThread(threadId: string): Promise<ThreadContext | null> {
  try {
    const filePath = join(getThreadsDir(), `${threadId}.json`);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ThreadContext;
  } catch {
    return null;
  }
}

/**
 * 添加消息到 Thread
 */
export function addMessage(
  thread: ThreadContext,
  message: Omit<ThreadMessage, 'id' | 'timestamp'>
): ThreadMessage {
  const newMessage: ThreadMessage = {
    ...message,
    id: randomUUID(),
    timestamp: new Date().toISOString()
  };
  
  thread.messages.push(newMessage);
  thread.updatedAt = new Date().toISOString();
  
  return newMessage;
}

/**
 * 更新 Thread 状态
 */
export function updateThreadStatus(
  thread: ThreadContext,
  status: ThreadStatus
): void {
  thread.status = status;
  thread.updatedAt = new Date().toISOString();
}

/**
 * 添加工作项到 Worklist
 */
export function addToWorklist(
  thread: ThreadContext,
  item: Omit<WorklistItem, 'addedAt'>
): void {
  thread.worklist.push({
    ...item,
    addedAt: new Date().toISOString()
  });
  thread.updatedAt = new Date().toISOString();
}

/**
 * 获取下一个工作项
 */
export function getNextWorkItem(thread: ThreadContext): WorklistItem | null {
  return thread.worklist.length > 0 ? thread.worklist[0] : null;
}

/**
 * 移除工作项
 */
export function removeWorkItem(thread: ThreadContext): WorklistItem | null {
  return thread.worklist.shift() || null;
}

/**
 * 清空 Worklist
 */
export function clearWorklist(thread: ThreadContext): void {
  thread.worklist = [];
  thread.updatedAt = new Date().toISOString();
}

/**
 * 获取 Thread 公开消息
 */
export function getPublicMessages(thread: ThreadContext): ThreadMessage[] {
  return thread.messages.filter(m => m.isPublic);
}

/**
 * 获取 Thread 上下文摘要（用于 MCP get_context）
 */
export function getContextSummary(thread: ThreadContext): {
  threadId: string;
  messageCount: number;
  publicMessages: ThreadMessage[];
  currentStatus: ThreadStatus;
  pendingWork: number;
} {
  return {
    threadId: thread.threadId,
    messageCount: thread.messages.length,
    publicMessages: getPublicMessages(thread),
    currentStatus: thread.status,
    pendingWork: thread.worklist.length
  };
}

/**
 * ThreadStore 类
 * 提供更完整的 Thread 管理功能
 */
export class ThreadStore {
  private threads: Map<string, ThreadContext> = new Map();
  
  /**
   * 创建新 Thread
   */
  async create(): Promise<ThreadContext> {
    const thread = await createThread();
    this.threads.set(thread.threadId, thread);
    return thread;
  }
  
  /**
   * 获取 Thread
   */
  async get(threadId: string): Promise<ThreadContext | null> {
    let thread = this.threads.get(threadId) ?? null;
    if (!thread) {
      thread = await loadThread(threadId);
      if (thread) {
        this.threads.set(threadId, thread);
      }
    }
    return thread;
  }
  
  /**
   * 保存 Thread
   */
  async save(thread: ThreadContext): Promise<void> {
    this.threads.set(thread.threadId, thread);
    await saveThread(thread);
  }
  
  /**
   * 添加消息
   */
  async addMessage(
    threadId: string,
    message: Omit<ThreadMessage, 'id' | 'timestamp'>
  ): Promise<ThreadMessage | null> {
    const thread = await this.get(threadId);
    if (!thread) return null;
    
    const newMessage = addMessage(thread, message);
    await this.save(thread);
    return newMessage;
  }
  
  /**
   * 更新状态
   */
  async updateStatus(threadId: string, status: ThreadStatus): Promise<boolean> {
    const thread = await this.get(threadId);
    if (!thread) return false;
    
    updateThreadStatus(thread, status);
    await this.save(thread);
    return true;
  }
  
  /**
   * 获取上下文摘要
   */
  async getContextSummary(threadId: string): Promise<ReturnType<typeof getContextSummary> | undefined> {
    const thread = await this.get(threadId);
    if (!thread) return undefined;
    
    return getContextSummary(thread);
  }
}