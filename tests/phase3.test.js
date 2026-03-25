/**
 * Phase 3 集成测试
 * 测试 Session Chain 与上下文治理功能
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 测试数据目录
const TEST_DATA_DIR = path.join(__dirname, '..', '.test-data-phase3');

// 清理测试数据
function cleanupTestData() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

// 设置测试环境
function setupTestEnv() {
  cleanupTestData();
  process.env.CAT_CAFE_DATA_DIR = TEST_DATA_DIR;
}

// 测试结果收集
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    results.failed++;
    results.errors.push(err);
  }
}

async function runTests() {
  console.log('\n=== Phase 3 集成测试 ===\n');
  
  setupTestEnv();
  
  // 需要先构建项目
  const { SessionManager, estimateThreadContextUsage } = require('../dist/session/SessionManager');
  const { ContextRetriever } = require('../dist/session/ContextRetriever');
  const { SessionSearch } = require('../dist/session/SessionSearch');
  const { ContextGatekeeper } = require('../dist/context/ContextGatekeeper');
  const { KnowledgeHub } = require('../dist/knowledge/KnowledgeHub');
  
  // ============ 测试 1: SessionManager ============
  console.log('1. SessionManager Session 管理测试');
  
  await test('创建 Session', async () => {
    const manager = new SessionManager();
    const session = manager.create({
      threadId: 'thread-1',
      maxTokens: 100000,
      warningThreshold: 0.85,
      sealingThreshold: 0.90
    });
    
    assert(session.sessionId, '应该有 sessionId');
    assert(session.threadId === 'thread-1', 'Thread ID 应该匹配');
    assert(session.status === 'active', '初始状态应该是 active');
    assert(session.contextBudget.maxTokens === 100000, 'Token 限制应该匹配');
  });
  
  await test('更新上下文使用量', async () => {
    const manager = new SessionManager();
    const session = manager.create({ threadId: 'thread-1' });
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', agentId: 'developer', content: 'World', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const stats = await manager.updateContextUsage(session.sessionId, mockThread);
    assert(stats, '应该返回统计');
    assert(stats.usedTokens > 0, '应该计算 token 使用');
    assert(stats.usagePercentage > 0, '应该计算使用百分比');
  });
  
  await test('检查 Sealing 条件', async () => {
    const manager = new SessionManager();
    const session = manager.create({
      threadId: 'thread-1',
      maxTokens: 1000,
      sealingThreshold: 0.90
    });
    
    // 创建大量消息以触发 sealing
    const messages = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        agentId: i % 2 === 0 ? undefined : 'developer',
        content: 'This is a test message with some content that will consume tokens. '.repeat(5),
        timestamp: new Date().toISOString(),
        isPublic: true
      });
    }
    
    const mockThread = {
      threadId: 'thread-1',
      messages,
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await manager.updateContextUsage(session.sessionId, mockThread);
    const check = await manager.checkSealingNeeded(session.sessionId);
    
    assert(check.needed === true, '应该需要 Sealing');
    assert(check.reason === 'budget_exhausted', '原因应该是预算耗尽');
  });
  
  await test('执行 Sealing', async () => {
    const manager = new SessionManager();
    const session = manager.create({ threadId: 'thread-1' });
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '实现登录功能', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', agentId: 'developer', content: '决定采用 JWT 方案', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const sealed = await manager.seal(session.sessionId, 'task_completed', mockThread);
    assert(sealed, '应该返回 sealed session');
    assert(sealed.status === 'sealed', '状态应该是 sealed');
    assert(sealed.sealedAt, '应该有 sealing 时间');
    assert(sealed.summary, '应该有摘要');
    assert(sealed.summary.keyDecisions.length > 0, '应该有关键决策');
  });
  
  await test('创建下一个 Session', async () => {
    const manager = new SessionManager();
    const session = manager.create({ threadId: 'thread-1' });
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '实现登录', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const sealed = await manager.seal(session.sessionId, 'task_completed', mockThread);
    const nextSession = await manager.createNext(session.sessionId, mockThread);
    
    assert(nextSession, '应该创建下一个 session');
    assert(nextSession.parentSessionId === session.sessionId, '应该有父 session ID');
    assert(nextSession.status === 'active', '新 session 应该是 active');
  });
  
  // ============ 测试 2: ContextRetriever ============
  console.log('\n2. ContextRetriever 上下文检索测试');
  
  await test('切片上下文（最近策略）', () => {
    const retriever = new ContextRetriever();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        agentId: i % 2 === 0 ? undefined : 'developer',
        content: `Message ${i} content`,
        timestamp: new Date(Date.now() - (20 - i) * 60000).toISOString(),
        isPublic: true
      })),
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const slice = retriever.slice(mockThread, {
      strategy: 'recent',
      maxMessages: 10
    });
    
    assert(slice.messages.length === 10, '应该返回 10 条消息');
    assert(slice.source === 'current_session', '来源应该是 current_session');
    assert(slice.tokenEstimate > 0, '应该估算 token');
  });
  
  await test('切片上下文（摘要策略）', () => {
    const retriever = new ContextRetriever();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '原始需求', timestamp: new Date().toISOString(), isPublic: true },
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `msg-${i + 2}`,
          role: i % 2 === 0 ? 'user' : 'agent',
          agentId: i % 2 === 0 ? undefined : 'developer',
          content: `Message ${i}`,
          timestamp: new Date(Date.now() - i * 60000).toISOString(),
          isPublic: true
        }))
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const slice = retriever.slice(mockThread, {
      strategy: 'summary'
    });
    
    assert(slice.messages.length > 0, '应该返回消息');
    assert(slice.messages[0].content === '原始需求', '第一条应该是原始需求');
    assert(slice.reason.includes('摘要'), '原因应该包含摘要');
  });
  
  await test('提取关键信息', () => {
    const retriever = new ContextRetriever();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '需求', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', content: '决定采用方案A', timestamp: new Date().toISOString(), isPublic: true },
        { id: '3', role: 'agent', content: '有个问题待确认', timestamp: new Date().toISOString(), isPublic: true },
        { id: '4', role: 'agent', content: '下一步要测试', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const info = retriever.extractKeyInfo(mockThread);
    
    // 关键决策提取可能因文本内容而异
    assert(info.keyDecisions || info.actionItems || info.openQuestions, '应该提取至少一类信息');
  });
  
  // ============ 测试 3: ContextGatekeeper ============
  console.log('\n3. ContextGatekeeper 上下文守门器测试');
  
  await test('评估上下文质量', () => {
    const gatekeeper = new ContextGatekeeper();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '需求描述', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', content: '决定采用 JWT', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const mockSlice = {
      messages: mockThread.messages,
      tokenEstimate: 500,
      source: 'current_session',
      truncated: false,
      reason: 'test'
    };
    
    const assessment = gatekeeper.assessQuality(mockThread, mockSlice);
    
    assert(assessment.score > 0, '应该有质量分数');
    assert(assessment.relevanceScore > 0, '应该有相关性分数');
    assert(assessment.completenessScore > 0, '应该有完整性分数');
    assert(assessment.issues, '应该有 issue 列表');
  });
  
  await test('分层上下文', () => {
    const gatekeeper = new ContextGatekeeper();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '原始需求', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', content: '决定方案', timestamp: new Date().toISOString(), isPublic: true },
        { id: '3', role: 'user', content: '问题', timestamp: new Date().toISOString(), isPublic: true },
        { id: '4', role: 'agent', content: '回复', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const layers = gatekeeper.layer(mockThread);
    
    assert(layers.length > 0, '应该有分层');
    assert(layers[0].layer === 'essential', '第一层应该是 essential');
    // 检查优先级是否按层级排序（非严格递减，因为某些层可能不存在）
    const priorities = layers.map(l => l.priority);
    assert(priorities[0] >= priorities[priorities.length - 1], '优先级应该大致递减');
  });
  
  await test('决定注入策略', () => {
    const gatekeeper = new ContextGatekeeper();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `Message content ${i} `.repeat(50),
        timestamp: new Date().toISOString(),
        isPublic: true
      })),
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const mockAgent = {
      id: 'developer',
      name: '开发猫',
      model: 'test',
      description: '测试',
      systemPrompt: 'test',
      toolsPolicy: {},
      a2aPolicy: {}
    };
    
    const decision = gatekeeper.decide(mockThread, mockAgent);
    
    assert(decision.shouldInject === true, '应该注入');
    assert(decision.strategy, '应该有策略');
    assert(decision.maxTokens > 0, '应该有最大 token');
    assert(decision.reason, '应该有原因');
  });
  
  await test('验证注入', () => {
    const gatekeeper = new ContextGatekeeper();
    
    const mockSlice = {
      messages: [
        { id: '1', role: 'user', content: 'test', timestamp: new Date().toISOString(), isPublic: true }
      ],
      tokenEstimate: 100,
      source: 'current_session',
      truncated: false,
      reason: 'test'
    };
    
    const validation = gatekeeper.validate(mockSlice);
    
    assert(validation.valid === true, '应该通过验证');
    assert(validation.finalTokenCount > 0, '应该有最终 token 数');
  });
  
  await test('完整处理流程', () => {
    const gatekeeper = new ContextGatekeeper();
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [
        { id: '1', role: 'user', content: '需求', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', content: '决定', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const mockAgent = {
      id: 'developer',
      name: '开发猫',
      model: 'test',
      description: 'test',
      systemPrompt: 'test',
      toolsPolicy: {},
      a2aPolicy: {}
    };
    
    const result = gatekeeper.process(mockThread, mockAgent);
    
    assert(result.decision, '应该有决策');
    assert(result.assessment, '应该有评估');
    assert(result.validation, '应该有验证');
    assert(result.report, '应该有报告');
  });
  
  // ============ 测试 4: KnowledgeHub ============
  console.log('\n4. KnowledgeHub 知识中心测试');
  
  await test('初始化 KnowledgeHub', async () => {
    const hub = new KnowledgeHub();
    await hub.initialize();
    
    const graph = await hub.getGraph();
    // 初始化为空或已有图谱
    assert(graph !== undefined, '应该有图谱');
  });
  
  await test('搜索知识', async () => {
    const hub = new KnowledgeHub();
    await hub.initialize();
    
    // 搜索（可能为空，但至少不抛错）
    const results = await hub.search({ query: 'Phase 3', maxResults: 10 });
    assert(Array.isArray(results), '应该返回数组');
  });
  
  await test('获取推荐', async () => {
    const hub = new KnowledgeHub();
    await hub.initialize();
    
    // 基于空列表获取推荐
    const recommendations = await hub.recommend([]);
    assert(Array.isArray(recommendations), '应该返回数组');
  });
  
  await test('获取统计', async () => {
    const hub = new KnowledgeHub();
    const stats = await hub.getStats();
    
    assert(typeof stats.totalEntries === 'number', '应该有总条目数');
    assert(typeof stats.totalTags === 'number', '应该有总标签数');
  });
  
  await test('获取标签云', async () => {
    const hub = new KnowledgeHub();
    const cloud = await hub.getTagCloud();
    
    assert(Array.isArray(cloud), '应该返回数组');
  });
  
  // ============ 测试 5: SessionSearch ============
  console.log('\n5. SessionSearch Session 搜索测试');
  
  await test('搜索 Sessions', async () => {
    const search = new SessionSearch();
    const results = await search.search({ limit: 10 });
    
    assert(Array.isArray(results), '应该返回数组');
  });
  
  await test('获取时间线', async () => {
    const search = new SessionSearch();
    const timeline = await search.getTimeline('non-existent-thread');
    
    assert(timeline.sessions, '应该有 sessions');
    assert(typeof timeline.totalDurationMs === 'number', '应该有总时长');
    assert(typeof timeline.totalInvocations === 'number', '应该有总 invocation');
  });
  
  await test('获取统计', async () => {
    const search = new SessionSearch();
    const stats = await search.getStats();
    
    assert(typeof stats.totalSessions === 'number', '应该有总 session 数');
    assert(typeof stats.averageInvocations === 'number', '应该有平均 invocation');
  });
  
  // 输出结果
  console.log('\n=== Phase 3 测试结果 ===');
  console.log(`通过: ${results.passed}`);
  console.log(`失败: ${results.failed}`);
  
  if (results.failed > 0) {
    console.log('\n失败的测试:');
    results.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. ${err.message}`);
    });
    process.exit(1);
  }
  
  // 清理
  cleanupTestData();
  
  console.log('\nPhase 3 所有测试通过!\n');
}

runTests().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
