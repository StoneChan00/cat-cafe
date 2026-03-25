/**
 * Knowledge Index
 * 轻量知识索引系统
 * Phase 2 核心组件：支持文档聚合、feature 索引和基础检索
 */

import { mkdir, readFile, writeFile, readdir, access } from 'fs/promises';
import { dirname, join, basename, extname, relative } from 'path';
import { randomUUID } from 'crypto';

// ============ 类型定义 ============

/**
 * 知识条目类型
 */
export type KnowledgeType = 'feature' | 'design' | 'backlog' | 'lesson' | 'reference';

/**
 * 知识条目 Frontmatter
 */
export interface KnowledgeFrontmatter {
  id: string;
  type: KnowledgeType;
  title: string;
  status: 'draft' | 'review' | 'approved' | 'archived';
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
  related?: string[]; // 相关条目 ID
  threadId?: string; // 关联的 thread
  priority?: 'low' | 'medium' | 'high';
}

/**
 * 知识条目
 */
export interface KnowledgeEntry {
  frontmatter: KnowledgeFrontmatter;
  content: string;
  path: string;
  summary?: string;
}

/**
 * Feature 聚合文档
 */
export interface FeatureDoc {
  id: string;
  name: string;
  description: string;
  status: KnowledgeFrontmatter['status'];
  designDocs: string[]; // 关联的设计文档路径
  backlogItems: string[]; // 关联的 backlog ID
  lessons: string[]; // 关联的经验教训
  createdAt: string;
  updatedAt: string;
}

/**
 * Backlog 条目
 */
export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  featureId?: string;
  threadId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 搜索选项
 */
export interface KnowledgeSearchOptions {
  type?: KnowledgeType;
  status?: KnowledgeFrontmatter['status'];
  tags?: string[];
  keyword?: string;
  threadId?: string;
  priority?: 'low' | 'medium' | 'high';
  limit?: number;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getKnowledgeDir(): string {
  return join(getDataDir(), 'knowledge');
}

function getFeaturesDir(): string {
  return join(getKnowledgeDir(), 'features');
}

function getDesignDir(): string {
  return join(getKnowledgeDir(), 'design');
}

function getBacklogDir(): string {
  return join(getKnowledgeDir(), 'backlog');
}

function getLessonsDir(): string {
  return join(getKnowledgeDir(), 'lessons');
}

function getIndexFilePath(): string {
  return join(getKnowledgeDir(), 'index.json');
}

// ============ 工具函数 ============

/**
 * 解析 Markdown Frontmatter
 */
function parseFrontmatter(content: string): { frontmatter: Partial<KnowledgeFrontmatter>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  
  const frontmatterText = match[1];
  const body = match[2].trim();
  
  const frontmatter: Partial<KnowledgeFrontmatter> = {};
  const lines = frontmatterText.split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    
    if (key === 'tags' || key === 'related') {
      (frontmatter as Record<string, string[]>)[key] = value
        .replace(/[\[\]]/g, '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      (frontmatter as Record<string, string>)[key] = value;
    }
  }
  
  return { frontmatter, body };
}

/**
 * 生成 Frontmatter 文本
 */
function generateFrontmatter(frontmatter: KnowledgeFrontmatter): string {
  const lines = ['---'];
  
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  
  lines.push('---');
  return lines.join('\n');
}

/**
 * 生成摘要（前 200 字符）
 */
function generateSummary(content: string, maxLength: number = 200): string {
  // 移除 Markdown 标记
  const plain = content
    .replace(/#+ /g, '')
    .replace(/\*\*|__/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
  
  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength) + '...';
}

// ============ 核心函数 ============

/**
 * 加载知识条目
 */
export async function loadKnowledgeEntry(filePath: string): Promise<KnowledgeEntry | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter: partialFrontmatter, body } = parseFrontmatter(content);
    
    const frontmatter: KnowledgeFrontmatter = {
      id: partialFrontmatter.id || randomUUID(),
      type: (partialFrontmatter.type as KnowledgeType) || 'reference',
      title: partialFrontmatter.title || basename(filePath, extname(filePath)),
      status: (partialFrontmatter.status as KnowledgeFrontmatter['status']) || 'draft',
      createdAt: partialFrontmatter.createdAt || new Date().toISOString(),
      updatedAt: partialFrontmatter.updatedAt || new Date().toISOString(),
      author: partialFrontmatter.author,
      tags: partialFrontmatter.tags,
      related: partialFrontmatter.related,
      threadId: partialFrontmatter.threadId,
      priority: partialFrontmatter.priority as 'low' | 'medium' | 'high'
    };
    
