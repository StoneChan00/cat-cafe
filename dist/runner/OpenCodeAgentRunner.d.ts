/**
 * OpenCode Agent Runner
 * 负责启动 opencode 子进程并管理其生命周期
 */
import type { RunnerOptions, RunnerEvent, RunnerResult } from '../types';
/**
 * 事件处理器类型
 */
export type EventHandler = (event: RunnerEvent) => void;
/**
 * OpenCodeAgentRunner 类
 */
export declare class OpenCodeAgentRunner {
    private child;
    private sessionID;
    private aborted;
    private idleTimer;
    private hardTimer;
    private forceKillTimer;
    private lastActivity;
    /**
     * 运行 Agent
     */
    run(options: RunnerOptions, onEvent?: EventHandler): Promise<RunnerResult>;
    /**
     * 处理事件
     */
    private handleEvent;
    /**
     * 设置超时计时器
     */
    private setupTimers;
    /**
     * 刷新活动时间
     */
    private refreshActivity;
    /**
     * 清除计时器
     */
    private clearTimers;
    /**
     * 终止进程
     */
    private terminate;
    /**
     * 取消运行
     */
    abort(): void;
    /**
     * 检查是否已中止
     */
    isAborted(): boolean;
}
/**
 * 便捷函数：运行单个 Agent
 */
export declare function runAgent(options: RunnerOptions, onEvent?: EventHandler): Promise<RunnerResult>;
//# sourceMappingURL=OpenCodeAgentRunner.d.ts.map