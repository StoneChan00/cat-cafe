/**
 * Knowledge Hub
 * 增强知识管理中心
 * Phase 3 核心组件：全文检索、智能推荐和知识图谱
 */

import { mkdir, readFile, writeFile, readdir, access } from 'fs/promises';
import { dirname, join, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import type { KnowledgeEntry, FeatureDoc, BacklogItem, KnowledgeType } from './KnowledgeIndex';

// ============ 类型定义 ============

/**
 * 知识图谱节点
 */
export interface KnowledgeNode {
  id: string;
  type: KnowledgeType;
  title: string;
  tags: string[];
  relatedIds: string[];
  weight: number; // 重要性权重
  createdAt: string;
  lastAccessedAt: string;
}

/**
 * 知识图谱边
 */
export interface KnowledgeEdge {
  from: string;
  to: string;
  relation: 'references' | 'depends_on' | 'implements' | 'related_to';
  weight: number;
}

/**
 * 知识图谱
 */
export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  lastUpdated: string;
}

/**
 * 搜索选项
 */
export interface HubSearchOptions {
  query: string;
  types?: KnowledgeType[];
  tags?: string[];
  semantic?: boolean; // 是否启用语义搜索
  maxResults?: number;
  includeRelated?: boolean;
}

/**
 * 搜索结果
 */
export interface HubSearchResult {
  entry: KnowledgeEntry;
  score: number;
  matchType: 'exact' | 'partial' | 'semantic' | 'tag';
  relatedEntries?: KnowledgeEntry[];
}

/**
 * 智能推荐
 */
export interface SmartRecommendation {
  entry: KnowledgeEntry;
  reason: string;
  relevanceScore: number;
  basedOn: string[]; // 基于哪些访问记录
}

/**
 * 知识统计
 */
export interface KnowledgeStats {
  totalEntries: number;
  byType: Record<KnowledgeType, number>;
  totalTags: number;
  mostUsedTags: Array<{ tag: string; count: number }>;
  lastUpdated: string;
  orphanEntries: number; // 无关联的条目
  hotEntries: Array<{ id: string; title: string; accessCount: number }>;
}

// ============ 存储路径 ============

function getDataDir(): string {
  return process.env.CAT_CAFE_DATA_DIR || join(process.cwd(), '.cat-cafe-data');
}

function getKnowledgeDir(): string {
  return join(getDataDir(), 'knowledge');
}

function getGraphPath(): string {
  return join(getKnowledgeDir(), 'knowledge-graph.json');
}

function getStatsPath(): string {
  return join(getKnowledgeDir(), 'knowledge-stats.json');
}

function getAccessLogPath(): string {
  return join(getKnowledgeDir(), 'access-log.json');
}

// ============ 工具函数 ============

/**
 * 计算文本相似度（余弦相似度简化版）
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  // 提取长度大于2的词
  const words = text.toLowerCase().match(/[\u4e00-\u9fa5]+|[a-z]+/g) || [];
  return [...new Set(words.filter(w => w.length > 2))].slice(0, 20);
}

/**
 * 加载知识条目
 */
async function loadKnowledgeEntry(filePath: string): Promise<KnowledgeEntry | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 解析 frontmatter
    let inFrontmatter = false;
    let frontmatterText = '';
    let bodyStart = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          bodyStart = i + 1;
          break;
        }
      } else if (inFrontmatter) {
        frontmatterText += lines[i] + '\n';
      }
    }
    
    const frontmatter: Record<string, any> = {};
    for (const line of frontmatterText.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      
      if (key === 'tags' || key === 'related') {
        frontmatter[key] = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      } else {
        frontmatter[key] = value;
      }
    }
    
    const body = lines.slice(bodyStart).join('\n').trim();
    
    return {
      frontmatter: {
        id: frontmatter.id || randomUUID(),
        type: (frontmatter.type as KnowledgeType) || 'reference',
        title: frontmatter.title || basename(filePath, extname(filePath)),
        status: frontmatter.status || 'draft',
        createdAt: frontmatter.createdAt || new Date().toISOString(),
        updatedAt: frontmatter.updatedAt || new Date().toISOString(),
        author: frontmatter.author,
        tags: frontmatter.tags || [],
        related: frontmatter.related || [],
        threadId: frontmatter.threadId,
        priority: frontmatter.priority
      },
      content: body,
      path: filePath
    };
  } catch {
    return null;
  }
}