    return {
      frontmatter,
      content: body,
      path: filePath,
      summary: generateSummary(body)
    };
  } catch {
    return null;
  }
}

/**
 * 保存知识条目
 */
export async function saveKnowledgeEntry(entry: KnowledgeEntry): Promise<void> {
  // 更新更新时间
  entry.frontmatter.updatedAt = new Date().toISOString();
  
  const frontmatterText = generateFrontmatter(entry.frontmatter);
  const fullContent = `${frontmatterText}\n\n${entry.content}`;
  
  await mkdir(dirname(entry.path), { recursive: true });
  await writeFile(entry.path, fullContent, 'utf-8');
}

/**
 * 创建知识条目
 */
export async function createKnowledgeEntry(
  type: KnowledgeType,
  title: string,
  content: string,
  options?: Partial<Omit<KnowledgeFrontmatter, 'id' | 'type' | 'title' | 'createdAt' | 'updatedAt'>>
): Promise<KnowledgeEntry> {
  const id = randomUUID();
  const now = new Date().toISOString();
  
  let dir: string;
  switch (type) {
    case 'feature':
      dir = getFeaturesDir();
      break;
    case 'design':
      dir = getDesignDir();
      break;
    case 'backlog':
      dir = getBacklogDir();
      break;
    case 'lesson':
      dir = getLessonsDir();
      break;
    default:
      dir = getKnowledgeDir();
  }
  
  const fileName = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') + '.md';
  const filePath = join(dir, fileName);
  
  const frontmatter: KnowledgeFrontmatter = {
    id,
    type,
    title,
    status: options?.status || 'draft',
    createdAt: now,
    updatedAt: now,
    author: options?.author,
    tags: options?.tags,
    related: options?.related,
    threadId: options?.threadId,
    priority: options?.priority
  };
  
  const entry: KnowledgeEntry = {
    frontmatter,
    content,
    path: filePath,
    summary: generateSummary(content)
  };
  
  await saveKnowledgeEntry(entry);
  return entry;
}

/**
 * 扫描目录获取所有知识条目
 */
export async function scanKnowledgeEntries(type?: KnowledgeType): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  const dirs: string[] = [];
  
  if (!type || type === 'feature') dirs.push(getFeaturesDir());
  if (!type || type === 'design') dirs.push(getDesignDir());
  if (!type || type === 'backlog') dirs.push(getBacklogDir());
  if (!type || type === 'lesson') dirs.push(getLessonsDir());
  
  for (const dir of dirs) {
    try {
      await access(dir);
    } catch {
      continue;
    }
    
    const files = await readdir(dir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    for (const file of mdFiles) {
      const entry = await loadKnowledgeEntry(join(dir, file));
      if (entry) entries.push(entry);
    }
  }
  
  return entries.sort((a, b) => 
    new Date(b.frontmatter.updatedAt).getTime() - new Date(a.frontmatter.updatedAt).getTime()
  );
}

/**
 * 搜索知识条目
 */
export async function searchKnowledge(
  options: KnowledgeSearchOptions = {}
): Promise<KnowledgeEntry[]> {
  const entries = await scanKnowledgeEntries(options.type);
  
  return entries.filter(entry => {
    if (options.status && entry.frontmatter.status !== options.status) return false;
    if (options.threadId && entry.frontmatter.threadId !== options.threadId) return false;
    if (options.priority && entry.frontmatter.priority !== options.priority) return false;
    
    if (options.tags && options.tags.length > 0) {
      const entryTags = entry.frontmatter.tags || [];
      const hasTag = options.tags.some(tag => entryTags.includes(tag));
      if (!hasTag) return false;
    }
    
    if (options.keyword) {
      const keyword = options.keyword.toLowerCase();
      const inTitle = entry.frontmatter.title.toLowerCase().includes(keyword);
      const inContent = entry.content.toLowerCase().includes(keyword);
      const inTags = (entry.frontmatter.tags || []).some(t => t.toLowerCase().includes(keyword));
      if (!inTitle && !inContent && !inTags) return false;
    }
    
    return true;
  }).slice(0, options.limit || entries.length);
}

/**
 * 创建 Feature 聚合文档
 */
