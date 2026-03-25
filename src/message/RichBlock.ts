/**
 * Rich Block System
 * 富文本消息块系统
 * Phase 4 核心组件：支持结构化消息展示
 */

// ============ 类型定义 ============

/**
 * Rich Block 类型
 */
export type RichBlockType = 
  | 'text'           // 纯文本
  | 'code'           // 代码块
  | 'diff'           // 代码差异
  | 'list'           // 列表
  | 'table'          // 表格
  | 'quote'          // 引用
  | 'image'          // 图片
  | 'link'           // 链接
  | 'file'           // 文件
  | 'status'         // 状态
  | 'progress'       // 进度条
  | 'mermaid'        // Mermaid 图表
  | 'collapse'       // 可折叠区域
  | 'tabs'           // 标签页
  | 'callout';       // 提示框

/**
 * Rich Block 基础接口
 */
export interface RichBlock {
  type: RichBlockType;
  id: string;
  title?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  metadata?: Record<string, any>;
}

/**
 * 文本块
 */
export interface TextBlock extends RichBlock {
  type: 'text';
  content: string;
  format?: 'plain' | 'markdown' | 'html';
}

/**
 * 代码块
 */
export interface CodeBlock extends RichBlock {
  type: 'code';
  language: string;
  code: string;
  filename?: string;
  lineNumbers?: boolean;
  highlights?: number[]; // 高亮行号
}

/**
 * 差异块
 */
export interface DiffBlock extends RichBlock {
  type: 'diff';
  oldCode: string;
  newCode: string;
  filename: string;
  additions: number;
  deletions: number;
}

/**
 * 列表块
 */
export interface ListBlock extends RichBlock {
  type: 'list';
  items: Array<{ text: string; checked?: boolean }>;
  ordered: boolean;
}

/**
 * 表格块
 */
export interface TableBlock extends RichBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

/**
 * 引用块
 */
export interface QuoteBlock extends RichBlock {
  type: 'quote';
  content: string;
  author?: string;
  source?: string;
}

/**
 * 图片块
 */
