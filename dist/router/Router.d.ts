/**
 * Router
 * 负责 @agent 检测、路由和 Worklist 管理
 */
import type { AgentRole, ParsedUserInput, A2ATrigger, WorklistItem, ThreadContext } from '../types';
/**
 * 解析用户输入
 * 提取 @agent 召唤和实际内容
 */
export declare function parseUserInput(input: string): ParsedUserInput;
/**
 * 从公开消息中提取 A2A 触发
 */
export declare function extractA2ATriggers(message: string, triggeredBy: AgentRole): A2ATrigger[];
/**
 * WorklistEngine 类
 * 管理 A2A 工作队列
 */
export declare class WorklistEngine {
    private maxDepth;
    constructor(maxDepth?: number);
    /**
     * 创建初始 Worklist
     */
    createInitialWorklist(targetAgent: AgentRole, reason: string): WorklistItem[];
    /**
     * 添加 A2A 工作项
     */
    addWorkItem(thread: ThreadContext, trigger: A2ATrigger): boolean;
    /**
     * 获取下一个工作项
     */
    getNextWorkItem(thread: ThreadContext): WorklistItem | null;
    /**
     * 完成当前工作项
     */
    completeCurrentWorkItem(thread: ThreadContext): WorklistItem | null;
    /**
     * 清空 Worklist
     */
    clearWorklist(thread: ThreadContext): void;
    /**
     * 检查是否有待处理工作
     */
    hasPendingWork(thread: ThreadContext): boolean;
    /**
     * 获取 Worklist 状态
     */
    getWorklistStatus(thread: ThreadContext): {
        total: number;
        current: WorklistItem | null;
        remaining: number;
    };
}
/**
 * Router 类
 * 整合路由和 Worklist 功能
 */
export declare class Router {
    private worklistEngine;
    constructor(maxDepth?: number);
    /**
     * 路由用户输入
     * 返回应该处理此输入的 agent
     */
    routeUserInput(input: string, thread?: ThreadContext): {
        agent: AgentRole;
        worklist: WorklistItem[];
    };
    /**
     * 处理 A2A 触发
     */
    processA2A(thread: ThreadContext, message: string, triggeredBy: AgentRole): A2ATrigger[];
    /**
     * 获取下一个要执行的 agent
     */
    getNextAgent(thread: ThreadContext): AgentRole | null;
    /**
     * 完成当前 agent 执行
     */
    completeCurrentAgent(thread: ThreadContext): void;
    /**
     * 取消所有待处理工作
     */
    cancelAll(thread: ThreadContext): void;
    /**
     * 获取 WorklistEngine
     */
    getWorklistEngine(): WorklistEngine;
}
//# sourceMappingURL=Router.d.ts.map