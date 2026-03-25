/**
 * Project Manager
 * 多项目配置管理系统
 * Phase 4 核心组件：支持项目隔离和切换
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, readdir, access, rmdir } from 'fs/promises';
import { dirname, join, basename } from 'path';
import type { AgentConfig, AgentRole } from '../types';

// ============ 类型定义 ============

/**
 * 项目配置
 */
export interface ProjectConfig {
  id: string;
  name: string;
  description: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  
  // Agent 配置覆盖
  agentOverrides?: Partial<Record<AgentRole, Partial<AgentConfig>>>;
  
  // 项目特定设置
  settings: {
    defaultAgent: AgentRole;
    autoSave: boolean;
    contextBudget: number;
    sealingThreshold: number;
    enableWhisper: boolean;
    enableRichBlocks: boolean;
  };
  
  // 环境变量
  env: Record<string, string>;
  
  // 忽略模式（文件搜索）
  ignorePatterns: string[];
  
  // 关联的 skills
  enabledSkills: string[];
  
  // 元数据
  metadata: {
    lastSessionId?: string;
    totalSessions: number;
    totalInvocations: number;
  };
}

/**
 * 项目创建选项
 */
export interface ProjectCreateOptions {
  name: string;
  description?: string;
  rootPath: string;
  agentOverrides?: ProjectConfig['agentOverrides'];
  settings?: Partial<ProjectConfig['settings']>;
  env?: Record<string, string>;
}

/**
 * 项目切换上下文
 */
export interface ProjectSwitchContext {
  fromProjectId?: string;
  toProjectId: string;
  preserveContext: boolean;
  timestamp: string;
}

/**
 * 项目统计
 */
export interface ProjectStats {
  projectId: string;
  totalSessions: number;
  totalInvocations: number;
  totalMessages: number;
  diskUsage: number;
  lastActive: string;
}

/**
 * 项目列表项
 */
export interface ProjectListItem {
  id: string;
  name: string;
  description: string;
  rootPath: string;
  isActive: boolean;
  lastActive: string;
  sessionCount: number;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getProjectsDir(): string {
  return join(getDataDir(), 'projects');
}

function getProjectFilePath(projectId: string): string {
  return join(getProjectsDir(), `${projectId}.json`);
}

function getActiveProjectFilePath(): string {
  return join(getProjectsDir(), 'active-project.json');
}

function getProjectDataDir(projectId: string): string {
  return join(getDataDir(), 'projects-data', projectId);
}

// ============ 核心函数 ============

/**
 * 创建项目配置
 */
export function createProjectConfig(options: ProjectCreateOptions): ProjectConfig {
  const now = new Date().toISOString();
  
  return {
    id: randomUUID(),
    name: options.name,
    description: options.description || '',
    rootPath: options.rootPath,
    createdAt: now,
    updatedAt: now,
    agentOverrides: options.agentOverrides,
    settings: {
      defaultAgent: 'developer',
      autoSave: true,
      contextBudget: 150000,
      sealingThreshold: 0.9,
      enableWhisper: true,
      enableRichBlocks: true,
      ...options.settings
    },
    env: options.env || {},
    ignorePatterns: [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.cat-cafe-data'
    ],
    enabledSkills: [],
    metadata: {
      totalSessions: 0,
      totalInvocations: 0
    }
  };
}

/**
 * 保存项目配置
 */
export async function saveProjectConfig(project: ProjectConfig): Promise<void> {
  const filePath = getProjectFilePath(project.id);
  await mkdir(dirname(filePath), { recursive: true });
  await mkdir(getProjectDataDir(project.id), { recursive: true });
  
  project.updatedAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(project, null, 2), 'utf-8');
}

/**
 * 加载项目配置
 */