export async function createFeatureDoc(
  name: string,
  description: string,
  options?: {
    designDocs?: string[];
    backlogItems?: string[];
  }
): Promise<FeatureDoc> {
  const id = randomUUID();
  const now = new Date().toISOString();
  
  const featureDoc: FeatureDoc = {
    id,
    name,
    description,
    status: 'draft',
    designDocs: options?.designDocs || [],
    backlogItems: options?.backlogItems || [],
    lessons: [],
    createdAt: now,
    updatedAt: now
  };
  
  // 保存到文件
  const filePath = join(getFeaturesDir(), `${id}.json`);
  await mkdir(getFeaturesDir(), { recursive: true });
  await writeFile(filePath, JSON.stringify(featureDoc, null, 2), 'utf-8');
  
  return featureDoc;
}

/**
 * 加载 Feature 文档
 */
export async function loadFeatureDoc(featureId: string): Promise<FeatureDoc | null> {
  try {
    const filePath = join(getFeaturesDir(), `${featureId}.json`);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as FeatureDoc;
  } catch {
    return null;
  }
}

/**
 * 更新 Feature 文档
 */
export async function updateFeatureDoc(
  featureId: string,
  updates: Partial<FeatureDoc>
): Promise<FeatureDoc | null> {
  const feature = await loadFeatureDoc(featureId);
  if (!feature) return null;
  
  Object.assign(feature, updates);
  feature.updatedAt = new Date().toISOString();
  
  const filePath = join(getFeaturesDir(), `${featureId}.json`);
  await writeFile(filePath, JSON.stringify(feature, null, 2), 'utf-8');
  
  return feature;
}

/**
 * 添加 Backlog 条目
 */
export async function addBacklogItem(
  title: string,
  description: string,
  options?: {
    priority?: BacklogItem['priority'];
    featureId?: string;
  }
): Promise<BacklogItem> {
  const id = randomUUID();
  const now = new Date().toISOString();
  
  const item: BacklogItem = {
    id,
    title,
    description,
    status: 'todo',
    priority: options?.priority || 'medium',
    featureId: options?.featureId,
    createdAt: now,
    updatedAt: now
  };
  
  // 保存到文件
  const filePath = join(getBacklogDir(), `${id}.json`);
  await mkdir(getBacklogDir(), { recursive: true });
  await writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
  
  // 如果有关联 feature，更新 feature
  if (options?.featureId) {
    const feature = await loadFeatureDoc(options.featureId);
    if (feature) {
      feature.backlogItems.push(id);
      feature.updatedAt = now;
      await updateFeatureDoc(options.featureId, feature);
    }
  }
  
  return item;
}

/**
 * 加载 Backlog 条目
 */
export async function loadBacklogItem(itemId: string): Promise<BacklogItem | null> {
  try {
    const filePath = join(getBacklogDir(), `${itemId}.json`);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as BacklogItem;
  } catch {
    return null;
  }
}

/**
 * 更新 Backlog 状态
 */
export async function updateBacklogStatus(
  itemId: string,
  status: BacklogItem['status']
): Promise<BacklogItem | null> {
  const item = await loadBacklogItem(itemId);
  if (!item) return null;
  
  item.status = status;
  item.updatedAt = new Date().toISOString();
  
  const filePath = join(getBacklogDir(), `${itemId}.json`);
  await writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
  
  return item;
}

/**
 * 获取所有 Backlog
 */
