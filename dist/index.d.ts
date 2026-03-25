/**
 * Open Cat Cafe - 主入口
 * 多 Agent 协作系统
 */
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
export { ThreadStore } from './store/ThreadStore';
export { InvocationStore, type CompleteInvocationRecord } from './store/InvocationStore';
export { CallbackServer } from './server/CallbackServer';
export { Router } from './router/Router';
export { PromptBuilder, buildPrompt, buildSimplePrompt } from './prompt/PromptBuilder';
export { OpenCodeAgentRunner, type EventHandler, runAgent } from './runner/OpenCodeAgentRunner';
export { TranscriptManager, type TranscriptEntry, type SessionSummary } from './utils/TranscriptManager';
export { KnowledgeIndex, type KnowledgeEntry, type FeatureDoc, type BacklogItem, type KnowledgeType } from './knowledge/KnowledgeIndex';
export { SessionManager, type SessionRecord, type SessionStatus, type ContextUsageStats, type SealingReason } from './session/SessionManager';
export { ContextRetriever, type ContextSlice, type RetrievalStrategy } from './session/ContextRetriever';
export { SessionSearch, type SessionSearchResult, type SessionTimeline } from './session/SessionSearch';
export { ContextGatekeeper, type ContextQualityAssessment, type ContextInjectionDecision } from './context/ContextGatekeeper';
export { KnowledgeHub, type KnowledgeGraph, type SmartRecommendation } from './knowledge/KnowledgeHub';
export { RichMessageBuilder, renderBlockToHTML, parseMarkdownToBlocks, createTextBlock, createCodeBlock, createDiffBlock, createListBlock, createTableBlock, createStatusBlock, createProgressBlock, createCalloutBlock, createCollapseBlock, createTabsBlock, serializeRichMessage, deserializeRichMessage, type RichBlock, type RichMessage, type TextBlock, type CodeBlock, type DiffBlock, type StatusBlock, type ProgressBlock, type CalloutBlock, type CollapseBlock, type TabsBlock } from './message/RichBlock';
export { ProjectManager, type ProjectConfig, type ProjectSwitchContext, type ProjectStats } from './config/ProjectManager';
export { WhisperSystem, type WhisperMessage, type MessageVisibility, type VisibilityContext } from './visibility/WhisperSystem';
export { SkillRegistry, type Skill, type SkillInstance, type SkillExecutionResult, type SkillType } from './skills/SkillRegistry';
export { CommandEngine, type Command, type CommandContext, type CommandResult, type ParsedCommand } from './commands/CommandEngine';
export * from './types';
export * from './config/agents';
//# sourceMappingURL=index.d.ts.map