export async function loadProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  try {
    const filePath = getProjectFilePath(projectId);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * 列出所有项目
 */
export async function listProjects(): Promise<ProjectListItem[]> {
  const projectsDir = getProjectsDir();
  const projects: ProjectListItem[] = [];
  
  try {
    await access(projectsDir);
    const files = await readdir(projectsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'active-project.json');
    
    // 获取当前活跃项目
    const activeProjectId = await getActiveProjectId();
    
    for (const file of jsonFiles) {
      const projectId = basename(file, '.json');
      const project = await loadProjectConfig(projectId);
      
      if (project) {
        projects.push({
          id: project.id,
          name: project.name,
          description: project.description,
          rootPath: project.rootPath,
          isActive: project.id === activeProjectId,
          lastActive: project.updatedAt,
          sessionCount: project.metadata.totalSessions
        });
      }
    }
    
    // 按最后活跃时间排序
    projects.sort((a, b) => 
      new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
    );
    
    return projects;
  } catch {
    return [];
  }
}

/**
 * 设置活跃项目
 */
export async function setActiveProject(projectId: string): Promise<void> {
  const filePath = getActiveProjectFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  
  await writeFile(filePath, JSON.stringify({ projectId }, null, 2), 'utf-8');
}

/**
 * 获取活跃项目 ID
 */
export async function getActiveProjectId(): Promise<string | null> {
  try {
    const filePath = getActiveProjectFilePath();
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.projectId || null;
  } catch {
    return null;
  }
}

/**
 * 获取活跃项目
 */
export async function getActiveProject(): Promise<ProjectConfig | null> {
  const activeId = await getActiveProjectId();
  if (!activeId) return null;
  return loadProjectConfig(activeId);
}

/**
 * 切换项目
 */
export async function switchProject(
  toProjectId: string,
  preserveContext: boolean = true
): Promise<ProjectSwitchContext> {
  const fromProjectId = await getActiveProjectId();
  
  // 验证目标项目存在
  const toProject = await loadProjectConfig(toProjectId);
  if (!toProject) {
    throw new Error(`Project ${toProjectId} not found`);
  }
  
  // 设置新的活跃项目
  await setActiveProject(toProjectId);
  
  return {
    fromProjectId: fromProjectId || undefined,
    toProjectId,
    preserveContext,
    timestamp: new Date().toISOString()
  };
}

/**
 * 删除项目
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  const project = await loadProjectConfig(projectId);
  if (!project) return false;
  
  // 删除配置文件
  const filePath = getProjectFilePath(projectId);
  try {
    await access(filePath);
    // 不实际删除文件，只标记为删除或移动
    // 这里简单处理：删除文件
    const { unlink } = await import('fs/promises');
    await unlink(filePath);
  } catch {
    // 文件不存在
  }
  
  // 如果删除的是活跃项目，清除活跃状态
  const activeId = await getActiveProjectId();
  if (activeId === projectId) {
    const { unlink } = await import('fs/promises');
    try {
      await unlink(getActiveProjectFilePath());
    } catch {
      // 忽略错误
    }
  }
  
  return true;
}

/**
 * 更新项目配置
 */
export async function updateProjectConfig(
  projectId: string,
  updates: Partial<ProjectConfig>
): Promise<ProjectConfig | null> {
  const project = await loadProjectConfig(projectId);
  if (!project) return null;
  
  // 应用更新
  Object.assign(project, updates);
  project.updatedAt = new Date().toISOString();
  
  await saveProjectConfig(project);
  return project;
}

/**
 * 获取项目特定的 Agent 配置
 */
export async function getProjectAgentConfig(
  projectId: string,
  agentId: AgentRole
): Promise<Partial<AgentConfig> | null> {
  const project = await loadProjectConfig(projectId);
  if (!project) return null;
  
  return project.agentOverrides?.[agentId] || null;
}

/**
 * 设置项目环境变量
 */
export async function setProjectEnv(
  projectId: string,
  key: string,
  value: string
): Promise<boolean> {
  const project = await loadProjectConfig(projectId);
  if (!project) return false;
  
  project.env[key] = value;
  await saveProjectConfig(project);
  return true;
}

/**
 * 获取项目环境变量
 */
export async function getProjectEnv(
  projectId: string,
  key: string
): Promise<string | undefined> {
  const project = await loadProjectConfig(projectId);
  if (!project) return undefined;
  
  const value = project.env[key];
  return value !== undefined ? value : undefined;
}

/**
 * 启用/禁用 Skill
 */
export async function toggleProjectSkill(
  projectId: string,
  skillId: string,
  enabled: boolean
): Promise<boolean> {
  const project = await loadProjectConfig(projectId);
  if (!project) return false;
  
  if (enabled) {
    if (!project.enabledSkills.includes(skillId)) {
      project.enabledSkills.push(skillId);
    }
  } else {
    project.enabledSkills = project.enabledSkills.filter(s => s !== skillId);
  }
  
  await saveProjectConfig(project);
  return true;
}

/**
 * 获取项目统计
 */
export async function getProjectStats(projectId: string): Promise<ProjectStats | null> {
  const project = await loadProjectConfig(projectId);
  if (!project) return null;
  
  // 计算磁盘使用量（简化）
  const dataDir = getProjectDataDir(projectId);
  let diskUsage = 0;
  
  try {
    await access(dataDir);
    // 这里应该递归计算目录大小，简化处理
    diskUsage = 0;
  } catch {
    diskUsage = 0;
  }
  
  return {
    projectId,
    totalSessions: project.metadata.totalSessions,
    totalInvocations: project.metadata.totalInvocations,
    totalMessages: 0, // 需要从其他存储获取
    diskUsage,
    lastActive: project.updatedAt
  };
}

/**
 * 验证项目路径
 */
export async function validateProjectPath(rootPath: string): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    await access(rootPath);
  } catch {
    errors.push('路径不存在');
    return { valid: false, errors };
  }
  
  // 检查是否是 git 仓库
  try {
    await access(join(rootPath, '.git'));
  } catch {
    errors.push('不是 Git 仓库（可选）');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 导出项目配置
 */
export async function exportProjectConfig(projectId: string): Promise<string | null> {
  const project = await loadProjectConfig(projectId);
  if (!project) return null;
  
  return JSON.stringify(project, null, 2);
}

/**
 * 导入项目配置
 */
export async function importProjectConfig(json: string): Promise<ProjectConfig | null> {
  try {
    const project = JSON.parse(json) as ProjectConfig;
    
    // 生成新 ID 避免冲突
    project.id = randomUUID();
    project.createdAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    project.metadata.totalSessions = 0;
    project.metadata.totalInvocations = 0;
    
    await saveProjectConfig(project);
    return project;
  } catch {
    return null;
  }
}

// ============ ProjectManager 类 ============

/**
 * ProjectManager 类
 * 提供高级项目管理功能
 */
export class ProjectManager {
  private cache: Map<string, ProjectConfig> = new Map();
  private activeProject: ProjectConfig | null = null;
  
  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    const activeId = await getActiveProjectId();
    if (activeId) {
      this.activeProject = await this.get(activeId);
    }
  }
  
  /**
   * 创建项目
   */
  async create(options: ProjectCreateOptions): Promise<ProjectConfig> {
    const project = createProjectConfig(options);
    await saveProjectConfig(project);
    this.cache.set(project.id, project);
    return project;
  }
  
  /**
   * 获取项目
   */
  async get(projectId: string): Promise<ProjectConfig | null> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    
    const project = await loadProjectConfig(projectId);
    if (project) {
      this.cache.set(projectId, project);
    }
    return project;
  }
  
  /**
   * 获取活跃项目
   */
  async getActive(): Promise<ProjectConfig | null> {
    if (this.activeProject) return this.activeProject;
    
    const activeId = await getActiveProjectId();
    if (!activeId) return null;
    
    this.activeProject = await this.get(activeId);
    return this.activeProject;
  }
  
  /**
   * 设置活跃项目
   */
  async setActive(projectId: string): Promise<void> {
    await setActiveProject(projectId);
    this.activeProject = await this.get(projectId);
  }
  
  /**
   * 切换项目
   */
  async switch(projectId: string, preserveContext: boolean = true): Promise<ProjectSwitchContext> {
    const context = await switchProject(projectId, preserveContext);
    await this.setActive(projectId);
    return context;
  }
  
  /**
   * 更新项目
   */
  async update(projectId: string, updates: Partial<ProjectConfig>): Promise<ProjectConfig | null> {
    const project = await updateProjectConfig(projectId, updates);
    if (project) {
      this.cache.set(projectId, project);
      if (this.activeProject?.id === projectId) {
        this.activeProject = project;
      }
    }
    return project;
  }
  
  /**
   * 删除项目
   */
  async delete(projectId: string): Promise<boolean> {
    const result = await deleteProject(projectId);
    if (result) {
      this.cache.delete(projectId);
      if (this.activeProject?.id === projectId) {
        this.activeProject = null;
      }
    }
    return result;
  }
  
  /**
   * 列出项目
   */
  async list(): Promise<ProjectListItem[]> {
    return listProjects();
  }
  
  /**
   * 获取 Agent 配置（合并项目覆盖）
   */
  async getAgentConfig(
    projectId: string,
    baseConfig: AgentConfig
  ): Promise<AgentConfig> {
    const overrides = await getProjectAgentConfig(projectId, baseConfig.id);
    if (!overrides) return baseConfig;
    
    return {
      ...baseConfig,
      ...overrides
    };
  }
  
  /**
   * 获取环境变量
   */
  async getEnv(projectId: string, key: string): Promise<string | undefined> {
    return getProjectEnv(projectId, key);
  }
  
  /**
   * 设置环境变量
   */
  async setEnv(projectId: string, key: string, value: string): Promise<boolean> {
    return setProjectEnv(projectId, key, value);
  }
  
  /**
   * 获取统计
   */
  async getStats(projectId: string): Promise<ProjectStats | null> {
    return getProjectStats(projectId);
  }
  
  /**
   * 导出项目
   */
  async export(projectId: string): Promise<string | null> {
    return exportProjectConfig(projectId);
  }
  
  /**
   * 导入项目
   */
  async import(json: string): Promise<ProjectConfig | null> {
    return importProjectConfig(json);
  }
  
  /**
   * 获取活跃项目的配置项
   */
  async getActiveSetting<K extends keyof ProjectConfig['settings']>(
    key: K
  ): Promise<ProjectConfig['settings'][K] | undefined> {
    const project = await this.getActive();
    return project?.settings[key];
  }
  
  /**
   * 更新活跃项目的配置项
   */
  async updateActiveSetting<K extends keyof ProjectConfig['settings']>(
    key: K,
    value: ProjectConfig['settings'][K]
  ): Promise<void> {
    const activeId = await getActiveProjectId();
    if (!activeId) throw new Error('No active project');
    
    const project = await this.get(activeId);
    if (!project) throw new Error('Active project not found');
    
    project.settings[key] = value;
    await this.update(activeId, { settings: project.settings });
  }
  
  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
