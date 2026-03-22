const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MODELS = {
  glm: 'bailian-coding-plan/glm-5',
  codex: 'codex_service/gpt-5.4'
};

const SESSION_FILE = path.join(__dirname, '.invoke-sessions.json');
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000;
const FORCE_KILL_GRACE_MS = 5 * 1000;
const STDERR_TAIL_LIMIT = 8 * 1024;

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

function isSupportedCli(cli) {
  return Object.prototype.hasOwnProperty.call(MODELS, cli);
}

function getSessionId(cli) {
  const sessions = readSessions();
  return sessions[cli]?.sessionID || null;
}

function resetSession(cli) {
  if (!isSupportedCli(cli)) {
    throw new Error(`不支持的 cli: ${cli}`);
  }

  const sessions = readSessions();

  if (!sessions[cli]) {
    return false;
  }

  delete sessions[cli];
  writeSessions(sessions);
  return true;
}

function clearAllSessions() {
  const sessions = readSessions();
  const cleared = Object.keys(sessions).length;

  if (cleared === 0) {
    return 0;
  }

  writeSessions({});
  return cleared;
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

function appendStderrTail(current, chunk) {
  const next = current + chunk.toString('utf8');
  if (next.length <= STDERR_TAIL_LIMIT) {
    return next;
  }

  return next.slice(-STDERR_TAIL_LIMIT);
}

function createInvokeError(message, details) {
  const error = new Error(message);
  error.details = details;
  return error;
}

function attachParentSignalHandlers(isChildActive, terminateChild) {
  const handlers = [];

  const register = (event, handler) => {
    process.on(event, handler);
    handlers.push({ event, handler });
  };

  register('SIGINT', () => {
    terminateChild('parent-sigint');
  });

  register('SIGTERM', () => {
    terminateChild('parent-sigterm');
  });

  register('exit', () => {
    if (isChildActive()) {
      try {
        terminateChild('parent-exit');
      } catch (error) {
        // Ignore cleanup failures during process exit.
      }
    }
  });

  return () => {
    for (const { event, handler } of handlers) {
      process.removeListener(event, handler);
    }
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

function invoke(cli, prompt, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isSupportedCli(cli)) {
      reject(new Error(`不支持的 cli: ${cli}`));
      return;
    }

    const model = MODELS[cli];

    const sessionID = getSessionId(cli);
    const { command, args } = buildCommandArgs(model, prompt || '你好', sessionID);
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const hardTimeoutMs = options.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks = [];
    let buffer = '';
    let stderrTail = '';
    let lastActivity = Date.now();
    const startedAt = Date.now();
    let settled = false;
    let childExited = false;
    let terminationStarted = false;
    let idleTimer = null;
    let hardTimer = null;
    let forceKillTimer = null;

    const details = {
      cli,
      model,
      prompt: prompt || '你好',
      sessionID,
      command,
      args,
      idleTimeoutMs,
      hardTimeoutMs,
      stderrTail: ''
    };

    const clearTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      detachSignalHandlers();
      reject(error);
    };

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      detachSignalHandlers();
      resolve(value);
    };

    const terminateChild = (reason) => {
      if (childExited || terminationStarted) {
        return;
      }

      terminationStarted = true;
      details.terminationReason = reason;

      try {
        child.kill('SIGTERM');
      } catch (error) {
        details.killError = error.message;
      }

      forceKillTimer = setTimeout(() => {
        if (!childExited) {
          try {
            child.kill('SIGKILL');
          } catch (error) {
            details.forceKillError = error.message;
          }
        }
      }, FORCE_KILL_GRACE_MS);
    };

    const refreshIdleTimer = () => {
      if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
        return;
      }

      if (idleTimer) {
        clearTimeout(idleTimer);
      }

      idleTimer = setTimeout(() => {
        const idleForMs = Date.now() - lastActivity;
        details.idleForMs = idleForMs;
        terminateChild('idle-timeout');
      }, idleTimeoutMs);
    };

    const markActivity = () => {
      lastActivity = Date.now();
      refreshIdleTimer();
    };

    if (Number.isFinite(hardTimeoutMs) && hardTimeoutMs > 0) {
      hardTimer = setTimeout(() => {
        details.runtimeMs = Date.now() - startedAt;
        terminateChild('hard-timeout');
      }, hardTimeoutMs);
    }

    refreshIdleTimer();

    const detachSignalHandlers = attachParentSignalHandlers(
      () => !childExited,
      terminateChild
    );

    child.stdout.on('data', (chunk) => {
      markActivity();
      buffer += chunk.toString('utf8');

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          handleEvent(cli, JSON.parse(line), chunks);
          details.sessionID = getSessionId(cli) || details.sessionID;
        } catch (error) {
          // Ignore incomplete JSON chunks from streamed output.
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      markActivity();
      stderrTail = appendStderrTail(stderrTail, chunk);
      details.stderrTail = stderrTail;
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      childExited = true;
      details.exitCode = code;
      details.runtimeMs = Date.now() - startedAt;

      if (buffer.trim()) {
        try {
          handleEvent(cli, JSON.parse(buffer), chunks);
          details.sessionID = getSessionId(cli) || details.sessionID;
        } catch (error) {
          // Ignore trailing parse errors.
        }
      }

      process.stdout.write('\n');

      if (code !== 0) {
        const reason = details.terminationReason || 'process-exit';
        rejectOnce(
          createInvokeError(`opencode exited with code ${code} (${reason})`, {
            ...details,
            stderrTail
          })
        );
        return;
      }

      resolveOnce(chunks.join(''));
    });

    child.on('error', (error) => {
      rejectOnce(
        createInvokeError(`执行错误: ${error.message}`, {
          ...details,
          stderrTail
        })
      );
    });
  });
}

module.exports = {
  invoke,
  resetSession,
  clearAllSessions
};
