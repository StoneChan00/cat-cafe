/**
 * Callback Server
 * 负责接收公开消息和提供上下文
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import type { ServerConfig, ServerState, PostMessagePayload, CallbackContext, AgentRole, ThreadMessage } from '../types';
import { ThreadStore } from '../store/ThreadStore';

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
      } catch (error) {
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
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * CallbackServer 类
 */
export class CallbackServer {
  private server: HttpServer | null = null;
  private invocationId: string;
  private callbackToken: string;
  private threadStore: ThreadStore;
  private port: number;
  private host: string;
  private currentThreadId: string | null = null;
  private currentAgentId: AgentRole | null = null;
  private currentTask: string | null = null;
  
  constructor(config: ServerConfig, threadStore: ThreadStore) {
    this.port = config.port;
    this.host = config.host || 'localhost';
    this.threadStore = threadStore;
    this.invocationId = randomUUID();
    this.callbackToken = randomUUID();
  }
  
  /**
   * 设置当前 Thread
   */
  setCurrentThread(threadId: string, agentId: AgentRole, task: string): void {
    this.currentThreadId = threadId;
    this.currentAgentId = agentId;
    this.currentTask = task;
  }
  
  /**
   * 清除当前 Thread
   */
  clearCurrentThread(): void {
    this.currentThreadId = null;
    this.currentAgentId = null;
    this.currentTask = null;
  }
  
  /**
   * 获取当前凭证
   */
  getCredentials(): { invocationId: string; callbackToken: string } {
    return {
      invocationId: this.invocationId,
      callbackToken: this.callbackToken
    };
  }
  
  /**
   * 重置凭证
   */
  resetCredentials(): void {
    this.invocationId = randomUUID();
    this.callbackToken = randomUUID();
  }
  
  /**
   * 验证请求
   */
  private isAuthorized(invocationId?: string, callbackToken?: string): boolean {
    return invocationId === this.invocationId && callbackToken === this.callbackToken;
  }
  
  /**
   * 处理 post-message 请求
   */
  private async handlePostMessage(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      const payload = (await parseJsonBody(req)) as PostMessagePayload;
      const { invocationId, callbackToken, content, agentId } = payload;
      
      if (!this.isAuthorized(invocationId, callbackToken)) {
        writeJson(res, 401, { status: 'unauthorized' });
        return;
      }
      
      // 打印公开消息
      console.log('\n[chatroom] received public message:');
      console.log(String(content || ''));
      console.log('');
      
      // 保存消息到 thread
      if (this.currentThreadId && content) {
        const agent = agentId || this.currentAgentId;
        await this.threadStore.addMessage(this.currentThreadId, {
          role: 'agent',
          agentId: agent || undefined,
          content: String(content),
          isPublic: true
        });
      }
      
      writeJson(res, 200, { status: 'ok', threadId: this.currentThreadId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeJson(res, 400, { status: 'error', message });
    }
  }
  
  /**
   * 处理 thread-context 请求
   */
  private async handleThreadContext(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const invocationId = url.searchParams.get('invocationId') || undefined;
    const callbackToken = url.searchParams.get('callbackToken') || undefined;
    
    if (!this.isAuthorized(invocationId, callbackToken)) {
      writeJson(res, 401, { status: 'unauthorized' });
      return;
    }
    
    // 从 threadStore 获取真实上下文
    if (this.currentThreadId) {
      const thread = await this.threadStore.get(this.currentThreadId);
      if (thread) {
        const context: CallbackContext = {
          threadId: thread.threadId,
          messages: thread.messages.filter(m => m.isPublic),
          currentTask: this.currentTask || undefined,
          currentAgent: this.currentAgentId || undefined
        };
        writeJson(res, 200, context);
        return;
      }
    }
    
    // 没有活动 thread 时返回空上下文
    const context: CallbackContext = {
      threadId: this.currentThreadId || 'none',
      messages: [],
      currentTask: this.currentTask || undefined,
      currentAgent: this.currentAgentId || undefined
    };
    
    writeJson(res, 200, context);
  }
  
  /**
   * 请求处理
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    
    if (req.method === 'POST' && url.pathname === '/api/callbacks/post-message') {
      await this.handlePostMessage(req, res);
      return;
    }
    
    if (req.method === 'GET' && url.pathname === '/api/callbacks/thread-context') {
      await this.handleThreadContext(req, res);
      return;
    }
    
    writeJson(res, 404, { status: 'not_found' });
  }
  
  /**
   * 启动服务
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error('[server] request error:', error);
          writeJson(res, 500, { status: 'error', message: 'Internal server error' });
        });
      });
      
      this.server.listen(this.port, this.host, () => {
        console.log(`[server] Callback server listening on ${this.host}:${this.port}`);
        console.log(`[server] invocationId: ${this.invocationId}`);
        console.log(`[server] callbackToken: ${this.callbackToken}`);
        resolve();
      });
    });
  }
  
  /**
   * 停止服务
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
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
  
  /**
   * 获取 API URL
   */
  getApiUrl(): string {
    return `http://${this.host}:${this.port}`;
  }
  
  /**
   * 获取服务状态
   */
  getState(): ServerState {
    return {
      invocationId: this.invocationId,
      callbackToken: this.callbackToken,
      threadStore: this.threadStore
    };
  }
}