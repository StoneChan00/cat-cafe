/**
 * Agent 配置定义
 * 定义系统中的三个 Agent 角色
 */
import type { AgentConfig, AgentRole } from '../types';
export declare const MODEL_IDS: {
    readonly developer: "codex_service/gpt-5.3-codex";
    readonly reviewer: "bailian-coding-plan/glm-5";
    readonly creative: "huoshan-provider/ep-20260305155106-hn7k6";
};
export declare const AGENT_CONFIGS: Record<AgentRole, AgentConfig>;
export declare const AGENT_ALIASES: Record<string, AgentRole>;
/**
 * 获取 Agent 配置
 */
export declare function getAgentConfig(agentId: AgentRole): AgentConfig;
/**
 * 获取所有 Agent 配置
 */
export declare function getAllAgentConfigs(): AgentConfig[];
/**
 * 根据 Alias 获取 Agent ID
 */
export declare function resolveAgentAlias(alias: string): AgentRole | null;
/**
 * 检查是否为有效的 Agent 角色
 */
export declare function isValidAgentRole(role: string): role is AgentRole;
//# sourceMappingURL=agents.d.ts.map