/**
 * Prompt 构建器
 * 负责为每个 Agent 生成完整的 prompt
 * Phase 2 增强：支持 review 原始目标摘要注入
 */
import type { AgentConfig, ThreadContext, MetaRule, PromptBuildContext } from '../types';
export declare const DEFAULT_META_RULES: MetaRule[];
/**
 * 构建完整 Prompt
 */
export declare function buildPrompt(context: PromptBuildContext): string;
/**
 * 构建简单 Prompt（无上下文）
 */
export declare function buildSimplePrompt(agent: AgentConfig, task: string): string;
/**
 * 构建 Review Prompt（Phase 2 增强版）
 * 专门为代码审查场景注入原始目标和上下文
 */
export declare function buildReviewPrompt(agent: AgentConfig, task: string, threadContext: ThreadContext, codeToReview: string): string;
/**
 * PromptBuilder 类
 */
export declare class PromptBuilder {
    private metaRules;
    constructor(metaRules?: MetaRule[]);
    /**
     * 构建 Prompt
     */
    build(agent: AgentConfig, task: string, threadContext?: ThreadContext): string;
    /**
     * 添加元规则
     */
    addMetaRule(rule: MetaRule): void;
    /**
     * 获取所有元规则
     */
    getMetaRules(): MetaRule[];
    /**
     * Phase 2：构建 Review Prompt
     * 为代码审查场景注入原始目标和完整上下文
     */
    buildReviewPrompt(agent: AgentConfig, task: string, threadContext: ThreadContext, codeToReview: string): string;
    /**
     * Phase 2：获取原始目标摘要
     * 用于调试和验证 review 上下文注入
     */
    getOriginalGoalSummary(threadContext?: ThreadContext): string;
}
//# sourceMappingURL=PromptBuilder.d.ts.map