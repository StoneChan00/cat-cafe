/**
 * Command Engine
 * 命令引擎
 * Phase 4 核心组件：支持斜杠命令和快捷操作
 */

import type { AgentRole, ThreadContext } from '../types';
import type { RichMessage } from '../message/RichBlock';

// ============ 类型定义 ============

/**
 * 命令类型
 */
export type CommandType = 'system' | 'agent' | 'skill' | 'custom';

/**
 * 命令定义
 */
export interface Command {
  id: string;
  name: string; // 命令名（如 /status）
  description: string;
  type: CommandType;
  
  // 别名
  aliases?: string[];
  
  // 参数定义
  args?: Array<{
    name: string;
    description: string;
    required?: boolean;
    type: 'string' | 'number' | 'boolean' | 'choice';
    choices?: string[];
    default?: any;
  }>;
  
  // 选项定义
  options?: Array<{
    name: string;
    alias?: string;
    description: string;
    type: 'string' | 'number' | 'boolean';
    default?: any;
  }>;
  
  // 执行处理
  handler: (context: CommandContext) => Promise<CommandResult>;
  
  // 权限
  permissions?: {
    roles?: AgentRole[];
    requireAuth?: boolean;
  };
  
  // 帮助信息
  help?: {
    usage: string;
    examples: string[];
    notes?: string;
  };
}

/**
 * 命令上下文
 */
export interface CommandContext {
  command: string;
  args: Record<string, any>;
  options: Record<string, any>;
  rawInput: string;
  threadContext?: ThreadContext;
  currentAgent?: AgentRole;
  userId?: string;
  projectId?: string;
}

/**
 * 命令结果
 */
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  richMessage?: Partial<RichMessage>;
  error?: string;
  followUp?: Command[]; // 后续可用命令
}

/**
 * 命令解析结果
 */
export interface ParsedCommand {
  command: string;
  args: Record<string, any>;
  options: Record<string, any>;
  rawInput: string;
  valid: boolean;
  error?: string;
}

/**
 * 命令历史
 */
export interface CommandHistory {
  id: string;
  command: string;
  args: Record<string, any>;
  result: CommandResult;
  timestamp: string;
  durationMs: number;
}

/**
 * 命令建议
 */
export interface CommandSuggestion {
  command: string;
  description: string;
  matchScore: number;
}

// ============ 内置命令 ============

