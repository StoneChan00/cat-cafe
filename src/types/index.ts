/**
 * Open Cat Cafe 类型定义
 */

// ============ Agent 相关类型 ============

export type AgentRole = 'developer' | 'reviewer' | 'creative';

export interface AgentConfig {
  id: AgentRole;
  name: string;
  model: string;
  description: string;
  systemPrompt: string;
  toolsPolicy: {
    allowGetContext: boolean;
    allowPostMessage: boolean;
    allowA2A: boolean;
  };
  a2aPolicy: {
    canCallAgents: AgentRole[];
  };
}

// ============ Thread 相关类型 ============

export interface ThreadMessage {
  id: string;
  role: 'user' | 'agent';
  agentId?: AgentRole;
  content: string;
  timestamp: string;
  isPublic: boolean;
}

export interface ThreadContext {
  threadId: string;
  messages: ThreadMessage[];
  currentAgent?: AgentRole;
  worklist: WorklistItem[];
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
}

export type ThreadStatus = 'idle' | 'running' | 'waiting_a2a' | 'completed' | 'cancelled';

// ============ Invocation 相关类型 ============

export interface InvocationRecord {
  invocationId: string;
  threadId: string;
  agentId: AgentRole;
  prompt: string;
  status: InvocationStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  publicMessage?: string;
  nextAgent?: AgentRole;
}

export type InvocationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InvocationResult {
  invocationId: string;
  agentId: AgentRole;
  status: InvocationStatus;
  publicMessage?: string;
  nextAgent?: AgentRole;
  error?: string;
}

// ============ Worklist 相关类型 ============

export interface WorklistItem {
  agentId: AgentRole;
  reason: string;
  triggeredBy: AgentRole;
  addedAt: string;
}

export interface WorklistState {
  items: WorklistItem[];
  currentIndex: number;
  maxDepth: number;
  currentDepth: number;
}

// ============ Router 相关类型 ============

export interface ParsedUserInput {
  targetAgent?: AgentRole;
  content: string;
  hasExplicitAgent: boolean;
}

export interface A2ATrigger {
  targetAgent: AgentRole;
  reason: string;
  triggeredBy: AgentRole;
}

// ============ Callback 相关类型 ============

export interface PostMessagePayload {
  invocationId: string;
  callbackToken: string;
  content: string;
  agentId?: AgentRole;
}

export interface GetContextPayload {
  invocationId: string;
  callbackToken: string;
}

export interface CallbackContext {
  threadId: string;
  messages: ThreadMessage[];
  currentTask?: string;
  currentAgent?: AgentRole;
}

// ============ Runner 相关类型 ============

export interface RunnerOptions {
  prompt: string;
  model: string;
  workingDirectory?: string;
  threadContext?: ThreadContext;
  callbackEnv: {
    apiUrl: string;
    invocationId: string;
    callbackToken: string;
  };
  timeout?: {
    idleMs?: number;
    hardMs?: number;
  };
}

export interface RunnerEvent {
  type: 'text' | 'reasoning' | 'tool_use' | 'step_start' | 'step_finish' | 'error';
  part?: {
    text?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    };
  };
  sessionID?: string;
  error?: unknown;
}

export interface RunnerResult {
  success: boolean;
  finalText: string;
  toolCalls: string[];
  sessionID?: string;
  error?: string;
  terminateReason?: string;
  publicMessage?: string;
}

// ============ Meta Rules 相关类型 ============

export interface MetaRule {
  id: string;
  name: string;
  description: string;
  template: string;
}

// ============ Prompt Builder 相关类型 ============

export interface PromptBuildContext {
  agent: AgentConfig;
  task: string;
  threadContext?: ThreadContext;
  metaRules: MetaRule[];
}

// ============ Server 相关类型 ============

export interface ServerConfig {
  port: number;
  host?: string;
}

export interface ServerState {
  invocationId: string;
  callbackToken: string;
  threadStore?: unknown;
}