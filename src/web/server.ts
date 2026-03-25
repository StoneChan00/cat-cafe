/**
 * Web Server
 * 提供前端页面和 API 接口
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { AgentRole } from '../types';
import { ThreadStore } from '../store/ThreadStore';
import { Router } from '../router/Router';
import { PromptBuilder } from '../prompt/PromptBuilder';
import { OpenCodeAgentRunner } from '../runner/OpenCodeAgentRunner';
import { getAgentConfig, getAllAgentConfigs } from '../config/agents';

// 默认超时配置
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 10 分钟
const DEFAULT_HARD_TIMEOUT_MS = 10 * 60 * 1000; // 30 分钟
const FRONTEND_PATH = resolve(__dirname, 'index.html');

/**
 * 解析 JSON 请求体
 */
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * 写入 JSON 响应
 */
function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * 执行状态
 */
interface ExecutionState {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentAgent?: AgentRole;
  startTime?: number;
  error?: string;
  publicMessages: Array<{ agent: AgentRole | 'user'; content: string; time: string }>;
  internalLogs: Array<{ type: string; content: string; time: string }>;
  timeoutConfig: {
    idleMs: number;
    hardMs: number;
  };
}

/**
 * WebServer 类
 */
export class WebServer {
  private server: HttpServer | null = null;
  private port: number;
  private host: string;
  private threadStore: ThreadStore;
  private router: Router;
  private promptBuilder: PromptBuilder;
  private currentRunner: OpenCodeAgentRunner | null = null;
  private state: ExecutionState;
  private callbacks: Map<string, { invocationId: string; callbackToken: string }>;
  private threadId: string = 'web-thread';
  
  constructor(port: number = 3000, host: string = 'localhost') {
    this.port = port;
    this.host = host;
    this.threadStore = new ThreadStore();
    this.router = new Router();
    this.promptBuilder = new PromptBuilder();
    this.callbacks = new Map();
    this.state = {
      status: 'idle',
      publicMessages: [],
      internalLogs: [],
      timeoutConfig: {
        idleMs: DEFAULT_IDLE_TIMEOUT_MS,
        hardMs: DEFAULT_HARD_TIMEOUT_MS
      }
    };
  }
  
  /**
   * 处理 CORS 预检
   */
  private handleOptions(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
  }
  
