/**
 * Skill Registry
 * 技能注册与管理系统
 * Phase 4 核心组件：支持动态技能加载和管理
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, readdir, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import type { AgentRole, ThreadContext } from '../types';

// ============ 类型定义 ============

/**
 * Skill 类型
 */
export type SkillType = 'tool' | 'prompt' | 'workflow' | 'integration';

/**
 * Skill 定义
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  version: string;
  
  // 作者信息
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  
  // 适用角色
  applicableAgents: AgentRole[];
  
  // 标签
  tags: string[];
  
  // 配置模式
  configSchema?: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    default?: any;
  }>;
  
  // 技能内容
  content: {
    // Tool 类型
    tool?: {
      name: string;
      description: string;
      parameters: Record<string, any>;
      handler: string; // 处理函数路径或代码
    };
    
    // Prompt 类型
    prompt?: {
      template: string;
      variables: string[];
      examples?: string[];
    };
    
    // Workflow 类型
    workflow?: {
      steps: Array<{
        id: string;
        name: string;
        type: 'agent' | 'tool' | 'condition';
        config: Record<string, any>;
        next?: string | string[];
      }>;
    };
    
    // Integration 类型
    integration?: {
      service: string;
      actions: Array<{
        name: string;
        description: string;
        parameters: Record<string, any>;
      }>;
    };
  };
  
  // 元数据
  metadata: {
    createdAt: string;
    updatedAt: string;
    usageCount: number;
    rating: number;
    isBuiltin: boolean;
    isActive: boolean;
  };
}

/**
 * Skill 实例（已配置的技能）
 */
export interface SkillInstance {
  id: string;
  skillId: string;
  projectId?: string;
  agentId?: AgentRole;
  config: Record<string, any>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Skill 执行上下文
 */
export interface SkillExecutionContext {
  threadContext: ThreadContext;
  agentId: AgentRole;
  projectId?: string;
  variables: Record<string, any>;
}

/**
 * Skill 执行结果
 */
export interface SkillExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  logs: string[];
  durationMs: number;
}

/**
 * Skill 过滤器
 */
export interface SkillFilter {
  type?: SkillType;
  agent?: AgentRole;
  tag?: string;
  builtin?: boolean;
  active?: boolean;
  search?: string;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getSkillsDir(): string {
  return join(getDataDir(), 'skills');
}

function getSkillFilePath(skillId: string): string {
  return join(getSkillsDir(), `${skillId}.json`);
}

function getInstancesDir(): string {
  return join(getDataDir(), 'skill-instances');
}

function getInstanceFilePath(instanceId: string): string {
  return join(getInstancesDir(), `${instanceId}.json`);
}

// ============ 内置 Skills ============

const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'skill-code-review',
    name: '代码审查',
    description: '自动代码审查和风格检查',
    type: 'prompt',
    version: '1.0.0',
    applicableAgents: ['reviewer'],
    tags: ['code', 'review', 'quality'],
    content: {
      prompt: {
        template: `请审查以下代码，关注：
1. 代码逻辑是否正确
2. 是否有安全隐患
3. 是否符合最佳实践
4. 命名是否清晰

代码：
{{code}}

语言：{{language}}`,
        variables: ['code', 'language']
      }
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      rating: 5,
      isBuiltin: true,
      isActive: true
    }
  },
  {
    id: 'skill-git-commit',
    name: 'Git 提交',
    description: '生成规范的 Git 提交信息',
    type: 'tool',
    version: '1.0.0',
    applicableAgents: ['developer'],
    tags: ['git', 'commit', 'workflow'],
    content: {
      tool: {
        name: 'generate_commit_message',
        description: '根据代码变更生成提交信息',
        parameters: {
          diff: { type: 'string', description: '代码差异' },
          style: { type: 'string', description: '提交风格 (conventional/angular)' }
        },
        handler: 'handlers/gitCommit.js'
      }
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      rating: 5,
      isBuiltin: true,
      isActive: true
    }
  },
  {
    id: 'skill-test-generate',
    name: '测试生成',
    description: '为代码自动生成测试用例',
    type: 'prompt',
    version: '1.0.0',
    applicableAgents: ['developer', 'reviewer'],
    tags: ['test', 'code', 'automation'],
    content: {
      prompt: {
        template: `请为以下代码生成测试用例：

代码：
{{code}}

要求：
- 使用 {{framework}} 框架
- 包含正常和异常用例
- 覆盖率尽可能高`,
        variables: ['code', 'framework']
      }
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      rating: 5,
      isBuiltin: true,
      isActive: true
    }
  }
];

