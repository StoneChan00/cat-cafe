const http = require('http');
const { URL } = require('url');
const { randomUUID } = require('crypto');

const PORT = 3200;
const invocationId = randomUUID();
const callbackToken = randomUUID();

const mockThreadContext = {
  messages: [
    {
      role: 'user',
      content: '请写一首关于猫的诗'
    }
  ]
};

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseJsonBody(req) {
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

function isAuthorized(receivedInvocationId, receivedCallbackToken) {
  return receivedInvocationId === invocationId && receivedCallbackToken === callbackToken;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && requestUrl.pathname === '/api/callbacks/post-message') {
    try {
      const payload = await parseJsonBody(req);
      const { invocationId: receivedInvocationId, callbackToken: receivedCallbackToken, content } = payload;

      if (!isAuthorized(receivedInvocationId, receivedCallbackToken)) {
        writeJson(res, 401, { status: 'unauthorized' });
        return;
      }

      console.log('[chatroom] received public message:');
      console.log(String(content || ''));
      writeJson(res, 200, { status: 'ok' });
      return;
    } catch (error) {
      writeJson(res, 400, { status: 'error', message: error.message });
      return;
    }
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/callbacks/thread-context') {
    const receivedInvocationId = requestUrl.searchParams.get('invocationId');
    const receivedCallbackToken = requestUrl.searchParams.get('callbackToken');

    if (!isAuthorized(receivedInvocationId, receivedCallbackToken)) {
      writeJson(res, 401, { status: 'unauthorized' });
      return;
    }

    writeJson(res, 200, mockThreadContext);
    return;
  }

  writeJson(res, 404, { status: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  console.log(`invocationId: ${invocationId}`);
  console.log(`callbackToken: ${callbackToken}`);
});