export interface ImageBlock extends RichBlock {
  type: 'image';
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/**
 * 链接块
 */
export interface LinkBlock extends RichBlock {
  type: 'link';
  url: string;
  text: string;
  description?: string;
}

/**
 * 文件块
 */
export interface FileBlock extends RichBlock {
  type: 'file';
  filename: string;
  size: number;
  mimeType: string;
  downloadUrl?: string;
}

/**
 * 状态块
 */
export interface StatusBlock extends RichBlock {
  type: 'status';
  status: 'success' | 'warning' | 'error' | 'info' | 'loading';
  message: string;
  details?: string;
}

/**
 * 进度块
 */
export interface ProgressBlock extends RichBlock {
  type: 'progress';
  current: number;
  total: number;
  percentage: number;
  label: string;
}

/**
 * Mermaid 图表块
 */
export interface MermaidBlock extends RichBlock {
  type: 'mermaid';
  diagram: string;
  diagramType: 'flowchart' | 'sequence' | 'class' | 'state' | 'er' | 'gantt';
}

/**
 * 折叠块
 */
export interface CollapseBlock extends RichBlock {
  type: 'collapse';
  title: string;
  content: RichBlock[];
  defaultCollapsed?: boolean;
}

/**
 * 标签页块
 */
export interface TabsBlock extends RichBlock {
  type: 'tabs';
  tabs: Array<{ label: string; content: RichBlock[] }>;
  activeTab?: number;
}

/**
 * 提示框块
 */
export interface CalloutBlock extends RichBlock {
  type: 'callout';
  variant: 'info' | 'warning' | 'success' | 'error' | 'tip';
  title: string;
  content: string;
}

/**
 * Rich Message
 */
export interface RichMessage {
  id: string;
  timestamp: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  blocks: RichBlock[];
  plainTextFallback: string;
  metadata?: {
    threadId?: string;
    sessionId?: string;
    agentId?: string;
  };
}

/**
 * Block 渲染选项
 */
export interface RenderOptions {
  theme?: 'light' | 'dark';
  codeTheme?: string;
  maxHeight?: number;
  enableInteractions?: boolean;
}

// ============ Block 工厂 ============

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 创建文本块
 */
export function createTextBlock(content: string, options?: Partial<TextBlock>): TextBlock {
  return {
    type: 'text',
    id: options?.id || generateId(),
    content,
    format: options?.format || 'markdown',
    ...options
  };
}

/**
 * 创建代码块
 */
export function createCodeBlock(
  code: string, 
  language: string, 
  options?: Partial<CodeBlock>
): CodeBlock {
  return {
    type: 'code',
    id: options?.id || generateId(),
    language,
    code,
    lineNumbers: options?.lineNumbers ?? true,
    ...options
  };
}

/**
 * 创建差异块
 */
export function createDiffBlock(
  oldCode: string,
  newCode: string,
  filename: string,
  options?: Partial<DiffBlock>
): DiffBlock {
  const oldLines = oldCode.split('\n').length;
  const newLines = newCode.split('\n').length;
  
  return {
    type: 'diff',
    id: options?.id || generateId(),
    oldCode,
    newCode,
    filename,
    additions: newLines,
    deletions: oldLines,
    ...options
  };
}

/**
 * 创建列表块
 */
export function createListBlock(
  items: Array<{ text: string; checked?: boolean }>,
  ordered: boolean = false,
  options?: Partial<ListBlock>
): ListBlock {
  return {
    type: 'list',
    id: options?.id || generateId(),
    items,
    ordered,
    ...options
  };
}

/**
 * 创建表格块
 */
export function createTableBlock(
  headers: string[],
  rows: string[][],
  options?: Partial<TableBlock>
): TableBlock {
  return {
    type: 'table',
    id: options?.id || generateId(),
    headers,
    rows,
    ...options
  };
}

/**
 * 创建状态块
 */
export function createStatusBlock(
  status: StatusBlock['status'],
  message: string,
  options?: Partial<StatusBlock>
): StatusBlock {
  return {
    type: 'status',
    id: options?.id || generateId(),
    status,
    message,
    ...options
  };
}

/**
 * 创建进度块
 */
export function createProgressBlock(
  current: number,
  total: number,
  label: string,
  options?: Partial<ProgressBlock>
): ProgressBlock {
  const percentage = Math.round((current / total) * 100);
  return {
    type: 'progress',
    id: options?.id || generateId(),
    current,
    total,
    percentage,
    label,
    ...options
  };
}

/**
 * 创建提示框块
 */
export function createCalloutBlock(
  variant: CalloutBlock['variant'],
  title: string,
  content: string,
  options?: Partial<CalloutBlock>
): CalloutBlock {
  return {
    type: 'callout',
    id: options?.id || generateId(),
    variant,
    title,
    content,
    ...options
  };
}

/**
 * 创建折叠块
 */
export function createCollapseBlock(
  title: string,
  content: RichBlock[],
  options?: Partial<CollapseBlock>
): CollapseBlock {
  return {
    type: 'collapse',
    id: options?.id || generateId(),
    title,
    content,
    defaultCollapsed: options?.defaultCollapsed ?? false,
    ...options
  };
}

/**
 * 创建标签页块
 */
export function createTabsBlock(
  tabs: Array<{ label: string; content: RichBlock[] }>,
  options?: Partial<TabsBlock>
): TabsBlock {
  return {
    type: 'tabs',
    id: options?.id || generateId(),
    tabs,
    activeTab: options?.activeTab ?? 0,
    ...options
  };
}

// ============ 渲染引擎 ============

/**
 * 将 Block 渲染为 HTML
 */
export function renderBlockToHTML(block: RichBlock, options: RenderOptions = {}): string {
  const theme = options.theme || 'light';
  
  switch (block.type) {
    case 'text':
      return renderTextBlock(block as TextBlock, theme);
    case 'code':
      return renderCodeBlock(block as CodeBlock, theme);
    case 'diff':
      return renderDiffBlock(block as DiffBlock, theme);
    case 'list':
      return renderListBlock(block as ListBlock, theme);
    case 'table':
      return renderTableBlock(block as TableBlock, theme);
    case 'status':
      return renderStatusBlock(block as StatusBlock, theme);
    case 'progress':
      return renderProgressBlock(block as ProgressBlock, theme);
    case 'callout':
      return renderCalloutBlock(block as CalloutBlock, theme);
    case 'collapse':
      return renderCollapseBlock(block as CollapseBlock, theme, options);
    case 'tabs':
      return renderTabsBlock(block as TabsBlock, theme, options);
    default:
      return `<div class="block-unknown">Unknown block type: ${block.type}</div>`;
  }
}

function renderTextBlock(block: TextBlock, theme: string): string {
  const escaped = escapeHtml(block.content);
  return `<div class="rich-text ${theme}" data-block-id="${block.id}">${escaped}</div>`;
}

function renderCodeBlock(block: CodeBlock, theme: string): string {
  const lines = block.code.split('\n');
  const lineNumbers = block.lineNumbers 
    ? lines.map((_, i) => `<span class="line-num">${i + 1}</span>`).join('')
    : '';
  
  return `
    <div class="rich-code ${theme}" data-block-id="${block.id}">
      <div class="code-header">
        <span class="code-lang">${block.language}</span>
        ${block.filename ? `<span class="code-filename">${escapeHtml(block.filename)}</span>` : ''}
        <button class="copy-btn" data-code="${escapeHtml(block.code)}">Copy</button>
      </div>
      <pre class="code-body"><code>${escapeHtml(block.code)}</code></pre>
    </div>
  `;
}

function renderDiffBlock(block: DiffBlock, theme: string): string {
  return `
    <div class="rich-diff ${theme}" data-block-id="${block.id}">
      <div class="diff-header">
        <span class="diff-filename">${escapeHtml(block.filename)}</span>
        <span class="diff-stats">
          <span class="additions">+${block.additions}</span>
          <span class="deletions">-${block.deletions}</span>
        </span>
      </div>
      <div class="diff-body">
        <div class="diff-old"><pre>${escapeHtml(block.oldCode)}</pre></div>
        <div class="diff-new"><pre>${escapeHtml(block.newCode)}</pre></div>
      </div>
    </div>
  `;
}

function renderListBlock(block: ListBlock, theme: string): string {
  const tag = block.ordered ? 'ol' : 'ul';
  const items = block.items.map(item => {
    const checkbox = item.checked !== undefined 
      ? `<input type="checkbox" ${item.checked ? 'checked' : ''} />`
      : '';
    return `<li>${checkbox} ${escapeHtml(item.text)}</li>`;
  }).join('');
  
  return `<${tag} class="rich-list ${theme}" data-block-id="${block.id}">${items}</${tag}>`;
}

function renderTableBlock(block: TableBlock, theme: string): string {
  const headers = block.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = block.rows.map(row => 
    `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
  ).join('');
  
  return `
    <table class="rich-table ${theme}" data-block-id="${block.id}">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderStatusBlock(block: StatusBlock, theme: string): string {
  const icons = {
    success: '✓',
    warning: '⚠',
    error: '✗',
    info: 'ℹ',
    loading: '⟳'
  };
  
  return `
    <div class="rich-status ${block.status} ${theme}" data-block-id="${block.id}">
      <span class="status-icon">${icons[block.status]}</span>
      <span class="status-message">${escapeHtml(block.message)}</span>
      ${block.details ? `<span class="status-details">${escapeHtml(block.details)}</span>` : ''}
    </div>
  `;
}

function renderProgressBlock(block: ProgressBlock, theme: string): string {
  return `
    <div class="rich-progress ${theme}" data-block-id="${block.id}">
      <div class="progress-label">${escapeHtml(block.label)}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${block.percentage}%"></div>
      </div>
      <div class="progress-text">${block.current}/${block.total} (${block.percentage}%)</div>
    </div>
  `;
}

function renderCalloutBlock(block: CalloutBlock, theme: string): string {
  const icons = {
    info: 'ℹ',
    warning: '⚠',
    success: '✓',
    error: '✗',
    tip: '💡'
  };
  
  return `
    <div class="rich-callout ${block.variant} ${theme}" data-block-id="${block.id}">
      <div class="callout-header">
        <span class="callout-icon">${icons[block.variant]}</span>
        <span class="callout-title">${escapeHtml(block.title)}</span>
      </div>
      <div class="callout-content">${escapeHtml(block.content)}</div>
    </div>
  `;
}

function renderCollapseBlock(block: CollapseBlock, theme: string, options: RenderOptions): string {
  const content = block.content.map(b => renderBlockToHTML(b, options)).join('');
  
  return `
    <div class="rich-collapse ${theme}" data-block-id="${block.id}">
      <button class="collapse-toggle" data-collapsed="${block.defaultCollapsed}">
        <span class="toggle-icon">${block.defaultCollapsed ? '▶' : '▼'}</span>
        <span class="collapse-title">${escapeHtml(block.title)}</span>
      </button>
      <div class="collapse-content" style="display: ${block.defaultCollapsed ? 'none' : 'block'}">
        ${content}
      </div>
    </div>
  `;
}

function renderTabsBlock(block: TabsBlock, theme: string, options: RenderOptions): string {
  const tabs = block.tabs.map((tab, index) => {
    const content = tab.content.map(b => renderBlockToHTML(b, options)).join('');
    const isActive = index === block.activeTab;
    
    return `
      <div class="tab-panel ${isActive ? 'active' : ''}" data-tab-index="${index}">
        ${content}
      </div>
    `;
  }).join('');
  
  const tabButtons = block.tabs.map((tab, index) => {
    const isActive = index === block.activeTab;
    return `<button class="tab-btn ${isActive ? 'active' : ''}" data-tab-index="${index}">${escapeHtml(tab.label)}</button>`;
  }).join('');
  
  return `
    <div class="rich-tabs ${theme}" data-block-id="${block.id}">
      <div class="tabs-header">${tabButtons}</div>
      <div class="tabs-body">${tabs}</div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============ RichMessage 构建器 ============

/**
 * RichMessage 构建器
 */
export class RichMessageBuilder {
  private message: Partial<RichMessage> = {
    blocks: []
  };
  
  constructor(authorId: string, authorName: string) {
    this.message.id = generateId();
    this.message.timestamp = new Date().toISOString();
    this.message.author = { id: authorId, name: authorName };
  }
  
  /**
   * 添加文本块
   */
  addText(content: string, options?: Partial<TextBlock>): this {
    this.message.blocks!.push(createTextBlock(content, options));
    return this;
  }
  
  /**
   * 添加代码块
   */
  addCode(code: string, language: string, options?: Partial<CodeBlock>): this {
    this.message.blocks!.push(createCodeBlock(code, language, options));
    return this;
  }
  
  /**
   * 添加差异块
   */
  addDiff(oldCode: string, newCode: string, filename: string, options?: Partial<DiffBlock>): this {
    this.message.blocks!.push(createDiffBlock(oldCode, newCode, filename, options));
    return this;
  }
  
  /**
   * 添加列表块
   */
  addList(items: Array<{ text: string; checked?: boolean }>, ordered: boolean = false): this {
    this.message.blocks!.push(createListBlock(items, ordered));
    return this;
  }
  
  /**
   * 添加表格块
   */
  addTable(headers: string[], rows: string[][]): this {
    this.message.blocks!.push(createTableBlock(headers, rows));
    return this;
  }
  
  /**
   * 添加状态块
   */
  addStatus(status: StatusBlock['status'], message: string, details?: string): this {
    this.message.blocks!.push(createStatusBlock(status, message, { details }));
    return this;
  }
  
  /**
   * 添加进度块
   */
  addProgress(current: number, total: number, label: string): this {
    this.message.blocks!.push(createProgressBlock(current, total, label));
    return this;
  }
  
  /**
   * 添加提示框块
   */
  addCallout(variant: CalloutBlock['variant'], title: string, content: string): this {
    this.message.blocks!.push(createCalloutBlock(variant, title, content));
    return this;
  }
  
  /**
   * 添加折叠块
   */
  addCollapse(title: string, blocks: RichBlock[], defaultCollapsed?: boolean): this {
    this.message.blocks!.push(createCollapseBlock(title, blocks, { defaultCollapsed }));
    return this;
  }
  
  /**
   * 添加标签页块
   */
  addTabs(tabs: Array<{ label: string; content: RichBlock[] }>, activeTab?: number): this {
    this.message.blocks!.push(createTabsBlock(tabs, { activeTab }));
    return this;
  }
  
  /**
   * 设置元数据
   */
  setMetadata(metadata: RichMessage['metadata']): this {
    this.message.metadata = metadata;
    return this;
  }
  
  /**
   * 构建消息
   */
  build(): RichMessage {
    // 生成纯文本回退
    const plainText = this.message.blocks!
      .map(b => blockToPlainText(b))
      .join('\n\n');
    
    this.message.plainTextFallback = plainText;
    
    return this.message as RichMessage;
  }
}

/**
 * Block 转纯文本
 */
function blockToPlainText(block: RichBlock): string {
  switch (block.type) {
    case 'text':
      return (block as TextBlock).content;
    case 'code':
      return `[${(block as CodeBlock).language}]\n${(block as CodeBlock).code}`;
    case 'diff':
      const db = block as DiffBlock;
      return `[Diff: ${db.filename}]\n+${db.additions}/-${db.deletions}`;
    case 'list':
      const lb = block as ListBlock;
      return lb.items.map((item, i) => `${lb.ordered ? i + 1 + '.' : '-'} ${item.text}`).join('\n');
    case 'status':
      const sb = block as StatusBlock;
      return `[${sb.status.toUpperCase()}] ${sb.message}`;
    case 'progress':
      const pb = block as ProgressBlock;
      return `${pb.label}: ${pb.current}/${pb.total} (${pb.percentage}%)`;
    case 'callout':
      const cb = block as CalloutBlock;
      return `[${cb.title}] ${cb.content}`;
    default:
      return `[${block.type}]`;
  }
}

// ============ 工具函数 ============

/**
 * 从 Markdown 解析 Rich Blocks
 */
export function parseMarkdownToBlocks(markdown: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // 代码块
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(createCodeBlock(codeLines.join('\n'), lang || 'text'));
      i++;
      continue;
    }
    
    // 标题
    if (line.startsWith('#')) {
      blocks.push(createTextBlock(line, { format: 'markdown' }));
      i++;
      continue;
    }
    
    // 列表
    if (line.match(/^[-*]\s/)) {
      const items: Array<{ text: string }> = [];
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push({ text: lines[i].replace(/^[-*]\s/, '') });
        i++;
      }
      blocks.push(createListBlock(items, false));
      continue;
    }
    
    // 普通文本
    if (line.trim()) {
      const textLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !lines[i].match(/^[-*#]/)) {
        textLines.push(lines[i]);
        i++;
      }
      blocks.push(createTextBlock(textLines.join('\n'), { format: 'markdown' }));
      continue;
    }
    
    i++;
  }
  
  return blocks;
}

/**
 * 验证 Block
 */
export function validateBlock(block: RichBlock): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!block.id) {
    errors.push('Block 缺少 ID');
  }
  
  if (!block.type) {
    errors.push('Block 缺少类型');
  }
  
  // 类型特定验证
  switch (block.type) {
    case 'code':
      const cb = block as CodeBlock;
      if (!cb.language) errors.push('代码块缺少语言');
      if (!cb.code) errors.push('代码块缺少代码');
      break;
    case 'status':
      const sb = block as StatusBlock;
      if (!sb.status) errors.push('状态块缺少状态');
      if (!sb.message) errors.push('状态块缺少消息');
      break;
    case 'progress':
      const pb = block as ProgressBlock;
      if (pb.current === undefined) errors.push('进度块缺少当前值');
      if (pb.total === undefined) errors.push('进度块缺少总值');
      break;
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * 序列化 RichMessage
 */
export function serializeRichMessage(message: RichMessage): string {
  return JSON.stringify(message, null, 2);
}

/**
 * 反序列化 RichMessage
 */
export function deserializeRichMessage(json: string): RichMessage {
  return JSON.parse(json) as RichMessage;
}