// ============ 核心函数 ============

/**
 * 注册 Skill
 */
export async function registerSkill(skill: Omit<Skill, 'id' | 'metadata'>): Promise<Skill> {
  const newSkill: Skill = {
    ...skill,
    id: `skill-${randomUUID()}`,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      rating: 0,
      isBuiltin: false,
      isActive: true
    }
  };
  
  await saveSkill(newSkill);
  return newSkill;
}

/**
 * 保存 Skill
 */
export async function saveSkill(skill: Skill): Promise<void> {
  const filePath = getSkillFilePath(skill.id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(skill, null, 2), 'utf-8');
}

/**
 * 加载 Skill
 */
export async function loadSkill(skillId: string): Promise<Skill | null> {
  // 先检查内置 skills
  const builtin = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (builtin) return builtin;
  
  // 从文件加载
  try {
    const filePath = getSkillFilePath(skillId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Skill;
  } catch {
    return null;
  }
}

/**
 * 列出所有 Skills
 */
export async function listSkills(filter?: SkillFilter): Promise<Skill[]> {
  const skills: Skill[] = [...BUILTIN_SKILLS];
  
  // 加载自定义 skills
  try {
    const skillsDir = getSkillsDir();
    await access(skillsDir);
    const files = await readdir(skillsDir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const skill = await loadSkill(basename(file, '.json'));
      if (skill && !skill.metadata.isBuiltin) {
        skills.push(skill);
      }
    }
  } catch {
    // 目录不存在
  }
  
  // 应用过滤器
  return skills.filter(skill => {
    if (filter?.type && skill.type !== filter.type) return false;
    if (filter?.agent && !skill.applicableAgents.includes(filter.agent)) return false;
    if (filter?.tag && !skill.tags.includes(filter.tag)) return false;
    if (filter?.builtin !== undefined && skill.metadata.isBuiltin !== filter.builtin) return false;
    if (filter?.active !== undefined && skill.metadata.isActive !== filter.active) return false;
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      const matchName = skill.name.toLowerCase().includes(search);
      const matchDesc = skill.description.toLowerCase().includes(search);
      const matchTags = skill.tags.some(t => t.toLowerCase().includes(search));
      if (!matchName && !matchDesc && !matchTags) return false;
    }
    return true;
  });
}

/**
 * 获取 Agent 可用的 Skills
 */
export async function getAgentSkills(agentId: AgentRole): Promise<Skill[]> {
  return listSkills({ agent: agentId, active: true });
}

/**
 * 创建 Skill 实例
 */
