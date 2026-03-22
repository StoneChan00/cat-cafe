/**
 * OpenCode Agent Runner
 * 负责启动 opencode 子进程并管理其生命周期
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { platform } from 'os';
import type { RunnerOptions, RunnerEvent, RunnerResult } from '../types';

// 默认超时配置
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
const FORCE_KILL_GRACE_MS = 5000; // 5 秒

/**
 * 构建 MCP 配置
 */
function buildMcpConfig(mcpServerPath: string): object {
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
function buildCommand(prompt: string, model: string): { command: string; args: string[] } {
  const args = ['run', '--format', 'json', '--model', model, prompt];
  
  if (platform() === 'win32') {
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
 * 事件处理器类型
 */
export type EventHandler = (event: RunnerEvent) => void;

/**
 * OpenCodeAgentRunner 类
 */
export class OpenCodeAgentRunner {
  private child: ChildProcess | null = null;
  private sessionID: string | null = null;
  private aborted = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private forceKillTimer: NodeJS.Timeout | null = null;
  private lastActivity = 0;
  
  /**
   * 运行 Agent
   */
  async run(
    options: RunnerOptions,
    onEvent?: EventHandler
  ): Promise<RunnerResult> {
    const {
      prompt,
      model,
      workingDirectory = process.cwd(),
      callbackEnv,
      timeout = {}
    } = options;
    
    const idleTimeoutMs = timeout.idleMs || DEFAULT_IDLE_TIMEOUT_MS;
    const hardTimeoutMs = timeout.hardMs || DEFAULT_HARD_TIMEOUT_MS;
    
    // 获取 MCP Server 路径
    const mcpServerPath = require.resolve('../mcp/cat-cafe-mcp.js');
    const mcpConfig = buildMcpConfig(mcpServerPath);
    
    // 构建命令
    const { command, args } = buildCommand(prompt, model);
    
    // 结果收集
    const textChunks: string[] = [];
    const toolCalls: string[] = [];
    let error: string | null = null;
    
    // 启动子进程
    this.child = spawn(command, args, {
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
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.refreshActivity();
      stdoutBuffer += chunk.toString('utf8');
      
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const event = JSON.parse(line) as RunnerEvent;
          this.handleEvent(event, textChunks, toolCalls, onEvent);
        } catch {
          // 忽略 JSON 解析错误
        }
      }
    });
    
    // 处理 stderr
    this.child.stderr?.on('data', (chunk: Buffer) => {
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
            const event = JSON.parse(stdoutBuffer) as RunnerEvent;
            this.handleEvent(event, textChunks, toolCalls, onEvent);
          } catch {
            // 忽略
          }
        }
        
        resolve({
          success: !this.aborted && code === 0,
          finalText: textChunks.join(''),
          toolCalls,
          sessionID: this.sessionID || undefined,
          error: error || (this.aborted ? 'Aborted by user' : undefined)
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
  private handleEvent(
    event: RunnerEvent,
    textChunks: string[],
    toolCalls: string[],
    onEvent?: EventHandler
  ): void {
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
      toolCalls.push(event.part.tool);
    }
    
    // 处理错误
    if (event.type === 'error') {
      console.error('[runner error]', event.error);
    }
    
    // 回调
    onEvent?.(event);
  }
  
  /**
   * 设置超时计时器
   */
  private setupTimers(idleMs: number, hardMs: number): void {
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
  private refreshActivity(): void {
    this.lastActivity = Date.now();
  }
  
  /**
   * 清除计时器
   */
  private clearTimers(): void {
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
  private terminate(reason: string): void {
    if (!this.child || this.aborted) return;
    
    console.error(`[runner] terminating due to: ${reason}`);
    this.aborted = true;
    
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
  abort(): void {
    this.terminate('user-abort');
  }
  
  /**
   * 检查是否已中止
   */
  isAborted(): boolean {
    return this.aborted;
  }
}

/**
 * 便捷函数：运行单个 Agent
 */
export async function runAgent(
  options: RunnerOptions,
  onEvent?: EventHandler
): Promise<RunnerResult> {
  const runner = new OpenCodeAgentRunner();
  return runner.run(options, onEvent);
}