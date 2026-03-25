"use strict";
/**
 * OpenCode Agent Runner
 * 负责启动 opencode 子进程并管理其生命周期
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenCodeAgentRunner = void 0;
exports.runAgent = runAgent;
const child_process_1 = require("child_process");
const os_1 = require("os");
// 默认超时配置
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const FORCE_KILL_GRACE_MS = 5000; // 5 秒
/**
 * 构建 MCP 配置
 */
function buildMcpConfig(mcpServerPath) {
    return {
        mcp: {
            'cat-cafe': {
                type: 'local',
                command: [process.execPath, mcpServerPath],
                enabled: true
            }
        }
    };
}
/**
 * 构建 opencode 命令
 */
function buildCommand(prompt, model) {
    const args = ['run', '--format', 'json', '--model', model, prompt];
    if ((0, os_1.platform)() === 'win32') {
        return {
            command: 'cmd.exe',
            args: ['/c', 'opencode', ...args]
        };
    }
    return {
        command: 'opencode',
        args
    };
}
/**
 * OpenCodeAgentRunner 类
 */
class OpenCodeAgentRunner {
    child = null;
    sessionID = null;
    aborted = false;
    terminateReason = null;
    idleTimer = null;
    hardTimer = null;
    forceKillTimer = null;
    lastActivity = 0;
    /**
     * 运行 Agent
     */
    async run(options, onEvent) {
        const { prompt, model, workingDirectory = process.cwd(), callbackEnv, timeout = {} } = options;
        const idleTimeoutMs = timeout.idleMs || DEFAULT_IDLE_TIMEOUT_MS;
        const hardTimeoutMs = timeout.hardMs || DEFAULT_HARD_TIMEOUT_MS;
        // 获取 MCP Server 路径 - 兼容 tsx 开发模式和编译模式
        let mcpServerPath;
        try {
            // 先尝试相对于当前文件的路径 (编译模式)
            mcpServerPath = require.resolve('../mcp/cat-cafe-mcp.js');
        }
        catch {
            // tsx 开发模式：使用 dist 目录下的编译文件
            // __dirname 在 tsx 下指向 src/runner，需要往上两级再进入 dist
            mcpServerPath = require.resolve('../../dist/mcp/cat-cafe-mcp.js');
        }
        const mcpConfig = buildMcpConfig(mcpServerPath);
        // 构建命令
        const { command, args } = buildCommand(prompt, model);
        // 结果收集
        const textChunks = [];
        const toolCalls = [];
        const errorRef = { value: null };
        // 启动子进程
        this.child = (0, child_process_1.spawn)(command, args, {
            cwd: workingDirectory,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                CAT_CAFE_API_URL: callbackEnv.apiUrl,
                CAT_CAFE_INVOCATION_ID: callbackEnv.invocationId,
                CAT_CAFE_CALLBACK_TOKEN: callbackEnv.callbackToken,
                OPENCODE_CONFIG_CONTENT: JSON.stringify(mcpConfig)
            }
        });
        // 设置超时
        this.lastActivity = Date.now();
        this.setupTimers(idleTimeoutMs, hardTimeoutMs);
        // 处理 stdout
        let stdoutBuffer = '';
        this.child.stdout?.on('data', (chunk) => {
            this.refreshActivity();
            stdoutBuffer += chunk.toString('utf8');
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const event = JSON.parse(line);
                    this.handleEvent(event, textChunks, toolCalls, onEvent, errorRef);
                }
                catch {
                    // 忽略 JSON 解析错误
                }
            }
        });
        // 处理 stderr
        this.child.stderr?.on('data', (chunk) => {
            this.refreshActivity();
            // stderr 不计入最终文本，但可用于调试
            if (process.env.DEBUG) {
                console.error('[opencode stderr]', chunk.toString('utf8'));
            }
        });
        // 等待进程结束
        return new Promise((resolve) => {
            this.child?.on('close', (code) => {
                this.clearTimers();
                // 处理剩余 buffer
                if (stdoutBuffer.trim()) {
                    try {
                        const event = JSON.parse(stdoutBuffer);
                        this.handleEvent(event, textChunks, toolCalls, onEvent, errorRef);
                    }
                    catch {
                        // 忽略
                    }
                }
                // 构建错误信息（包括超时原因）
                let errorMessage = errorRef.value ?? undefined;
                if (this.aborted && !errorMessage) {
                    errorMessage = this.terminateReason ?? 'Aborted by user';
                }
                resolve({
                    success: !this.aborted && code === 0 && !errorRef.value,
                    finalText: textChunks.join(''),
                    toolCalls,
                    sessionID: this.sessionID || undefined,
                    error: errorMessage,
                    terminateReason: this.terminateReason ?? undefined
                });
            });
            this.child?.on('error', (err) => {
                this.clearTimers();
                resolve({
                    success: false,
                    finalText: textChunks.join(''),
                    toolCalls,
                    error: err.message
                });
            });
        });
    }
    /**
     * 处理事件
     */
    handleEvent(event, textChunks, toolCalls, onEvent, errorRef) {
        // 提取 sessionID
        if (event.sessionID) {
            this.sessionID = event.sessionID;
        }
        // 收集文本
        if (event.type === 'text' && event.part?.text) {
            textChunks.push(event.part.text);
        }
        // 收集工具调用
        if (event.type === 'tool_use' && event.part?.tool) {
            // 去除可能的 MCP 前缀 (如 "cat-cafe_cat_cafe_get_context" -> "cat_cafe_get_context")
            const toolName = event.part.tool;
            const normalizedToolName = toolName.includes('_') && toolName.includes('-')
                ? toolName.split('_').slice(1).join('_') // 去除 MCP 服务名前缀
                : toolName;
            toolCalls.push(normalizedToolName);
        }
        // 处理错误 - 记录错误并触发终止
        if (event.type === 'error') {
            console.error('[runner error]', event.error);
            // 记录错误，让主流程知道执行失败
            if (errorRef) {
                errorRef.value = typeof event.error === 'string'
                    ? event.error
                    : JSON.stringify(event.error);
            }
            // 终止进程以避免挂起
            this.terminate('api-error');
        }
        // 回调
        onEvent?.(event);
    }
    /**
     * 设置超时计时器
     */
    setupTimers(idleMs, hardMs) {
        // 空闲超时
        this.idleTimer = setInterval(() => {
            if (Date.now() - this.lastActivity > idleMs) {
                this.terminate('idle-timeout');
            }
        }, 10000);
        // 硬超时
        this.hardTimer = setTimeout(() => {
            this.terminate('hard-timeout');
        }, hardMs);
    }
    /**
     * 刷新活动时间
     */
    refreshActivity() {
        this.lastActivity = Date.now();
    }
    /**
     * 清除计时器
     */
    clearTimers() {
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.hardTimer) {
            clearTimeout(this.hardTimer);
            this.hardTimer = null;
        }
        if (this.forceKillTimer) {
            clearTimeout(this.forceKillTimer);
            this.forceKillTimer = null;
        }
    }
    /**
     * 终止进程
     */
    terminate(reason) {
        if (!this.child || this.aborted)
            return;
        console.error(`[runner] terminating due to: ${reason}`);
        this.aborted = true;
        this.terminateReason = reason;
        // 先发 SIGTERM
        this.child.kill('SIGTERM');
        // 5 秒后强制 kill
        this.forceKillTimer = setTimeout(() => {
            this.child?.kill('SIGKILL');
        }, FORCE_KILL_GRACE_MS);
    }
    /**
     * 取消运行
     */
    abort() {
        this.terminate('user-abort');
    }
    /**
     * 检查是否已中止
     */
    isAborted() {
        return this.aborted;
    }
}
exports.OpenCodeAgentRunner = OpenCodeAgentRunner;
/**
 * 便捷函数：运行单个 Agent
 */
async function runAgent(options, onEvent) {
    const runner = new OpenCodeAgentRunner();
    return runner.run(options, onEvent);
}
//# sourceMappingURL=OpenCodeAgentRunner.js.map