/**
 * 扫描所有知识条目
 */
async function scanAllEntries(): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  const dirs = ['features', 'design', 'backlog', 'lessons'];
  
  for (const dir of dirs) {
    const dirPath = join(getKnowledgeDir(), dir);
    try {
      await access(dirPath);
      const files = await readdir(dirPath);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const entry = await loadKnowledgeEntry(join(dirPath, file));
          if (entry) entries.push(entry);
        }
      }
    } catch {
      // 目录不存在，跳过
    }
  }
  
  return entries;
}

// ============ 核心函数 ============

/**
 * 构建知识图谱
 */
export async function buildKnowledgeGraph(): Promise<KnowledgeGraph> {
  const entries = await scanAllEntries();
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const nodeMap = new Map<string, KnowledgeNode>();
  
  // 创建节点
  for (const entry of entries) {
    const node: KnowledgeNode = {
      id: entry.frontmatter.id,
      type: entry.frontmatter.type,
      title: entry.frontmatter.title,
      tags: entry.frontmatter.tags || [],
      relatedIds: entry.frontmatter.related || [],
      weight: entry.frontmatter.priority === 'high' ? 3 : 
              entry.frontmatter.priority === 'medium' ? 2 : 1,
      createdAt: entry.frontmatter.createdAt,
      lastAccessedAt: entry.frontmatter.updatedAt
    };
    
    nodes.push(node);
    nodeMap.set(node.id, node);
  }
  
  // 创建边
  for (const entry of entries) {
    const fromId = entry.frontmatter.id;
    
    // 从 related 创建边
    for (const toId of entry.frontmatter.related || []) {
      if (nodeMap.has(toId)) {
        edges.push({
          from: fromId,
          to: toId,
          relation: 'related_to',
          weight: 1
        });
      }
    }
    
    // 从 tags 相似度创建边
    const fromNode = nodeMap.get(fromId);
    if (fromNode) {
      for (const otherNode of nodes) {
        if (otherNode.id === fromId) continue;
        
        const commonTags = fromNode.tags.filter(t => otherNode.tags.includes(t));
        if (commonTags.length > 0) {
          edges.push({
            from: fromId,
            to: otherNode.id,
            relation: 'related_to',
            weight: commonTags.length
          });
        }
      }
    }
  }
  
  const graph: KnowledgeGraph = {
    nodes,
    edges,
    lastUpdated: new Date().toISOString()
  };
  
  // 保存图谱
  await mkdir(getKnowledgeDir(), { recursive: true });
  await writeFile(getGraphPath(), JSON.stringify(graph, null, 2), 'utf-8');
  
  return graph;
}

/**
 * 加载知识图谱
 */
export async function loadKnowledgeGraph(): Promise<KnowledgeGraph | null> {
  try {
    const content = await readFile(getGraphPath(), 'utf-8');
    return JSON.parse(content) as KnowledgeGraph;
  } catch {
    return null;
  }
}

/**
 * 高级搜索
 */
export async function advancedSearch(
  options: HubSearchOptions
): Promise<HubSearchResult[]> {
  const entries = await scanAllEntries();
  const results: HubSearchResult[] = [];
  const query = options.query.toLowerCase();
  const queryKeywords = extractKeywords(options.query);
  
  for (const entry of entries) {
    let score = 0;
    let matchType: HubSearchResult['matchType'] = 'partial';
    
    // 标题匹配
    if (entry.frontmatter.title.toLowerCase().includes(query)) {
      score += 10;
      matchType = 'exact';
    }
    
    // 内容匹配
    const contentLower = entry.content.toLowerCase();
    if (contentLower.includes(query)) {
      score += 5;
    }
    
    // 标签匹配
    const entryTags = entry.frontmatter.tags || [];
    const matchingTags = entryTags.filter(t => 
      queryKeywords.some(kw => t.toLowerCase().includes(kw))
    );
    if (matchingTags.length > 0) {
      score += matchingTags.length * 3;
      matchType = 'tag';
    }
    
    // 语义匹配
    if (options.semantic && score === 0) {
      const similarity = calculateTextSimilarity(entry.content, options.query);
      if (similarity > 0.1) {
        score += similarity * 10;
        matchType = 'semantic';
      }
    }
    
    // 类型过滤
    if (options.types && !options.types.includes(entry.frontmatter.type)) {
      continue;
    }
    
    // 标签过滤
    if (options.tags) {
      const hasTag = options.tags.some(t => entryTags.includes(t));
      if (!hasTag) continue;
    }
    
    if (score > 0) {
      results.push({
        entry,
        score,
        matchType
      });
    }
  }
  
  // 排序
  results.sort((a, b) => b.score - a.score);
  
  // 获取相关条目
  if (options.includeRelated) {
    for (const result of results.slice(0, options.maxResults || 10)) {
      const relatedIds = result.entry.frontmatter.related || [];
      result.relatedEntries = [];
      
      for (const relatedId of relatedIds) {
        const related = entries.find(e => e.frontmatter.id === relatedId);
        if (related) {
          result.relatedEntries.push(related);
        }
      }
    }
  }
  
  return results.slice(0, options.maxResults || 10);
}