const builtinCommands: Command[] = [
  {
    id: 'cmd-status',
    name: '/status',
    description: '查看当前系统状态',
    type: 'system',
    handler: async (context) => {
      return {
        success: true,
        message: '系统运行正常',
        data: {
          timestamp: new Date().toISOString(),
          agent: context.currentAgent || 'none',
          thread: context.threadContext?.threadId
        }
      };
    }
  },
  {
    id: 'cmd-clear',
    name: '/clear',
    description: '清空当前对话',
    type: 'system',
    handler: async (context) => {
      return {
        success: true,
        message: '对话已清空'
      };
    }
  },
  {
    id: 'cmd-agent',
    name: '/agent',
    description: '切换或查看当前 Agent',
    type: 'system',
    args: [
      {
        name: 'name',
        description: 'Agent 名称 (developer/reviewer/creative)',
        required: false,
        type: 'choice',
        choices: ['developer', 'reviewer', 'creative']
      }
    ],
    handler: async (context) => {
      const agentName = context.args.name;
      if (agentName) {
        return {
          success: true,
          message: `已切换到 ${agentName}`,
          data: { agent: agentName }
        };
      }
      return {
        success: true,
        message: `当前 Agent: ${context.currentAgent || 'none'}`
      };
    }
  },
  {
    id: 'cmd-whisper',
    name: '/whisper',
    description: '发送私密消息',
    type: 'system',
    args: [
      {
        name: 'to',
        description: '接收者 (@agent 或 @user)',
        required: true,
        type: 'string'
      },
      {
        name: 'message',
        description: '消息内容',
        required: true,
        type: 'string'
      }
    ],
    handler: async (context) => {
      return {
        success: true,
        message: `私密消息已发送给 ${context.args.to}`,
        data: {
          to: context.args.to,
          message: context.args.message
        }
      };
    }
  },
  {
    id: 'cmd-project',
    name: '/project',
    description: '项目管理命令',
    type: 'system',
    args: [
      {
        name: 'action',
        description: '操作 (list/switch/create)',
        required: true,
        type: 'choice',
        choices: ['list', 'switch', 'create']
      },
      {
        name: 'name',
        description: '项目名称（switch/create 时需要）',
        required: false,
        type: 'string'
      }
    ],
    handler: async (context) => {
      const action = context.args.action;
      const name = context.args.name;
      
      switch (action) {
        case 'list':
          return {
            success: true,
            message: '项目列表',
            data: { projects: [] }
          };
        case 'switch':
          return {
            success: true,
            message: `已切换到项目: ${name}`,
            data: { project: name }
          };
        case 'create':
          return {
            success: true,
            message: `已创建项目: ${name}`,
            data: { project: name }
          };
        default:
          return {
            success: false,
            error: `未知操作: ${action}`
          };
      }
    }
  },
  {
    id: 'cmd-skill',
    name: '/skill',
    description: '技能管理命令',
    type: 'system',
    args: [
      {
        name: 'action',
        description: '操作 (list/enable/disable)',
        required: true,
        type: 'choice',
        choices: ['list', 'enable', 'disable']
      },
      {
        name: 'skillId',
        description: '技能 ID',
        required: false,
        type: 'string'
      }
    ],
    handler: async (context) => {
      return {
        success: true,
        message: `技能操作: ${context.args.action}`,
        data: { action: context.args.action }
      };
    }
  },
  {
    id: 'cmd-help',
    name: '/help',
    description: '显示帮助信息',
    type: 'system',
    args: [
      {
        name: 'command',
        description: '具体命令名',
        required: false,
        type: 'string'
      }
    ],
    handler: async (context) => {
      return {
        success: true,
        message: context.args.command 
          ? `命令 ${context.args.command} 的帮助`
          : '可用命令: /status, /clear, /agent, /whisper, /project, /skill, /help',
        data: { command: context.args.command }
      };
    }
  },
  {
    id: 'cmd-context',
    name: '/context',
    description: '上下文管理',
    type: 'system',
    args: [
      {
        name: 'action',
        description: '操作 (show/clear/summary)',
        required: true,
        type: 'choice',
        choices: ['show', 'clear', 'summary']
      }
    ],
    handler: async (context) => {
      return {
        success: true,
        message: `上下文操作: ${context.args.action}`,
        data: { action: context.args.action }
      };
    }
  },
  {
    id: 'cmd-export',
    name: '/export',
    description: '导出当前会话',
    type: 'system',
    options: [
      {
        name: 'format',
        alias: 'f',
        description: '导出格式 (md/json)',
        type: 'string',
        default: 'md'
      }
    ],
    handler: async (context) => {
      const format = context.options.format || 'md';
      return {
        success: true,
        message: `已导出为 ${format} 格式`,
        data: { format }
      };
    }
  },
  {
    id: 'cmd-cancel',
    name: '/cancel',
    description: '取消当前操作',
    type: 'system',
    handler: async (context) => {
      return {
        success: true,
        message: '当前操作已取消'
      };
    }
  }
];

// ============ 核心函数 ============

/**
 * 解析命令
 */
export function parseCommand(input: string): ParsedCommand {
  // 去除首尾空格
  const trimmed = input.trim();
  
  // 检查是否是命令（以 / 开头）
  if (!trimmed.startsWith('/')) {
    return {
      command: '',
      args: {},
      options: {},
      rawInput: trimmed,
      valid: false,
      error: 'Not a command'
    };
  }
  
  // 分割命令和参数
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args: Record<string, any> = {};
  const options: Record<string, any> = {};
  
  // 解析参数
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    
    // 检查是否是选项 (--key 或 -k)
    if (part.startsWith('--')) {
      const optionName = part.slice(2);
      const nextPart = parts[i + 1];
      if (nextPart && !nextPart.startsWith('-')) {
        options[optionName] = nextPart;
        i++;
      } else {
        options[optionName] = true;
      }
    } else if (part.startsWith('-') && part.length === 2) {
      const alias = part.slice(1);
      const nextPart = parts[i + 1];
      if (nextPart && !nextPart.startsWith('-')) {
        options[alias] = nextPart;
        i++;
      } else {
        options[alias] = true;
      }
    } else {
      // 位置参数
      const argIndex = Object.keys(args).length;
      args[`arg${argIndex}`] = part;
    }
  }
  
  return {
    command,
    args,
    options,
    rawInput: trimmed,
    valid: true
  };
}

/**
 * 查找命令
 */
export function findCommand(
  name: string,
  registry: Map<string, Command>
): Command | null {
  // 直接查找
  const cmd = registry.get(name);
  if (cmd) return cmd;
  
  // 查找别名
  for (const [_, cmd] of registry) {
    if (cmd.aliases?.includes(name)) {
      return cmd;
    }
  }
  
  return null;
}

/**
 * 验证命令参数
 */
