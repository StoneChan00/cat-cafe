"use strict";
/**
 * Open Cat Cafe - 主入口
 * 多 Agent 协作系统
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenCodeAgentRunner = exports.PromptBuilder = exports.Router = exports.CallbackServer = exports.ThreadStore = exports.CatCafe = void 0;
const readline_1 = require("readline");
const ThreadStore_1 = require("./store/ThreadStore");
Object.defineProperty(exports, "ThreadStore", { enumerable: true, get: function () { return ThreadStore_1.ThreadStore; } });
const CallbackServer_1 = require("./server/CallbackServer");
Object.defineProperty(exports, "CallbackServer", { enumerable: true, get: function () { return CallbackServer_1.CallbackServer; } });
const Router_1 = require("./router/Router");
Object.defineProperty(exports, "Router", { enumerable: true, get: function () { return Router_1.Router; } });
const PromptBuilder_1 = require("./prompt/PromptBuilder");
Object.defineProperty(exports, "PromptBuilder", { enumerable: true, get: function () { return PromptBuilder_1.PromptBuilder; } });
const OpenCodeAgentRunner_1 = require("./runner/OpenCodeAgentRunner");
Object.defineProperty(exports, "OpenCodeAgentRunner", { enumerable: true, get: function () { return OpenCodeAgentRunner_1.OpenCodeAgentRunner; } });
const agents_1 = require("./config/agents");
// 配置
const DEFAULT_PORT = 3200;
const MAX_A2A_DEPTH = 5;
/**
 * CatCafe 主类
 */