/**
 * 智能推荐
 */
export async function getRecommendations(
  basedOnEntryIds: string[],
  maxResults: number = 5
): Promise<SmartRecommendation[]> {
  const graph = await loadKnowledgeGraph();
  if (!graph) return [];
  
  const recommendations: SmartRecommendation[] = [];
  const scoredEntries = new Map<string, { score: number; reasons: string[] }>();
  
  // 基于访问记录评分
  for (const entryId of basedOnEntryIds) {
    const node = graph.nodes.find(n => n.id === entryId);
    if (!node) continue;
    
    // 相关节点加分
    const relatedEdges = graph.edges.filter(e => 
      e.from === entryId || e.to === entryId
    );
    
    for (const edge of relatedEdges) {
      const relatedId = edge.from === entryId ? edge.to : edge.from;
      const current = scoredEntries.get(relatedId) || { score: 0, reasons: [] };
      current.score += edge.weight;
      current.reasons.push(`与 "${node.title}" ${edge.relation}`);
      scoredEntries.set(relatedId, current);
    }
    
    // 相同标签加分
    const sameTagNodes = graph.nodes.filter(n => 
      n.id !== entryId && n.tags.some(t => node.tags.includes(t))
    );
    
    for (const sameTagNode of sameTagNodes) {
      const commonTags = sameTagNode.tags.filter(t => node.tags.includes(t));
      const current = scoredEntries.get(sameTagNode.id) || { score: 0, reasons: [] };
      current.score += commonTags.length;
      current.reasons.push(`共同标签: ${commonTags.join(', ')}`);
      scoredEntries.set(sameTagNode.id, current);
    }
  }
  
  // 获取条目详情
  const entries = await scanAllEntries();
  
  for (const [entryId, data] of scoredEntries) {
    if (basedOnEntryIds.includes(entryId)) continue; // 排除已访问的
    
    const entry = entries.find(e => e.frontmatter.id === entryId);
    if (entry) {
      recommendations.push({
        entry,
        reason: data.reasons.join('; '),
        relevanceScore: Math.min(data.score / 10, 1),
        basedOn: basedOnEntryIds
      });
    }
  }
  
  // 排序并返回
  return recommendations
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);
}

/**
 * 计算知识统计
 */
export async function calculateKnowledgeStats(): Promise<KnowledgeStats> {
  const entries = await scanAllEntries();
  const graph = await loadKnowledgeGraph();
  
  // 按类型统计
  const byType: Partial<Record<KnowledgeType, number>> = {};
  for (const entry of entries) {
    byType[entry.frontmatter.type] = (byType[entry.frontmatter.type] || 0) + 1;
  }
  
  // 标签统计
  const tagCount = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.frontmatter.tags || []) {
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    }
  }
  
  const mostUsedTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));
  
  // 孤立条目（无关联）
  const orphanEntries = entries.filter(e => 
    (e.frontmatter.related || []).length === 0 &&
    (e.frontmatter.tags || []).length === 0
  ).length;
  
  // 热门条目（基于权重）
  const hotEntries = (graph?.nodes || [])
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map(n => ({
      id: n.id,
      title: n.title,
      accessCount: n.weight
    }));
  
  const stats: KnowledgeStats = {
    totalEntries: entries.length,
    byType: byType as Record<KnowledgeType, number>,
    totalTags: tagCount.size,
    mostUsedTags,
    lastUpdated: new Date().toISOString(),
    orphanEntries,
    hotEntries
  };
  
  // 保存统计
  await writeFile(getStatsPath(), JSON.stringify(stats, null, 2), 'utf-8');
  
  return stats;
}