export function validateCommandArgs(
  command: Command,
  parsed: ParsedCommand
): { valid: boolean; error?: string } {
  if (!command.args) return { valid: true };
  
  for (const argDef of command.args) {
    if (argDef.required) {
      const argKey = `arg${command.args.indexOf(argDef)}`;
      if (parsed.args[argKey] === undefined) {
        return {
          valid: false,
          error: `Missing required argument: ${argDef.name}`
        };
      }
    }
  }
  
  return { valid: true };
}

/**
 * 转换参数名
 */
function mapArgs(
  command: Command,
  parsed: ParsedCommand
): Record<string, any> {
  const mapped: Record<string, any> = {};
  
  if (!command.args) return mapped;
  
  command.args.forEach((argDef, index) => {
    const argKey = `arg${index}`;
    const value = parsed.args[argKey];
    
    if (value !== undefined) {
      // 类型转换
      switch (argDef.type) {
        case 'number':
          mapped[argDef.name] = Number(value);
          break;
        case 'boolean':
          mapped[argDef.name] = value === 'true' || value === true;
          break;
        default:
          mapped[argDef.name] = value;
      }
    } else if (argDef.default !== undefined) {
      mapped[argDef.name] = argDef.default;
    }
  });
  
  return mapped;
}

/**
 * 转换选项名
 */
function mapOptions(
  command: Command,
  parsed: ParsedCommand
): Record<string, any> {
  const mapped: Record<string, any> = {};
  
  if (!command.options) return mapped;
  
  for (const [key, value] of Object.entries(parsed.options)) {
    // 查找选项定义
    const optionDef = command.options.find(
      opt => opt.name === key || opt.alias === key
    );
    
    if (optionDef) {
      // 类型转换
      switch (optionDef.type) {
        case 'number':
          mapped[optionDef.name] = Number(value);
          break;
        case 'boolean':
          mapped[optionDef.name] = value === true || value === 'true';
          break;
        default:
          mapped[optionDef.name] = value;
      }
    } else {
      mapped[key] = value;
    }
  }
  
  // 应用默认值
  command.options.forEach(opt => {
    if (mapped[opt.name] === undefined && opt.default !== undefined) {
      mapped[opt.name] = opt.default;
    }
  });
  
  return mapped;
}

/**
 * 生成命令帮助
 */
