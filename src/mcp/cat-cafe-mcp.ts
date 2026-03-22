/**
 * Cat Café MCP Server
 * 提供 get_context 和 post_message 工具
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 工具名称
const TOOL_GET_CONTEXT = 'cat_cafe_get_context';
const TOOL_POST_MESSAGE = 'cat_cafe_post_message';

/**
 * 获取必需的环境变量
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * 获取回调配置
 */
function getCallbackConfig() {
  return {
    apiUrl: getRequiredEnv('CAT_CAFE_API_URL'),
    invocationId: getRequiredEnv('CAT_CAFE_INVOCATION_ID'),
    callbackToken: getRequiredEnv('CAT_CAFE_CALLBACK_TOKEN')
  };
}

/**
 * 调用 post-message API
 */
async function postMessage(content: string): Promise<unknown> {
  const { apiUrl, invocationId, callbackToken } = getCallbackConfig();
  
  const response = await fetch(`${apiUrl}/api/callbacks/post-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      invocationId,
      callbackToken,
      content
    })
  });
  
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Callback post failed with ${response.status}: ${body}`);
  }
  
  return response.json();
}

/**
 * 调用 thread-context API
 */
async function getThreadContext(): Promise<unknown> {
  const { apiUrl, invocationId, callbackToken } = getCallbackConfig();
  
  const url = new URL('/api/callbacks/thread-context', apiUrl);
  url.searchParams.set('invocationId', invocationId);
  url.searchParams.set('callbackToken', callbackToken);
  
  const response = await fetch(url, {
    method: 'GET'
  });
  
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Context fetch failed with ${response.status}: ${body}`);
  }
  
  return response.json();
}

/**
 * 构建工具返回
 */
function toolText(text: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text
      }
    ]
  };
}

/**
 * 构建错误返回
 */
function toolError(message: string) {
  return {
    ...toolText(message),
    isError: true
  };
}

/**
 * 创建并启动 MCP Server
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'cat-cafe',
    version: '1.0.0'
  });
  
  // 注册 post_message 工具
  server.registerTool(
    TOOL_POST_MESSAGE,
    {
      title: 'Post Message',
      description: 'Send a public message to the chat room. Use this to share your final output with the user. Do not include internal reasoning or thinking process.',
      inputSchema: z.object({
        content: z.string().min(1).describe('Final public content to send to the chat room. Should be polished and ready for the user to see.')
      })
    },
    async ({ content }) => {
      try {
        const result = await postMessage(content);
        return toolText(`Message sent successfully: ${JSON.stringify(result)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to post message: ${message}`);
      }
    }
  );
  
  // 注册 get_context 工具
  server.registerTool(
    TOOL_GET_CONTEXT,
    {
      title: 'Get Context',
      description: 'Fetch the current thread context from the callback server. Use this at the start of your task to understand the conversation history and current state.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const context = await getThreadContext();
        return toolText(`Thread context: ${JSON.stringify(context, null, 2)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(`Failed to get context: ${message}`);
      }
    }
  );
  
  // 连接 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // 输出到 stderr 以便调试
  console.error('cat-cafe MCP server running on stdio');
}

/**
 * 主入口
 */
async function main() {
  try {
    await startMcpServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`cat-cafe MCP fatal error: ${message}`);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

export { TOOL_GET_CONTEXT, TOOL_POST_MESSAGE };