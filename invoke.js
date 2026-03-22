const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MODELS = {
  glm: 'bailian-coding-plan/glm-5',
  codex: 'codex_service/gpt-5.4'
};

const SESSION_FILE = path.join(__dirname, '.invoke-sessions.json');

function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (error) {
    return {};
  }
}

function writeSessions(sessions) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function getSessionId(cli) {
  const sessions = readSessions();
  return sessions[cli]?.sessionID || null;
}

function setSessionId(cli, sessionID) {
  if (!sessionID) {
    return;
  }

  const sessions = readSessions();
  sessions[cli] = {
    sessionID,
    updatedAt: new Date().toISOString()
  };
  writeSessions(sessions);
}

function buildCommandArgs(model, prompt, sessionID) {
  const runArgs = ['run', '--format', 'json', '--model', model];

  if (sessionID) {
    runArgs.push('--session', sessionID);
  }

  runArgs.push(prompt);

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

function handleEvent(cli, data, chunks) {
  if (data.sessionID) {
    setSessionId(cli, data.sessionID);
  }

  if (data.type === 'text' && data.part?.text) {
    chunks.push(data.part.text);
    process.stdout.write(data.part.text);
  }
}

function invoke(cli, prompt) {
  return new Promise((resolve, reject) => {
    const model = MODELS[cli];

    if (!model) {
      reject(new Error(`不支持的 cli: ${cli}`));
      return;
    }

    const sessionID = getSessionId(cli);
    const { command, args } = buildCommandArgs(model, prompt || '你好', sessionID);
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });

    const chunks = [];
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
          handleEvent(cli, JSON.parse(line), chunks);
        } catch (error) {
          // Ignore incomplete JSON chunks from streamed output.
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          handleEvent(cli, JSON.parse(buffer), chunks);
        } catch (error) {
          // Ignore trailing parse errors.
        }
      }

      process.stdout.write('\n');

      if (code !== 0) {
        reject(new Error(`opencode exited with code ${code}`));
        return;
      }

      resolve(chunks.join(''));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  invoke
};
