const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_MODEL = 'bailian-coding-plan/glm-5';

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildOpencodeMcpConfig() {
  return {
    mcp: {
      'cat-cafe': {
        type: 'local',
        command: [process.execPath, path.join(__dirname, 'cat-cafe-mcp.js')],
        enabled: true
      }
    }
  };
}

function buildOpencodeCommand(prompt, model) {
  const runArgs = ['run', '--format', 'json', '--model', model, prompt];

  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/c', 'opencode', ...runArgs]
    };
  }

  return {
    command: 'opencode',
    args: runArgs
  };
}

function writeReadableEvent(event) {
  if (event.type === 'text' && event.part?.text) {
    process.stdout.write(event.part.text);
    return;
  }

  if (event.type === 'reasoning' && event.part?.text) {
    process.stdout.write(`\n[reasoning]\n${event.part.text}\n`);
    return;
  }

  if (event.type === 'tool_use') {
    const toolName = event.part?.tool || 'unknown-tool';
    const status = event.part?.state?.status || 'unknown-status';
    process.stdout.write(`\n[tool_use] ${toolName} (${status})\n`);

    if (event.part?.state?.input) {
      process.stdout.write(`${JSON.stringify(event.part.state.input, null, 2)}\n`);
    }

    if (event.part?.state?.output) {
      process.stdout.write(`[tool_output]\n${JSON.stringify(event.part.state.output, null, 2)}\n`);
    }

    if (event.part?.state?.error) {
      process.stdout.write(`[tool_error]\n${JSON.stringify(event.part.state.error, null, 2)}\n`);
    }

    return;
  }

  if (event.type === 'step_start' || event.type === 'step_finish') {
    process.stdout.write(`\n[${event.type}] ${JSON.stringify(event.part || {}, null, 2)}\n`);
    return;
  }

  if (event.type === 'error') {
    process.stdout.write(`\n[error] ${JSON.stringify(event.error || event, null, 2)}\n`);
  }
}

async function main() {
  const apiUrl = getRequiredEnv('CAT_CAFE_API_URL');
  const invocationId = getRequiredEnv('CAT_CAFE_INVOCATION_ID');
  const callbackToken = getRequiredEnv('CAT_CAFE_CALLBACK_TOKEN');
  const model = process.env.CAT_CAFE_MODEL || DEFAULT_MODEL;
  const prompt = process.argv[2] || [
    '你的任务是写一首关于猫的诗。',
    '在开始写之前，先调用 cat_cafe_get_context 获取上下文。',
    '写完后，调用 cat_cafe_post_message 把最终的诗发到聊天室。',
    '不要把思考过程发到聊天室，只发送最终公开内容。'
  ].join('\n');

  const opencodeCommand = buildOpencodeCommand(prompt, model);
  const child = spawn(opencodeCommand.command, opencodeCommand.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CAT_CAFE_API_URL: apiUrl,
      CAT_CAFE_INVOCATION_ID: invocationId,
      CAT_CAFE_CALLBACK_TOKEN: callbackToken,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeMcpConfig())
    }
  });

  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        writeReadableEvent(JSON.parse(line));
      } catch (error) {
        process.stdout.write(`\n[raw]\n${line}\n`);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.on('close', (code) => {
    if (buffer.trim()) {
      try {
        writeReadableEvent(JSON.parse(buffer));
      } catch (error) {
        process.stdout.write(`\n[raw]\n${buffer}\n`);
      }
    }

    process.stdout.write('\n');

    if (code !== 0) {
      process.exitCode = code;
    }
  });

  child.on('error', (error) => {
    console.error(`Failed to start opencode: ${error.message}`);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
