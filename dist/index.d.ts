/**
 * Open Cat Cafe - 主入口
 * 多 Agent 协作系统
 */
import { ThreadStore } from './store/ThreadStore';
import { CallbackServer } from './server/CallbackServer';
import { Router } from './router/Router';
import { PromptBuilder } from './prompt/PromptBuilder';
import { OpenCodeAgentRunner } from './runner/OpenCodeAgentRunner';
/**
 * CatCafe 主类
 */
export declare class CatCafe {
    private threadStore;
    private callbackServer;
    private router;
    private promptBuilder;
    private currentRunner;
    private currentThread;
    constructor(port?: number);
    /**
     * 启动系统
     */
    start(): Promise<void>;
    /**
     * 停止系统
     */
    stop(): Promise<void>;
    /**
     * 处理用户输入
     */
    handleUserInput(input: string): Promise<void>;
    /**
     * 执行 agent 链
     */
    private executeAgentChain;
    /**
     * 执行单个 agent
     */
    private executeAgent;
    /**
     * 获取当前用户任务
     */
    private getCurrentUserTask;
    /**
     * 打印事件
     */
    private printEvent;
    /**
     * 取消当前执行
     */
    cancel(): void;
    /**
     * 获取当前状态
     */
    getStatus(): {
        hasActiveThread: boolean;
        threadId?: string;
        status?: string;
        pendingWork?: number;
    };
}
export { ThreadStore, CallbackServer, Router, PromptBuilder, OpenCodeAgentRunner };
export * from './types';
export * from './config/agents';
//# sourceMappingURL=index.d.ts.map