const CALLBACK_POST_MESSAGE_TOOL = 'cat_cafe_post_message';
const CALLBACK_GET_CONTEXT_TOOL = 'cat_cafe_get_context';

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getCallbackConfig() {
  return {
    apiUrl: getRequiredEnv('CAT_CAFE_API_URL'),
    invocationId: getRequiredEnv('CAT_CAFE_INVOCATION_ID'),
    callbackToken: getRequiredEnv('CAT_CAFE_CALLBACK_TOKEN')
  };
}

async function postMessage(content) {
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

async function getThreadContext() {
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

function toolText(text) {
  return {
    content: [
      {
        type: 'text',
        text
      }
    ]
  };
}

async function main() {
  const [{ McpServer }, { StdioServerTransport }, zodModule] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/mcp.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('zod')
  ]);
  const z = zodModule.z || zodModule.default || zodModule;

  const server = new McpServer({
    name: 'cat-cafe',
    version: '1.0.0'
  });

  server.registerTool(
    CALLBACK_POST_MESSAGE_TOOL,
    {
      title: 'Post Message',
      description: 'Send a public message to the cat cafe callback server.',
      inputSchema: z.object({
        content: z.string().min(1).describe('Final public content to send back to the chat room.')
      })
    },
    async ({ content }) => {
      try {
        const result = await postMessage(content);
        return toolText(JSON.stringify(result));
      } catch (error) {
        return {
          ...toolText(`post message failed: ${error.message}`),
          isError: true
        };
      }
    }
  );

  server.registerTool(
    CALLBACK_GET_CONTEXT_TOOL,
    {
      title: 'Get Context',
      description: 'Fetch the current thread context from the cat cafe callback server.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const context = await getThreadContext();
        return toolText(JSON.stringify(context));
      } catch (error) {
        return {
          ...toolText(`get context failed: ${error.message}`),
          isError: true
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('cat-cafe MCP server running on stdio');
}

main().catch((error) => {
  console.error(`cat-cafe MCP fatal error: ${error.message}`);
  process.exit(1);
});