class CatCafe {
    threadStore;
    callbackServer;
    router;
    promptBuilder;
    currentRunner = null;
    currentThread = null;
    constructor(port = DEFAULT_PORT) {
        this.threadStore = new ThreadStore_1.ThreadStore();
        this.callbackServer = new CallbackServer_1.CallbackServer({ port }, this.threadStore);
        this.router = new Router_1.Router(MAX_A2A_DEPTH);
        this.promptBuilder = new PromptBuilder_1.PromptBuilder();
    }
    /**
     * 启动系统
     */
    async start() {
        await this.callbackServer.start();
        console.log('[cat-cafe] System started');
        console.log('[cat-cafe] Type your message or "exit" to quit');
    }
    /**
     * 停止系统
     */
    async stop() {
        if (this.currentRunner) {
            this.currentRunner.abort();
        }
        await this.callbackServer.stop();
        console.log('[cat-cafe] System stopped');
    }
    /**
     * 处理用户输入
     */
    async handleUserInput(input) {
        if (!input.trim())
            return;
        // 创建或获取 thread
        if (!this.currentThread) {
            this.currentThread = await this.threadStore.create();
        }
        // 添加用户消息
        await this.threadStore.addMessage(this.currentThread.threadId, {
            role: 'user',
            content: input,
            isPublic: true
        });
        // 路由
        const { agent: targetAgent, worklist } = this.router.routeUserInput(input, this.currentThread);
        this.currentThread.worklist = worklist;
        console.log(`[cat-cafe] Routing to: ${targetAgent}`);
        // 执行 agent 链
        await this.executeAgentChain(targetAgent);
    }
    /**
     * 执行 agent 链
     */
    async executeAgentChain(startAgent) {
        let currentAgent = startAgent;
        while (currentAgent && this.currentThread) {
            // 检查深度
            if (this.currentThread.worklist.length > MAX_A2A_DEPTH) {
                console.warn('[cat-cafe] Max A2A depth reached, stopping chain');
                break;
            }
            // 更新状态
            this.currentThread.currentAgent = currentAgent;
            await this.threadStore.updateStatus(this.currentThread.threadId, 'running');
            // 执行 agent
            const shouldContinue = await this.executeAgent(currentAgent);
            if (!shouldContinue) {
                break;
            }
            // 获取下一个 agent
            currentAgent = this.router.getNextAgent(this.currentThread);
        }
        // 完成
        if (this.currentThread) {
            await this.threadStore.updateStatus(this.currentThread.threadId, 'completed');
        }
    }
    /**
     * 执行单个 agent
     */
    async executeAgent(agentId) {
        if (!this.currentThread)
            return false;
        const agentConfig = (0, agents_1.getAgentConfig)(agentId);
        const credentials = this.callbackServer.getCredentials();
        // 构建 prompt
        const prompt = this.promptBuilder.build(agentConfig, this.getCurrentUserTask(), this.currentThread);
        // 设置 CallbackServer 的当前 thread
        this.callbackServer.setCurrentThread(this.currentThread.threadId, agentId, this.getCurrentUserTask());
        console.log(`\n[cat-cafe] Starting ${agentConfig.name}...`);
        console.log('[cat-cafe] --- Internal Output Start ---');
        // 创建 runner
        this.currentRunner = new OpenCodeAgentRunner_1.OpenCodeAgentRunner();
        // 执行
        const result = await this.currentRunner.run({
            prompt,
            model: agentConfig.model,
            threadContext: this.currentThread,
            callbackEnv: {
                apiUrl: this.callbackServer.getApiUrl(),
                invocationId: credentials.invocationId,
                callbackToken: credentials.callbackToken
            }
        }, (event) => {
            // 打印内部输出
            this.printEvent(event);
        });
        console.log('[cat-cafe] --- Internal Output End ---\n');
        // 处理结果
        if (result.success) {
            console.log(`[cat-cafe] ${agentConfig.name} completed`);
            // 检查 A2A
            if (result.publicMessage) {
                const triggers = this.router.processA2A(this.currentThread, result.publicMessage, agentId);
                if (triggers.length > 0) {
                    console.log(`[cat-cafe] A2A triggered: ${triggers.map(t => t.targetAgent).join(', ')}`);
                }
            }
        }
        else {
            console.error(`[cat-cafe] ${agentConfig.name} failed: ${result.error}`);
        }
        // 完成当前 agent
        this.router.completeCurrentAgent(this.currentThread);
        this.currentRunner = null;
        // 清除 CallbackServer 的当前 thread
        this.callbackServer.clearCurrentThread();
        return result.success;
    }
    /**
     * 获取当前用户任务
     */
    getCurrentUserTask() {
        if (!this.currentThread)
            return '';
        const userMessages = this.currentThread.messages.filter(m => m.role === 'user');
        return userMessages[userMessages.length - 1]?.content || '';
    }
    /**
     * 打印事件
     */
    printEvent(event) {
        if (event.type === 'text' && event.part?.text) {
            process.stdout.write(event.part.text);
            return;
        }
        if (event.type === 'reasoning' && event.part?.text) {
            process.stdout.write(`\n[reasoning]\n${event.part.text}\n`);
            return;
        }
        if (event.type === 'tool_use') {
            const toolName = event.part?.tool || 'unknown';
            const status = event.part?.state?.status || 'unknown';
            process.stdout.write(`\n[tool_use] ${toolName} (${status})\n`);
            return;
        }
        if (event.type === 'error') {
            process.stdout.write(`\n[error] ${JSON.stringify(event.error)}\n`);
        }
    }
    /**
     * 取消当前执行
     */
    cancel() {
        if (this.currentRunner) {
            console.log('[cat-cafe] Cancelling current execution...');
            this.currentRunner.abort();
        }
        if (this.currentThread) {
            this.router.cancelAll(this.currentThread);
            this.threadStore.updateStatus(this.currentThread.threadId, 'cancelled');
        }
    }
    /**
     * 获取当前状态
     */
    getStatus() {
        if (!this.currentThread) {
            return { hasActiveThread: false };
        }
        return {
            hasActiveThread: true,
            threadId: this.currentThread.threadId,
            status: this.currentThread.status,
            pendingWork: this.currentThread.worklist.length
        };
    }
}
exports.CatCafe = CatCafe;
/**
 * 启动交互式 CLI
 */
async function startInteractive(catCafe) {
    const rl = (0, readline_1.createInterface)({
        input: process.stdin,
        output: process.stdout
    });
    const prompt = () => {
        rl.question('\n> ', async (input) => {
            const trimmed = input.trim();
            if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
                rl.close();
                await catCafe.stop();
                return;
            }
            if (trimmed.toLowerCase() === 'cancel') {
                catCafe.cancel();
                prompt();
                return;
            }
            if (trimmed.toLowerCase() === 'status') {
                console.log(catCafe.getStatus());
                prompt();
                return;
            }
            try {
                await catCafe.handleUserInput(trimmed);
            }
            catch (error) {
                console.error('[cat-cafe] Error:', error);
            }
            prompt();
        });
    };
    prompt();
}
/**
 * 主入口
 */
async function main() {
    const catCafe = new CatCafe(DEFAULT_PORT);
    // 处理退出信号
    process.on('SIGINT', async () => {
        console.log('\n[cat-cafe] Received SIGINT');
        await catCafe.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('\n[cat-cafe] Received SIGTERM');
        await catCafe.stop();
        process.exit(0);
    });
    // 启动
    await catCafe.start();
    // 启动交互式 CLI
    await startInteractive(catCafe);
}
__exportStar(require("./types"), exports);
__exportStar(require("./config/agents"), exports);
// 主入口
if (require.main === module) {
    main().catch((error) => {
        console.error('[cat-cafe] Fatal error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map