export async function createSkillInstance(
  skillId: string,
  config: Record<string, any>,
  options?: {
    projectId?: string;
    agentId?: AgentRole;
  }
): Promise<SkillInstance | null> {
  const skill = await loadSkill(skillId);
  if (!skill) return null;
  
  const instance: SkillInstance = {
    id: `instance-${randomUUID()}`,
    skillId,
    projectId: options?.projectId,
    agentId: options?.agentId,
    config,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await saveSkillInstance(instance);
  return instance;
}

/**
 * 保存 Skill 实例
 */
export async function saveSkillInstance(instance: SkillInstance): Promise<void> {
  const filePath = getInstanceFilePath(instance.id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(instance, null, 2), 'utf-8');
}

/**
 * 加载 Skill 实例
 */
export async function loadSkillInstance(instanceId: string): Promise<SkillInstance | null> {
  try {
    const filePath = getInstanceFilePath(instanceId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as SkillInstance;
  } catch {
    return null;
  }
}

/**
 * 执行 Skill
 */
export async function executeSkill(
  skillId: string,
  context: SkillExecutionContext,
  inputs: Record<string, any>
): Promise<SkillExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  
  try {
    const skill = await loadSkill(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill ${skillId} not found`,
        logs: ['Error: Skill not found'],
        durationMs: Date.now() - startTime
      };
    }
    
    // 检查是否适用于当前 Agent
    if (!skill.applicableAgents.includes(context.agentId)) {
      return {
        success: false,
        error: `Skill ${skillId} is not applicable for agent ${context.agentId}`,
        logs: [`Error: Skill not applicable for ${context.agentId}`],
        durationMs: Date.now() - startTime
      };
    }
    
    // 根据类型执行
    switch (skill.type) {
      case 'prompt':
        return executePromptSkill(skill, context, inputs, logs, startTime);
      case 'tool':
        return executeToolSkill(skill, context, inputs, logs, startTime);
      case 'workflow':
        return executeWorkflowSkill(skill, context, inputs, logs, startTime);
      default:
        return {
          success: false,
          error: `Unsupported skill type: ${skill.type}`,
          logs: [`Error: Unsupported type ${skill.type}`],
          durationMs: Date.now() - startTime
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logs: [...logs, `Error: ${error}`],
      durationMs: Date.now() - startTime
    };
  }
}

/**
 * 执行 Prompt Skill
 */
function executePromptSkill(
  skill: Skill,
  context: SkillExecutionContext,
  inputs: Record<string, any>,
  logs: string[],
  startTime: number
): SkillExecutionResult {
  const prompt = skill.content.prompt;
  if (!prompt) {
    return {
      success: false,
      error: 'Prompt not defined',
      logs: [...logs, 'Error: No prompt defined'],
      durationMs: Date.now() - startTime
    };
  }
  
  // 填充模板
  let filledTemplate = prompt.template;
  for (const [key, value] of Object.entries(inputs)) {
    filledTemplate = filledTemplate.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  
  logs.push('Prompt template filled');
  
  return {
    success: true,
    output: filledTemplate,
    logs: [...logs, 'Prompt generated successfully'],
    durationMs: Date.now() - startTime
  };
}

/**
 * 执行 Tool Skill
 */
function executeToolSkill(
  skill: Skill,
  context: SkillExecutionContext,
  inputs: Record<string, any>,
  logs: string[],
  startTime: number
): SkillExecutionResult {
  const tool = skill.content.tool;
  if (!tool) {
    return {
      success: false,
      error: 'Tool not defined',
      logs: [...logs, 'Error: No tool defined'],
      durationMs: Date.now() - startTime
    };
  }
  
  logs.push(`Executing tool: ${tool.name}`);
  
  // 这里应该调用实际的 tool handler
  // 简化处理：返回模拟结果
  return {
    success: true,
    output: {
      tool: tool.name,
      inputs,
      result: 'Tool executed (mock)'
    },
    logs: [...logs, `Tool ${tool.name} executed`],
    durationMs: Date.now() - startTime
  };
}

/**
 * 执行 Workflow Skill
 */
function executeWorkflowSkill(
  skill: Skill,
  context: SkillExecutionContext,
  inputs: Record<string, any>,
  logs: string[],
  startTime: number
): SkillExecutionResult {
  const workflow = skill.content.workflow;
  if (!workflow) {
    return {
      success: false,
      error: 'Workflow not defined',
      logs: [...logs, 'Error: No workflow defined'],
      durationMs: Date.now() - startTime
    };
  }
  
  logs.push(`Executing workflow: ${workflow.steps.length} steps`);
  
  // 简化处理：返回工作流信息
  return {
    success: true,
    output: {
      steps: workflow.steps.map(s => s.name),
      inputs
    },
    logs: [...logs, 'Workflow executed'],
    durationMs: Date.now() - startTime
  };
}

/**
 * 更新 Skill 使用量
 */
export async function incrementSkillUsage(skillId: string): Promise<void> {
  const skill = await loadSkill(skillId);
  if (skill) {
    skill.metadata.usageCount++;
    skill.metadata.updatedAt = new Date().toISOString();
    await saveSkill(skill);
  }
}

/**
 * 评分 Skill
 */
export async function rateSkill(skillId: string, rating: number): Promise<void> {
  const skill = await loadSkill(skillId);
  if (skill) {
    // 简单平均
    const currentTotal = skill.metadata.rating * skill.metadata.usageCount;
    const newTotal = currentTotal + rating;
    skill.metadata.rating = newTotal / (skill.metadata.usageCount + 1);
    skill.metadata.updatedAt = new Date().toISOString();
    await saveSkill(skill);
  }
}

/**
 * 删除 Skill
 */
export async function deleteSkill(skillId: string): Promise<boolean> {
  // 不能删除内置 skill
  const builtin = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (builtin) return false;
  
  try {
    const filePath = getSkillFilePath(skillId);
    const { unlink } = await import('fs/promises');
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 Skill 统计
 */
export async function getSkillStats(): Promise<{
  total: number;
  builtin: number;
  custom: number;
  byType: Record<SkillType, number>;
  topRated: Array<{ id: string; name: string; rating: number }>;
  mostUsed: Array<{ id: string; name: string; usage: number }>;
}> {
  const skills = await listSkills();
  
  const byType: Partial<Record<SkillType, number>> = {};
  for (const skill of skills) {
    byType[skill.type] = (byType[skill.type] || 0) + 1;
  }
  
  const sortedByRating = [...skills]
    .filter(s => s.metadata.rating > 0)
    .sort((a, b) => b.metadata.rating - a.metadata.rating)
    .slice(0, 5)
    .map(s => ({ id: s.id, name: s.name, rating: s.metadata.rating }));
  
  const sortedByUsage = [...skills]
    .filter(s => s.metadata.usageCount > 0)
    .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
    .slice(0, 5)
    .map(s => ({ id: s.id, name: s.name, usage: s.metadata.usageCount }));
  
  return {
    total: skills.length,
    builtin: skills.filter(s => s.metadata.isBuiltin).length,
    custom: skills.filter(s => !s.metadata.isBuiltin).length,
    byType: byType as Record<SkillType, number>,
    topRated: sortedByRating,
    mostUsed: sortedByUsage
  };
}

// ============ SkillRegistry 类 ============

/**
 * SkillRegistry 类
 * 提供高级技能管理功能
 */
export class SkillRegistry {
  private cache: Map<string, Skill> = new Map();
  private instanceCache: Map<string, SkillInstance> = new Map();
  
  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    // 预加载内置 skills
    for (const skill of BUILTIN_SKILLS) {
      this.cache.set(skill.id, skill);
    }
  }
  
  /**
   * 注册 Skill
   */
  async register(skill: Omit<Skill, 'id' | 'metadata'>): Promise<Skill> {
    const newSkill = await registerSkill(skill);
    this.cache.set(newSkill.id, newSkill);
    return newSkill;
  }
  
  /**
   * 获取 Skill
   */
  async get(skillId: string): Promise<Skill | null> {
    const cached = this.cache.get(skillId);
    if (cached) return cached;
    
    const skill = await loadSkill(skillId);
    if (skill) {
      this.cache.set(skillId, skill);
    }
    return skill;
  }
  
  /**
   * 列出 Skills
   */
  async list(filter?: SkillFilter): Promise<Skill[]> {
    return listSkills(filter);
  }
  
  /**
   * 获取 Agent 的 Skills
   */
  async getForAgent(agentId: AgentRole): Promise<Skill[]> {
    return getAgentSkills(agentId);
  }
  
  /**
   * 创建实例
   */
  async createInstance(
    skillId: string,
    config: Record<string, any>,
    options?: { projectId?: string; agentId?: AgentRole }
  ): Promise<SkillInstance | null> {
    const instance = await createSkillInstance(skillId, config, options);
    if (instance) {
      this.instanceCache.set(instance.id, instance);
    }
    return instance;
  }
  
  /**
   * 获取实例
   */
  async getInstance(instanceId: string): Promise<SkillInstance | null> {
    const cached = this.instanceCache.get(instanceId);
    if (cached) return cached;
    
    const instance = await loadSkillInstance(instanceId);
    if (instance) {
      this.instanceCache.set(instanceId, instance);
    }
    return instance;
  }
  
  /**
   * 执行 Skill
   */
  async execute(
    skillId: string,
    context: SkillExecutionContext,
    inputs: Record<string, any>
  ): Promise<SkillExecutionResult> {
    const result = await executeSkill(skillId, context, inputs);
    if (result.success) {
      await incrementSkillUsage(skillId);
    }
    return result;
  }
  
  /**
   * 评分
   */
  async rate(skillId: string, rating: number): Promise<void> {
    await rateSkill(skillId, rating);
  }
  
  /**
   * 删除
   */
  async delete(skillId: string): Promise<boolean> {
    const result = await deleteSkill(skillId);
    if (result) {
      this.cache.delete(skillId);
    }
    return result;
  }
  
  /**
   * 获取统计
   */
  async getStats(): Promise<ReturnType<typeof getSkillStats>> {
    return getSkillStats();
  }
  
  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.instanceCache.clear();
  }
  
  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size + this.instanceCache.size;
  }
}