export function generateCommandHelp(command: Command): string {
  const lines: string[] = [];
  
  lines.push(`## ${command.name}`);
  lines.push(command.description);
  lines.push('');
  
  if (command.aliases && command.aliases.length > 0) {
    lines.push(`**别名:** ${command.aliases.join(', ')}`);
    lines.push('');
  }
  
  if (command.args && command.args.length > 0) {
    lines.push('**参数:**');
    for (const arg of command.args) {
      const required = arg.required ? '(必需)' : '(可选)';
      const type = arg.type !== 'string' ? `[${arg.type}]` : '';
      lines.push(`  ${arg.name} ${type} ${required} - ${arg.description}`);
    }
    lines.push('');
  }
  
  if (command.options && command.options.length > 0) {
    lines.push('**选项:**');
    for (const opt of command.options) {
      const alias = opt.alias ? `(-${opt.alias})` : '';
      const type = opt.type !== 'string' ? `[${opt.type}]` : '';
      lines.push(`  --${opt.name} ${alias} ${type} - ${opt.description}`);
    }
    lines.push('');
  }
  
  if (command.help) {
    lines.push(`**用法:** ${command.help.usage}`);
    lines.push('');
    lines.push('**示例:**');
    for (const example of command.help.examples) {
      lines.push(`  ${example}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * 获取命令建议
 */
export function getCommandSuggestions(
  input: string,
  registry: Map<string, Command>
): CommandSuggestion[] {
  if (!input.startsWith('/')) return [];
  
  const query = input.slice(1).toLowerCase();
  const suggestions: CommandSuggestion[] = [];
  
  for (const [_, cmd] of registry) {
    // 检查名称匹配
    if (cmd.name.slice(1).toLowerCase().includes(query)) {
      suggestions.push({
        command: cmd.name,
        description: cmd.description,
        matchScore: 10
      });
    }
    // 检查别名
    else if (cmd.aliases?.some(alias => alias.slice(1).toLowerCase().includes(query))) {
      suggestions.push({
        command: cmd.name,
        description: cmd.description,
        matchScore: 8
      });
    }
  }
  
  return suggestions.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
}

/**
 * 检查是否是命令
 */
export function isCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * 格式化命令结果
 */
export function formatCommandResult(result: CommandResult): string {
  if (!result.success) {
    return `❌ 错误: ${result.error || '未知错误'}`;
  }
  
  let output = `✅ ${result.message || '执行成功'}`;
  
  if (result.data) {
    output += '\n' + JSON.stringify(result.data, null, 2);
  }
  
  return output;
}

// ============ CommandEngine 类 ============

/**
 * CommandEngine 类
 * 提供高级命令管理功能
 */
export class CommandEngine {
  private registry: Map<string, Command> = new Map();
  private history: CommandHistory[] = [];
  private maxHistory: number = 100;
  
  constructor() {
    // 注册内置命令
    this.registerBuiltinCommands();
  }
  
  /**
   * 注册内置命令
   */
  private registerBuiltinCommands(): void {
    for (const cmd of builtinCommands) {
      this.register(cmd);
    }
  }
  
  /**
   * 注册命令
   */
  register(command: Command): void {
    this.registry.set(command.name, command);
  }
  
  /**
   * 注销命令
   */
  unregister(commandName: string): boolean {
    const builtin = builtinCommands.find(c => c.name === commandName);
    if (builtin) return false; // 不能注销内置命令
    
    return this.registry.delete(commandName);
  }
  
  /**
   * 查找命令
   */
  find(name: string): Command | null {
    return findCommand(name, this.registry);
  }
  
  /**
   * 列出所有命令
   */
  list(): Command[] {
    return Array.from(this.registry.values());
  }
  
  /**
   * 执行命令
   */
  async execute(
    input: string,
    context?: Partial<CommandContext>
  ): Promise<CommandResult> {
    const startTime = Date.now();
    
    // 解析命令
    const parsed = parseCommand(input);
    if (!parsed.valid) {
      return {
        success: false,
        error: parsed.error || 'Invalid command'
      };
    }
    
    // 查找命令
    const command = this.find(parsed.command);
    if (!command) {
      return {
        success: false,
        error: `Unknown command: ${parsed.command}`
      };
    }
    
    // 验证参数
    const validation = validateCommandArgs(command, parsed);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }
    
    // 构建上下文
    const cmdContext: CommandContext = {
      command: parsed.command,
      args: mapArgs(command, parsed),
      options: mapOptions(command, parsed),
      rawInput: parsed.rawInput,
      ...context
    };
    
    // 执行
    try {
      const result = await command.handler(cmdContext);
      
      // 记录历史
      this.addHistory({
        id: `cmd_${Date.now()}`,
        command: parsed.command,
        args: cmdContext.args,
        result,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime
      });
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed'
      };
    }
  }
  
  /**
   * 添加历史记录
   */
  private addHistory(entry: CommandHistory): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
  
  /**
   * 获取历史记录
   */
  getHistory(limit?: number): CommandHistory[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }
  
  /**
   * 获取命令帮助
   */
  getHelp(commandName?: string): string {
    if (commandName) {
      const cmd = this.find(commandName);
      if (cmd) {
        return generateCommandHelp(cmd);
      }
      return `未找到命令: ${commandName}`;
    }
    
    // 列出所有命令
    const lines: string[] = [];
    lines.push('## 可用命令');
    lines.push('');
    
    const commands = this.list();
    for (const cmd of commands) {
      lines.push(`**${cmd.name}** - ${cmd.description}`);
    }
    
    lines.push('');
    lines.push('使用 `/help <命令名>` 查看详细帮助');
    
    return lines.join('\n');
  }
  
  /**
   * 获取命令建议
   */
  getSuggestions(input: string): CommandSuggestion[] {
    return getCommandSuggestions(input, this.registry);
  }
  
  /**
   * 检查是否是命令
   */
  isCommand(input: string): boolean {
    return isCommand(input);
  }
  
  /**
   * 自动补全
   */
  autocomplete(input: string): string {
    if (!input.startsWith('/')) return input;
    
    const query = input.toLowerCase();
    const commands = this.list();
    
    // 查找匹配
    const matches = commands.filter(cmd => 
      cmd.name.toLowerCase().startsWith(query)
    );
    
    if (matches.length === 1) {
      return matches[0].name;
    }
    
    return input;
  }
  
  /**
   * 清除历史
   */
  clearHistory(): void {
    this.history = [];
  }
  
  /**
   * 获取统计
   */
  getStats(): {
    totalCommands: number;
    builtinCommands: number;
    customCommands: number;
    historySize: number;
    mostUsed: Array<{ command: string; count: number }>;
  } {
    const commands = this.list();
    const builtinCount = commands.filter(c => c.type === 'system').length;
    
    // 统计使用频率
    const usage: Record<string, number> = {};
    for (const entry of this.history) {
      usage[entry.command] = (usage[entry.command] || 0) + 1;
    }
    
    const mostUsed = Object.entries(usage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([command, count]) => ({ command, count }));
    
    return {
      totalCommands: commands.length,
      builtinCommands: builtinCount,
      customCommands: commands.length - builtinCount,
      historySize: this.history.length,
      mostUsed
    };
  }
}
