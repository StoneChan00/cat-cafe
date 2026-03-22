/**
 * Callback Server
 * 负责接收公开消息和提供上下文
 */
import type { ServerConfig, ServerState, AgentRole } from '../types';
import { ThreadStore } from '../store/ThreadStore';
/**
 * CallbackServer 类
 */
export declare class CallbackServer {
    private server;
    private invocationId;
    private callbackToken;
    private threadStore;
    private port;
    private host;
    private currentThreadId;
    private currentAgentId;
    private currentTask;
    constructor(config: ServerConfig, threadStore: ThreadStore);
    /**
     * 设置当前 Thread
     */
    setCurrentThread(threadId: string, agentId: AgentRole, task: string): void;
    /**
     * 清除当前 Thread
     */
    clearCurrentThread(): void;
    /**
     * 获取当前凭证
     */
    getCredentials(): {
        invocationId: string;
        callbackToken: string;
    };
    /**
     * 重置凭证
     */
    resetCredentials(): void;
    /**
     * 验证请求
     */
    private isAuthorized;
    /**
     * 处理 post-message 请求
     */
    private handlePostMessage;
    /**
     * 处理 thread-context 请求
     */
    private handleThreadContext;
    /**
     * 请求处理
     */
    private handleRequest;
    /**
     * 启动服务
     */
    start(): Promise<void>;
    /**
     * 停止服务
     */
    stop(): Promise<void>;
    /**
     * 获取 API URL
     */
    getApiUrl(): string;
    /**
     * 获取服务状态
     */
    getState(): ServerState;
}
//# sourceMappingURL=CallbackServer.d.ts.map