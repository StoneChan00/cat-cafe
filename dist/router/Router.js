"use strict";
/**
 * Router
 * 负责 @agent 检测、路由和 Worklist 管理
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Router = exports.WorklistEngine = void 0;
exports.parseUserInput = parseUserInput;
exports.extractA2ATriggers = extractA2ATriggers;
const agents_1 = require("../config/agents");
// @agent 正则表达式
const AGENT_MENTION_REGEX = /@([\w\u4e00-\u9fa5]+)/g;
// 最大 A2A 深度
const MAX_A2A_DEPTH = 5;
/**
 * 解析用户输入
 * 提取 @agent 召唤和实际内容
 */
function parseUserInput(input) {
    const mentions = [];
    let match;
    // 提取所有 @mentions
    while ((match = AGENT_MENTION_REGEX.exec(input)) !== null) {
        mentions.push(match[1]);
    }
    // 移除 @mentions 后的内容
    let content = input.replace(AGENT_MENTION_REGEX, '').trim();
    // 解析第一个有效的 agent
    let targetAgent;
    let hasExplicitAgent = false;
    for (const mention of mentions) {
        const resolved = (0, agents_1.resolveAgentAlias)(mention);
        if (resolved) {
            targetAgent = resolved;
            hasExplicitAgent = true;
            break;
        }
    }
    return {
        targetAgent,
        content,
        hasExplicitAgent
    };
}
/**
 * 从公开消息中提取 A2A 触发
 */
function extractA2ATriggers(message, triggeredBy) {
    const triggers = [];
    let match;
    // 重置正则状态
    AGENT_MENTION_REGEX.lastIndex = 0;
    while ((match = AGENT_MENTION_REGEX.exec(message)) !== null) {
        const targetAgent = (0, agents_1.resolveAgentAlias)(match[1]);
        if (targetAgent && targetAgent !== triggeredBy) {
            triggers.push({
                targetAgent,
                reason: `Mentioned by ${triggeredBy}`,
                triggeredBy
            });
        }
    }
    return triggers;
}
/**
 * WorklistEngine 类
 * 管理 A2A 工作队列
 */
class WorklistEngine {
    maxDepth;
    constructor(maxDepth = MAX_A2A_DEPTH) {
        this.maxDepth = maxDepth;
    }
    /**
     * 创建初始 Worklist
     */
    createInitialWorklist(targetAgent, reason) {
        return [{
                agentId: targetAgent,
                reason,
                triggeredBy: 'user',
                addedAt: new Date().toISOString()
            }];
    }
    /**
     * 添加 A2A 工作项
     */
    addWorkItem(thread, trigger) {
        // 检查深度限制
        if (thread.worklist.length >= this.maxDepth) {
            console.warn('[worklist] max depth reached, ignoring A2A request');
            return false;
        }
        // 检查是否已有相同 agent 在队列中
        const existing = thread.worklist.find(item => item.agentId === trigger.targetAgent);
        if (existing) {
            console.warn(`[worklist] agent ${trigger.targetAgent} already in queue`);
            return false;
        }
        thread.worklist.push({
            agentId: trigger.targetAgent,
            reason: trigger.reason,
            triggeredBy: trigger.triggeredBy,
            addedAt: new Date().toISOString()
        });
        return true;
    }
    /**
     * 获取下一个工作项
     */
    getNextWorkItem(thread) {
        return thread.worklist.length > 0 ? thread.worklist[0] : null;
    }
    /**
     * 完成当前工作项
     */
    completeCurrentWorkItem(thread) {
        return thread.worklist.shift() || null;
    }
    /**
     * 清空 Worklist
     */
    clearWorklist(thread) {
        thread.worklist = [];
    }
    /**
     * 检查是否有待处理工作
     */
    hasPendingWork(thread) {
        return thread.worklist.length > 0;
    }
    /**
     * 获取 Worklist 状态
     */
    getWorklistStatus(thread) {
        return {
            total: thread.worklist.length,
            current: this.getNextWorkItem(thread),
            remaining: thread.worklist.length
        };
    }
}
exports.WorklistEngine = WorklistEngine;
/**
 * Router 类
 * 整合路由和 Worklist 功能
 */
class Router {
    worklistEngine;
    constructor(maxDepth) {
        this.worklistEngine = new WorklistEngine(maxDepth);
    }
    /**
     * 路由用户输入
     * 返回应该处理此输入的 agent
     */
    routeUserInput(input, thread) {
        const parsed = parseUserInput(input);
        // 如果明确指定了 agent
        if (parsed.targetAgent) {
            const worklist = this.worklistEngine.createInitialWorklist(parsed.targetAgent, `User requested: ${parsed.content.slice(0, 50)}`);
            return {
                agent: parsed.targetAgent,
                worklist
            };
        }
        // 如果有当前 agent，继续使用
        if (thread?.currentAgent) {
            return {
                agent: thread.currentAgent,
                worklist: thread.worklist
            };
        }
        // 默认使用 developer
        const worklist = this.worklistEngine.createInitialWorklist('developer', `Default routing: ${input.slice(0, 50)}`);
        return {
            agent: 'developer',
            worklist
        };
    }
    /**
     * 处理 A2A 触发
     */
    processA2A(thread, message, triggeredBy) {
        const triggers = extractA2ATriggers(message, triggeredBy);
        for (const trigger of triggers) {
            this.worklistEngine.addWorkItem(thread, trigger);
        }
        return triggers;
    }
    /**
     * 获取下一个要执行的 agent
     */
    getNextAgent(thread) {
        const nextItem = this.worklistEngine.getNextWorkItem(thread);
        return nextItem?.agentId || null;
    }
    /**
     * 完成当前 agent 执行
     */
    completeCurrentAgent(thread) {
        this.worklistEngine.completeCurrentWorkItem(thread);
    }
    /**
     * 取消所有待处理工作
     */
    cancelAll(thread) {
        this.worklistEngine.clearWorklist(thread);
    }
    /**
     * 获取 WorklistEngine
     */
    getWorklistEngine() {
        return this.worklistEngine;
    }
}
exports.Router = Router;
//# sourceMappingURL=Router.js.map