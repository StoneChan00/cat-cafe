/**
 * Thread 存储
 * 负责管理 thread 的持久化和状态
 */
import type { ThreadContext, ThreadMessage, ThreadStatus, WorklistItem } from '../types';
/**
 * 创建新的 Thread
 */
export declare function createThread(): Promise<ThreadContext>;
/**
 * 保存 Thread
 */
export declare function saveThread(thread: ThreadContext): Promise<void>;
/**
 * 加载 Thread
 */
export declare function loadThread(threadId: string): Promise<ThreadContext | null>;
/**
 * 添加消息到 Thread
 */
export declare function addMessage(thread: ThreadContext, message: Omit<ThreadMessage, 'id' | 'timestamp'>): ThreadMessage;
/**
 * 更新 Thread 状态
 */
export declare function updateThreadStatus(thread: ThreadContext, status: ThreadStatus): void;
/**
 * 添加工作项到 Worklist
 */
export declare function addToWorklist(thread: ThreadContext, item: Omit<WorklistItem, 'addedAt'>): void;
/**
 * 获取下一个工作项
 */
export declare function getNextWorkItem(thread: ThreadContext): WorklistItem | null;
/**
 * 移除工作项
 */
export declare function removeWorkItem(thread: ThreadContext): WorklistItem | null;
/**
 * 清空 Worklist
 */
export declare function clearWorklist(thread: ThreadContext): void;
/**
 * 获取 Thread 公开消息
 */
export declare function getPublicMessages(thread: ThreadContext): ThreadMessage[];
/**
 * 获取 Thread 上下文摘要（用于 MCP get_context）
 */
export declare function getContextSummary(thread: ThreadContext): {
    threadId: string;
    messageCount: number;
    publicMessages: ThreadMessage[];
    currentStatus: ThreadStatus;
    pendingWork: number;
};
/**
 * ThreadStore 类
 * 提供更完整的 Thread 管理功能
 */
export declare class ThreadStore {
    private threads;
    /**
     * 创建新 Thread
     */
    create(): Promise<ThreadContext>;
    /**
     * 获取 Thread
     */
    get(threadId: string): Promise<ThreadContext | null>;
    /**
     * 保存 Thread
     */
    save(thread: ThreadContext): Promise<void>;
    /**
     * 添加消息
     */
    addMessage(threadId: string, message: Omit<ThreadMessage, 'id' | 'timestamp'>): Promise<ThreadMessage | null>;
    /**
     * 更新状态
     */
    updateStatus(threadId: string, status: ThreadStatus): Promise<boolean>;
    /**
     * 获取上下文摘要
     */
    getContextSummary(threadId: string): Promise<ReturnType<typeof getContextSummary> | undefined>;
}
//# sourceMappingURL=ThreadStore.d.ts.map