export async function getAllBacklog(
  status?: BacklogItem['status']
): Promise<BacklogItem[]> {
  const items: BacklogItem[] = [];
  
  try {
    const dir = getBacklogDir();
    await access(dir);
    const files = await readdir(dir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const item = await loadBacklogItem(basename(file, '.json'));
      if (item && (!status || item.status === status)) {
        items.push(item);
      }
    }
  } catch {
    // 目录不存在返回空数组
  }
  
  return items.sort((a, b) => {
    // 按优先级排序（高 -> 中 -> 低）
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * 构建知识索引
 */
export async function buildKnowledgeIndex(): Promise<{
  totalEntries: number;
  byType: Record<KnowledgeType, number>;
  byStatus: Record<string, number>;
  recentEntries: KnowledgeEntry[];
}> {
  const entries = await scanKnowledgeEntries();
  
  const byType: Partial<Record<KnowledgeType, number>> = {};
  const byStatus: Record<string, number> = {};
  
  for (const entry of entries) {
    byType[entry.frontmatter.type] = (byType[entry.frontmatter.type] || 0) + 1;
    byStatus[entry.frontmatter.status] = (byStatus[entry.frontmatter.status] || 0) + 1;
  }
  
  const recentEntries = entries.slice(0, 10);
  
  const index = {
    totalEntries: entries.length,
    byType: byType as Record<KnowledgeType, number>,
    byStatus,
    recentEntries
  };
  
  // 保存索引
  const indexPath = getIndexFilePath();
  await mkdir(getKnowledgeDir(), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  
  return index;
}

/**
 * 加载知识索引
 */
export async function loadKnowledgeIndex(): Promise<ReturnType<typeof buildKnowledgeIndex> | null> {
  try {
    const indexPath = getIndexFilePath();
    const content = await readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ============ KnowledgeIndex 类 ============

/**
 * KnowledgeIndex 类
 * 提供高级知识管理功能
 */
export class KnowledgeIndex {
  private cache: Map<string, KnowledgeEntry> = new Map();
  
  /**
   * 创建知识条目
   */
  async create(
    type: KnowledgeType,
    title: string,
    content: string,
    options?: Partial<Omit<KnowledgeFrontmatter, 'id' | 'type' | 'title' | 'createdAt' | 'updatedAt'>>
  ): Promise<KnowledgeEntry> {
    const entry = await createKnowledgeEntry(type, title, content, options);
    this.cache.set(entry.frontmatter.id, entry);
    return entry;
  }
  
  /**
   * 获取知识条目
   */
  async get(id: string): Promise<KnowledgeEntry | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    
    // 扫描所有条目查找
    const entries = await scanKnowledgeEntries();
    const entry = entries.find(e => e.frontmatter.id === id);
    if (entry) {
      this.cache.set(id, entry);
    }
    return entry || null;
  }
  
  /**
   * 更新知识条目
   */
  async update(id: string, updates: Partial<KnowledgeEntry>): Promise<KnowledgeEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;
    
    if (updates.content) {
      entry.content = updates.content;
      entry.summary = generateSummary(updates.content);
    }
    
    if (updates.frontmatter) {
      Object.assign(entry.frontmatter, updates.frontmatter);
    }
    
    await saveKnowledgeEntry(entry);
    this.cache.set(id, entry);
    return entry;
  }
  
  /**
   * 搜索
   */
  async search(options: KnowledgeSearchOptions = {}): Promise<KnowledgeEntry[]> {
    return searchKnowledge(options);
  }
  
  /**
   * 扫描所有条目
   */
  async scan(type?: KnowledgeType): Promise<KnowledgeEntry[]> {
    return scanKnowledgeEntries(type);
  }
  
  /**
   * 创建 Feature
   */
  async createFeature(
    name: string,
    description: string,
    options?: { designDocs?: string[]; backlogItems?: string[] }
  ): Promise<FeatureDoc> {
    return createFeatureDoc(name, description, options);
  }
  
  /**
   * 获取 Feature
   */
  async getFeature(featureId: string): Promise<FeatureDoc | null> {
    return loadFeatureDoc(featureId);
  }
  
  /**
   * 添加 Backlog
   */
  async addBacklog(
    title: string,
    description: string,
    options?: { priority?: BacklogItem['priority']; featureId?: string }
  ): Promise<BacklogItem> {
    return addBacklogItem(title, description, options);
  }
  
  /**
   * 获取 Backlog
   */
  async getBacklog(status?: BacklogItem['status']): Promise<BacklogItem[]> {
    return getAllBacklog(status);
  }
  
  /**
   * 更新 Backlog 状态
   */
  async updateBacklog(itemId: string, status: BacklogItem['status']): Promise<BacklogItem | null> {
    return updateBacklogStatus(itemId, status);
  }
  
  /**
   * 构建索引
   */
  async buildIndex(): Promise<ReturnType<typeof buildKnowledgeIndex>> {
    return buildKnowledgeIndex();
  }
  
  /**
   * 加载索引
   */
  async loadIndex(): Promise<ReturnType<typeof buildKnowledgeIndex> | null> {
    return loadKnowledgeIndex();
  }
  
  /**
   * 获取相关条目
   */
  async getRelated(entryId: string): Promise<KnowledgeEntry[]> {
    const entry = await this.get(entryId);
    if (!entry?.frontmatter.related) return [];
    
    const related: KnowledgeEntry[] = [];
    for (const id of entry.frontmatter.related) {
      const relatedEntry = await this.get(id);
      if (relatedEntry) related.push(relatedEntry);
    }
    return related;
  }
  
  /**
   * 清空缓存
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