/**
 * 查找知识路径
 */
export async function findKnowledgePath(
  fromId: string,
  toId: string
): Promise<KnowledgeEntry[] | null> {
  const graph = await loadKnowledgeGraph();
  if (!graph) return null;
  
  // BFS 查找最短路径
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.id === toId) {
      // 找到路径，加载条目
      const entries = await scanAllEntries();
      return current.path
        .map(id => entries.find(e => e.frontmatter.id === id))
        .filter(Boolean) as KnowledgeEntry[];
    }
    
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    
    // 查找相邻节点
    const neighbors = graph.edges
      .filter(e => e.from === current.id && !visited.has(e.to))
      .map(e => e.to);
    
    for (const neighbor of neighbors) {
      queue.push({
        id: neighbor,
        path: [...current.path, neighbor]
      });
    }
  }
  
  return null;
}

// ============ KnowledgeHub 类 ============

/**
 * KnowledgeHub 类
 * 提供高级知识管理功能
 */
export class KnowledgeHub {
  private graph: KnowledgeGraph | null = null;
  private stats: KnowledgeStats | null = null;
  
  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.graph = await loadKnowledgeGraph();
    if (!this.graph) {
      this.graph = await buildKnowledgeGraph();
    }
    
    this.stats = await calculateKnowledgeStats();
  }
  
  /**
   * 搜索
   */
  async search(options: HubSearchOptions): Promise<HubSearchResult[]> {
    return advancedSearch(options);
  }
  
  /**
   * 获取推荐
   */
  async recommend(basedOnEntryIds: string[], maxResults?: number): Promise<SmartRecommendation[]> {
    return getRecommendations(basedOnEntryIds, maxResults);
  }
  
  /**
   * 获取统计
   */
  async getStats(): Promise<KnowledgeStats> {
    if (!this.stats) {
      this.stats = await calculateKnowledgeStats();
    }
    return this.stats;
  }
  
  /**
   * 获取图谱
   */
  async getGraph(): Promise<KnowledgeGraph | null> {
    if (!this.graph) {
      this.graph = await loadKnowledgeGraph();
    }
    return this.graph;
  }
  
  /**
   * 重建图谱
   */
  async rebuildGraph(): Promise<KnowledgeGraph> {
    this.graph = await buildKnowledgeGraph();
    return this.graph;
  }
  
  /**
   * 查找路径
   */
  async findPath(fromId: string, toId: string): Promise<KnowledgeEntry[] | null> {
    return findKnowledgePath(fromId, toId);
  }
  
  /**
   * 获取相关条目
   */
  async getRelated(entryId: string): Promise<KnowledgeEntry[]> {
    const graph = await this.getGraph();
    if (!graph) return [];
    
    const node = graph.nodes.find(n => n.id === entryId);
    if (!node) return [];
    
    const relatedIds = new Set<string>();
    
    // 从 related 字段
    node.relatedIds.forEach(id => relatedIds.add(id));
    
    // 从边
    graph.edges
      .filter(e => e.from === entryId || e.to === entryId)
      .forEach(e => {
        relatedIds.add(e.from === entryId ? e.to : e.from);
      });
    
    // 加载条目
    const entries = await scanAllEntries();
    return entries.filter(e => relatedIds.has(e.frontmatter.id));
  }
  
  /**
   * 获取标签云
   */
  async getTagCloud(): Promise<Array<{ tag: string; count: number; weight: number }>> {
    const stats = await this.getStats();
    const maxCount = Math.max(...stats.mostUsedTags.map(t => t.count), 1);
    
    return stats.mostUsedTags.map(t => ({
      tag: t.tag,
      count: t.count,
      weight: t.count / maxCount
    }));
  }
  
  /**
   * 刷新
   */
  async refresh(): Promise<void> {
    await this.rebuildGraph();
    this.stats = await calculateKnowledgeStats();
  }
}