  /**
   * 提供前端页面
   */
  private async serveFrontend(res: ServerResponse): Promise<void> {
    try {
      const html = await readFile(FRONTEND_PATH, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Frontend not found. Please build the project first.');
    }
  }
  
  /**
   * 处理聊天请求
   */
  private async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseJsonBody(req) as { agent?: string; message?: string };
      
      console.log(`[web] 📩 Received chat request - agent: ${body.agent || 'developer'}, message: "${body.message?.slice(0, 30)}..."`);
      
      if (!body.message?.trim()) {
        console.log('[web] ❌ Rejected: empty message');
        writeJson(res, 400, { error: 'Message is required' });
        return;
      }
      
      // 解析目标 agent
      const agentId = (body.agent as AgentRole) || 'developer';
      const agentConfig = getAgentConfig(agentId);
      
      if (!agentConfig) {
        console.log(`[web] ❌ Rejected: unknown agent "${agentId}"`);
        writeJson(res, 400, { error: `Unknown agent: ${agentId}` });
        return;
      }
      
      // 检查是否正在执行
      if (this.state.status === 'running') {
        console.log(`[web] ⏳ Rejected: another task is running (agent: ${this.state.currentAgent})`);
        writeJson(res, 409, { error: 'Another task is running' });
        return;
      }
      
      console.log(`[web] ✅ Accepted: starting ${agentConfig.name} (${agentId})`);
      
      // 保存用户消息
      const userMessage = body.message.trim();
      this.state.publicMessages.push({
        agent: 'user' as AgentRole,
        content: userMessage,
        time: new Date().toISOString()
      });
      
      // 持久化用户消息
      this.savePublicMessage('user' as AgentRole, userMessage).catch((err: Error) => {
        console.error('[web] Failed to save user message:', err);
      });
      
      // 更新状态（保留历史消息）
      this.state.status = 'running';
      this.state.currentAgent = agentId;
      this.state.startTime = Date.now();
      this.state.internalLogs = [];
      
      // 异步执行
      this.executeAgent(agentId, body.message).catch(console.error);
      
      writeJson(res, 200, { 
        status: 'started',
        agent: agentId,
        message: 'Task started'
      });
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[web] 💥 Error handling chat:', message);
      writeJson(res, 500, { error: message });
    }
  }
  
  /**
   * 执行 Agent
   */
  private async executeAgent(agentId: AgentRole, message: string): Promise<void> {
    const agentConfig = getAgentConfig(agentId);
    if (!agentConfig) {
      console.log(`[web] ⚠️ Agent config not found: ${agentId}`);
      return;
    }
    
    const invocationId = randomUUID();
    const callbackToken = randomUUID();
    
    console.log(`[web] 🚀 Executing ${agentConfig.name} (model: ${agentConfig.model})`);
    console.log(`[web] 📋 InvocationID: ${invocationId}`);
    
    this.callbacks.set(invocationId, { invocationId, callbackToken });
    
    // 构建 prompt
    const prompt = this.promptBuilder.build(agentConfig, message);
    
    // 创建 runner
    this.currentRunner = new OpenCodeAgentRunner();
    
    // 添加内部日志
    this.addInternalLog('start', `Starting ${agentConfig.name}...`);
    
    // 超时配置
    const idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
    const hardTimeoutMs = DEFAULT_HARD_TIMEOUT_MS;
    
    let runnerResult: { success: boolean; finalText?: string; error?: string; terminateReason?: string } | null = null;
    
    try {
      const result = await this.currentRunner.run(
        {
          prompt,
          model: agentConfig.model,
          callbackEnv: {
            apiUrl: `http://localhost:${this.port}`,
            invocationId,
            callbackToken
          },
          timeout: {
            idleMs: idleTimeoutMs,
            hardMs: hardTimeoutMs
          }
        },
        (event) => {
          // 处理事件
          if (event.type === 'text' && event.part?.text) {
            this.addInternalLog('text', event.part.text);
          }
          if (event.type === 'tool_use' && event.part?.tool) {
            const toolName = event.part.tool.includes('-') 
              ? event.part.tool.split('_').slice(1).join('_')
              : event.part.tool;
            this.addInternalLog('tool', `Tool: ${toolName}`);
          }
          if (event.type === 'error') {
            this.addInternalLog('error', JSON.stringify(event.error));
          }
        }
      );
      
      runnerResult = result;
      this.state.status = result.success ? 'completed' : 'error';
      if (result.success) {
        console.log(`[web] ✅ ${agentConfig.name} completed successfully`);
      } else {
        // 处理超时错误
        if (result.terminateReason === 'idle-timeout') {
          const minutes = Math.floor(idleTimeoutMs / 60000);
          this.state.error = `执行超时：Agent 已经 ${minutes} 分钟没有响应了喵~`;
          
          // 发送超时消息给用户
          const timeoutMessage = `喵呜，我思考了 ${minutes} 分钟还没想出来，先休息一下...\n\n（空闲超时：${minutes} 分钟）`;
          this.state.publicMessages.push({
            agent: agentId,
            content: timeoutMessage,
            time: new Date().toISOString()
          });
          this.savePublicMessage(agentId, timeoutMessage).catch(err => {
            console.error('[web] Failed to save timeout message:', err);
          });
        } else if (result.terminateReason === 'hard-timeout') {
          const minutes = Math.floor(hardTimeoutMs / 60000);
          this.state.error = `执行超时：任务执行超过 ${minutes} 分钟喵~`;
          
          // 发送超时消息给用户
          const timeoutMessage = `喵呜，这个任务太复杂了，我已经努力了 ${minutes} 分钟...\n\n（硬超时：${minutes} 分钟）`;
          this.state.publicMessages.push({
            agent: agentId,
            content: timeoutMessage,
            time: new Date().toISOString()
          });
          this.savePublicMessage(agentId, timeoutMessage).catch(err => {
            console.error('[web] Failed to save timeout message:', err);
          });
        } else {
          this.state.error = result.error || 'Execution failed';
        }
        console.log(`[web] ❌ ${agentConfig.name} failed: ${this.state.error}`);
      }
      
    } catch (error) {
      this.state.status = 'error';
      this.state.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[web] 💥 ${agentConfig.name} threw exception:`, this.state.error);
    } finally {
      console.log(`[web] 🏁 ${agentConfig.name} execution finished (status: ${this.state.status})`);
      
      // 备选机制：如果Agent没有调用post_message，但有finalText，则自动添加
      if (this.state.status === 'completed' && runnerResult?.success && runnerResult?.finalText) {
        const finalText = runnerResult.finalText;
        // 检查是否已经有相同内容的消息（避免重复）
        const hasMessageWithSameContent = this.state.publicMessages.some(m => 
          m.content === finalText
        );
        
        if (!hasMessageWithSameContent) {
          console.log(`[web] 📝 Agent did not post message, using finalText as fallback`);
          const newMessage = {
            agent: agentId,
            content: finalText,
            time: new Date().toISOString()
          };
          this.state.publicMessages.push(newMessage);
          
          // 持久化消息
          this.savePublicMessage(agentId, finalText).catch(err => {
            console.error('[web] Failed to save message:', err);
          });
        }
      }
      
      this.currentRunner = null;
      this.callbacks.delete(invocationId);
    }
  }
  
  /**
   * 添加内部日志
   */
  private addInternalLog(type: string, content: string): void {
    this.state.internalLogs.push({
      type,
      content,
      time: new Date().toISOString()
    });
    
    // 限制日志数量
    if (this.state.internalLogs.length > 1000) {
      this.state.internalLogs.shift();
    }
  }
  
  /**
   * 处理状态查询
   */
  private handleStatus(req: IncomingMessage, res: ServerResponse): void {
    const elapsed = this.state.startTime 
      ? Date.now() - this.state.startTime 
      : 0;
    
    writeJson(res, 200, {
      status: this.state.status,
      currentAgent: this.state.currentAgent,
      elapsed,
      error: this.state.error,
      publicMessages: this.state.publicMessages.slice(-20),
      internalLogs: this.state.internalLogs.slice(-50),
      timeoutConfig: this.state.timeoutConfig
    });
  }
  
  /**
   * 处理停止请求
   */
  private handleStop(req: IncomingMessage, res: ServerResponse): void {
    if (this.currentRunner && this.state.status === 'running') {
      this.currentRunner.abort();
      this.state.status = 'idle';
      this.state.error = 'Stopped by user';
      this.currentRunner = null;
      writeJson(res, 200, { status: 'stopped' });
    } else {
      writeJson(res, 200, { status: 'no_running_task' });
    }
  }
  
  /**
   * 处理公开消息回调（来自 MCP）
   */
  private async handlePostMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseJsonBody(req) as {
        invocationId: string;
        callbackToken: string;
        content: string;
        agentId?: AgentRole;
      };
      
      // 验证凭证
      const callback = this.callbacks.get(body.invocationId);
      if (!callback || callback.callbackToken !== body.callbackToken) {
        writeJson(res, 401, { status: 'unauthorized' });
        return;
      }
      
      // 添加公开消息
      const newMessage = {
        agent: body.agentId || this.state.currentAgent || 'developer',
        content: body.content,
        time: new Date().toISOString()
      };
      this.state.publicMessages.push(newMessage);
      
      // 持久化消息
      this.savePublicMessage(newMessage.agent, newMessage.content).catch((err: Error) => {
        console.error('[web] Failed to save message:', err);
      });
      
      this.addInternalLog('public', `Public message: ${body.content.slice(0, 50)}...`);
      
      writeJson(res, 200, { status: 'ok' });
      
    } catch (error) {
      writeJson(res, 500, { status: 'error' });
    }
  }
  
  /**
   * 处理上下文请求（来自 MCP）
   */
  private async handleGetContext(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const invocationId = url.searchParams.get('invocationId');
    const callbackToken = url.searchParams.get('callbackToken');
    
    // 验证凭证
    const callback = invocationId ? this.callbacks.get(invocationId) : null;
    if (!callback || callback.callbackToken !== callbackToken) {
      writeJson(res, 401, { status: 'unauthorized' });
      return;
    }
    
    writeJson(res, 200, {
      threadId: 'web-thread',
      messages: this.state.publicMessages.map(m => ({
        role: 'agent',
        agentId: m.agent,
        content: m.content
      }))
    });
  }
  
  /**
   * 处理 Agent 列表
   */
  private handleAgents(req: IncomingMessage, res: ServerResponse): void {
    const agents = getAllAgentConfigs().map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      model: a.model
    }));
    
    writeJson(res, 200, { agents });
  }
  
  /**
   * 保存公开消息到 ThreadStore
   */
  private async savePublicMessage(agent: AgentRole | 'user', content: string): Promise<void> {
    try {
      // 获取或创建 thread
      let thread = await this.threadStore.get(this.threadId);
      if (!thread) {
        thread = {
          threadId: this.threadId,
          messages: [],
          worklist: [],
          status: 'idle',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      
      // 添加消息
      const isUser = agent === 'user';
      thread.messages.push({
        id: randomUUID(),
        role: isUser ? 'user' : 'agent',
        agentId: isUser ? undefined : agent,
        content,
        timestamp: new Date().toISOString(),
        isPublic: true
      });
      thread.updatedAt = new Date().toISOString();
      
      // 保存 thread
      await this.threadStore.save(thread);
    } catch (error) {
      console.error('[web] Failed to save message to store:', error);
    }
  }
  
  /**
   * 加载历史消息
   */
  private async loadMessageHistory(): Promise<void> {
    try {
      const thread = await this.threadStore.get(this.threadId);
      if (thread && thread.messages.length > 0) {
        // 加载公开消息
        const publicMessages = thread.messages
          .filter(m => m.isPublic)
          .map(m => ({
            agent: (m.role === 'user' ? 'user' : (m.agentId || 'developer')) as AgentRole | 'user',
            content: m.content,
            time: m.timestamp
          }));
        
        this.state.publicMessages = publicMessages;
        console.log(`[web] 📚 Loaded ${publicMessages.length} messages from history`);
      }
    } catch (error) {
      console.error('[web] Failed to load message history:', error);
    }
  }
  
  /**
   * 请求处理
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    
    // CORS
    if (req.method === 'OPTIONS') {
      this.handleOptions(req, res);
      return;
    }
    
    // API 路由
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      await this.handleChat(req, res);
      return;
    }
    
    if (url.pathname === '/api/status' && req.method === 'GET') {
      this.handleStatus(req, res);
      return;
    }
    
    if (url.pathname === '/api/stop' && req.method === 'POST') {
      this.handleStop(req, res);
      return;
    }
    
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      this.handleAgents(req, res);
      return;
    }
    
    // MCP 回调
    if (url.pathname === '/api/callbacks/post-message' && req.method === 'POST') {
      await this.handlePostMessage(req, res);
      return;
    }
    
    if (url.pathname === '/api/callbacks/thread-context' && req.method === 'GET') {
      await this.handleGetContext(req, res);
      return;
    }
    
    // 前端页面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      await this.serveFrontend(res);
      return;
    }
    
    // 404
    writeJson(res, 404, { error: 'Not found' });
  }
  
  /**
   * 启动服务
   */
  async start(): Promise<void> {
    // 加载历史消息
    await this.loadMessageHistory();
    
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error('[web] Request error:', error);
          writeJson(res, 500, { error: 'Internal server error' });
        });
      });
      
      this.server.listen(this.port, this.host, () => {
        console.log(`[web] Cat Cafe Web Server started at http://${this.host}:${this.port}`);
        console.log('[web] Open the URL in your browser to interact with the agents');
        resolve();
      });
    });
  }
  
  /**
   * 停止服务
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.currentRunner) {
        this.currentRunner.abort();
      }
      
      if (!this.server) {
        resolve();
        return;
      }
      
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * 启动 Web 服务器
 */
export async function startWebServer(port: number = 3000): Promise<WebServer> {
  const server = new WebServer(port);
  await server.start();
  return server;
}