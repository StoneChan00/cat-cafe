/**
 * Phase 2 集成测试
 * 测试工程化护栏与上下文治理功能
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 测试数据目录
const TEST_DATA_DIR = path.join(__dirname, '..', '.test-data-phase2');

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
  console.log('\n=== Phase 2 集成测试 ===\n');
  
  setupTestEnv();
  
  // 需要先构建项目
  const { InvocationStore } = require('../dist/store/InvocationStore');
  const { TranscriptManager } = require('../dist/utils/TranscriptManager');
  const { KnowledgeIndex } = require('../dist/knowledge/KnowledgeIndex');
  const { SecurityGuard } = require('../dist/middleware/SecurityGuard');
  const { Router, validateThreadIsolation, createThreadSafeOperations, ThreadIsolationError } = require('../dist/router/Router');
  const { PromptBuilder } = require('../dist/prompt/PromptBuilder');
  const { getAgentConfig } = require('../dist/config/agents');
  
  // ============ 测试 1: InvocationStore ============
  console.log('1. InvocationStore 持久化测试');
  
  await test('创建 Invocation 记录', async () => {
    const store = new InvocationStore();
    const invocation = store.create('thread-1', 'developer', 'codex_service/gpt-5.3', '实现一个功能', {
      workingDirectory: '/test',
      depth: 0
    });
    assert(invocation.invocationId, '应该有 invocationId');
    assert(invocation.threadId === 'thread-1', 'Thread ID 应该匹配');
    assert(invocation.status === 'pending', '初始状态应该是 pending');
    assert(invocation.events.length === 0, '初始事件列表应该为空');
  });
  
  await test('添加事件到 Invocation', async () => {
    const store = new InvocationStore();
    const invocation = store.create('thread-1', 'developer', 'codex_service/gpt-5.3', '测试任务');
    
    await store.addEvent(invocation.invocationId, {
      type: 'text',
      part: { text: 'Hello' }
    });
    
    const loaded = await store.get(invocation.invocationId);
    assert(loaded.events.length === 1, '应该有 1 个事件');
    assert(loaded.events[0].type === 'text', '事件类型应该匹配');
  });
  
  await test('更新 Invocation 状态', async () => {
    const store = new InvocationStore();
    const invocation = store.create('thread-1', 'developer', 'codex_service/gpt-5.3', '测试任务');
    
    await store.updateStatus(invocation.invocationId, 'completed', {
      finalText: '完成',
      metrics: { durationMs: 1000, eventCount: 5, textLength: 100 }
    });
    
    const loaded = await store.get(invocation.invocationId);
    assert(loaded.status === 'completed', '状态应该更新');
    assert(loaded.finalText === '完成', '结果文本应该匹配');
    assert(loaded.metrics && loaded.metrics.durationMs === 1000, '性能指标应该记录');
  });
  
  await test('查询 Invocations', async () => {
    const store = new InvocationStore();
    
    // 创建多个 invocation
    const inv1 = store.create('thread-1', 'developer', 'codex_service/gpt-5.3', '任务1');
    const inv2 = store.create('thread-1', 'reviewer', 'bailian-coding-plan/glm-5', '任务2');
    const inv3 = store.create('thread-2', 'developer', 'codex_service/gpt-5.3', '任务3');
    
    // 等待保存完成
    await store.save(inv1);
    await store.save(inv2);
    await store.save(inv3);
    
    const thread1Invocations = await store.query({ threadId: 'thread-1' });
    // 注意：这里可能有之前测试创建的 thread-1 数据，所以至少要有 2 个
    assert(thread1Invocations.length >= 2, 'Thread 1 应该至少有 2 个 invocation');
    
    const devInvocations = await store.query({ agentId: 'developer' });
    assert(devInvocations.length === 2, '应该有 2 个 developer 的 invocation');
  });
  
  // ============ 测试 2: TranscriptManager ============
  console.log('\n2. TranscriptManager 归档测试');
  
  await test('归档 Invocation', async () => {
    const store = new InvocationStore();
    const transcriptManager = new TranscriptManager();
    
    const invocation = store.create('thread-transcript', 'developer', 'codex_service/gpt-5.3', '归档测试');
    await store.updateStatus(invocation.invocationId, 'completed');
    
    const loaded = await store.get(invocation.invocationId);
    assert(loaded, '应该能加载 invocation');
    const entry = await transcriptManager.archive(loaded);
    
    assert(entry.invocationId === invocation.invocationId, '归档 ID 应该匹配');
    assert(entry.threadId === 'thread-transcript', 'Thread ID 应该匹配');
    assert(entry.status === 'completed', '状态应该匹配');
  });
  
  await test('读取 Transcript', async () => {
    const transcriptManager = new TranscriptManager();
    const entries = await transcriptManager.read('thread-transcript');
    assert(entries.length > 0, '应该有归档记录');
    assert(entries[0].agentId === 'developer', 'Agent ID 应该匹配');
  });
  
  await test('搜索 Transcripts', async () => {
    const transcriptManager = new TranscriptManager();
    const results = await transcriptManager.search({ agentId: 'developer' });
    assert(results.length > 0, '应该搜索到结果');
  });
  
  await test('获取 Session 摘要', async () => {
    const transcriptManager = new TranscriptManager();
    const summary = await transcriptManager.getSessionSummary('thread-transcript');
    assert(summary !== null, '应该能获取 Session 摘要');
    assert(summary?.threadId === 'thread-transcript', 'Thread ID 应该匹配');
    assert(summary?.invocationCount > 0, '应该有 invocation 计数');
  });
  
  // ============ 测试 3: KnowledgeIndex ============
  console.log('\n3. KnowledgeIndex 知识索引测试');
  
  await test('创建知识条目', async () => {
    const knowledgeIndex = new KnowledgeIndex();
    const entry = await knowledgeIndex.create(
      'design',
      'Phase 2 架构设计',
      '# Phase 2 架构设计\n\n这是 Phase 2 的架构设计文档...',
      { tags: ['architecture', 'phase2'], priority: 'high' }
    );
    
    assert(entry.frontmatter.id, '应该有 ID');
    assert(entry.frontmatter.type === 'design', '类型应该匹配');
    assert(entry.frontmatter.title === 'Phase 2 架构设计', '标题应该匹配');
    assert(entry.frontmatter.tags?.includes('phase2'), '标签应该包含 phase2');
    assert(entry.summary?.includes('Phase 2'), '摘要应该生成');
  });
  
  await test('搜索知识条目', async () => {
    const knowledgeIndex = new KnowledgeIndex();
    
    // 先创建条目
    await knowledgeIndex.create(
      'backlog',
      '实现 InvocationStore',
      '需要实现 Invocation 持久化存储功能',
      { status: 'done', priority: 'high' }
    );
    
    const entries = await knowledgeIndex.search({ type: 'backlog', priority: 'high' });
    assert(entries.length > 0, '应该搜索到结果');
    assert(entries[0].frontmatter.priority === 'high', '优先级应该匹配');
  });
  
  await test('创建 Feature 文档', async () => {
    const knowledgeIndex = new KnowledgeIndex();
    const feature = await knowledgeIndex.createFeature(
      'Phase 2 工程化',
      'Phase 2 的工程化护栏功能',
      { designDocs: ['design-doc-1'] }
    );
    
    assert(feature.id, '应该有 ID');
    assert(feature.name === 'Phase 2 工程化', '名称应该匹配');
    assert(feature.status === 'draft', '初始状态应该是 draft');
    
    // 测试添加 backlog
    const backlog = await knowledgeIndex.addBacklog(
      '实现 TranscriptManager',
      '实现归档管理功能',
      { priority: 'high', featureId: feature.id }
    );
    
    assert(backlog.featureId === feature.id, '应该关联到 feature');
    
    // 更新状态
    const updated = await knowledgeIndex.updateBacklog(backlog.id, 'done');
    assert(updated?.status === 'done', '状态应该更新');
  });
  
  // ============ 测试 4: SecurityGuard ============
  console.log('\n4. SecurityGuard 安全护栏测试');
  
  await test('检查文件删除风险', () => {
    const guard = new SecurityGuard();
    const result = guard.checkFile('delete', '.env');
    assert(result.riskLevel === 'critical', '删除 .env 应该是 critical 风险');
    assert(result.requiresConfirmation === true, '应该需要确认');
    
    const result2 = guard.checkFile('delete', 'src/utils/helper.ts');
    // 根据规则，删除普通源码文件是 low 风险
    assert(result2.riskLevel === 'low' || result2.riskLevel === 'safe', '删除普通文件应该是 low 或 safe 风险');
  });
  
  await test('检查命令风险', () => {
    const guard = new SecurityGuard();
    const result = guard.checkCommand('rm -rf /');
    assert(result.riskLevel === 'critical', 'rm -rf 应该是 critical 风险');
    
    const result2 = guard.checkCommand('git push --force');
    assert(result2.riskLevel === 'high', 'git force 应该是 high 风险');
  });
  
  await test('检查网络请求风险', () => {
    const guard = new SecurityGuard();
    const result = guard.check('network_request', 'https://api.example.com/data');
    assert(result.riskLevel === 'low', '普通网络请求应该是 low 风险');
    assert(result.allowed === true, '应该允许');
  });
  
  await test('获取安全统计', () => {
    const guard = new SecurityGuard();
    const stats = guard.getStats();
    assert(typeof stats.totalOperations === 'number', '应该有总操作数');
    assert(typeof stats.highRiskToday === 'number', '应该有今日高风险计数');
  });
  
  // ============ 测试 5: Thread 隔离验证 ============
  console.log('\n5. Thread 隔离验证测试');
  
  await test('验证 Thread 隔离成功', () => {
    // 相同的 Thread ID 应该通过验证
    validateThreadIsolation('thread-1', 'thread-1');
    // 无期望值时应该通过
    validateThreadIsolation('thread-1', undefined);
  });
  
  await test('验证 Thread 隔离失败', () => {
    try {
      validateThreadIsolation('thread-1', 'thread-2');
      assert(false, '应该抛出异常');
    } catch (error) {
      assert(error instanceof ThreadIsolationError, '应该是 ThreadIsolationError');
      assert(error.expectedThreadId === 'thread-2', '期望的 Thread ID 应该匹配');
      assert(error.actualThreadId === 'thread-1', '实际的 Thread ID 应该匹配');
    }
  });
  
  await test('创建 Thread 安全操作', () => {
    const safeOps = createThreadSafeOperations('thread-1');
    assert(safeOps.getThreadId() === 'thread-1', 'Thread ID 应该匹配');
    
    const mockThread = {
      threadId: 'thread-1',
      messages: [],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    assert(safeOps.verify(mockThread) === true, '验证应该通过');
    
    // 测试错误 Thread
    const wrongThread = { ...mockThread, threadId: 'thread-2' };
    assert(safeOps.verify(wrongThread) === false, '验证应该失败');
  });
  
  await test('Router Thread 隔离验证', () => {
    const router = new Router();
    const mockThread = {
      threadId: 'thread-1',
      messages: [],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const verified = router.verifyThreadContext(mockThread, 'thread-1');
    assert(verified === true, '验证应该通过');
    
    const notVerified = router.verifyThreadContext(mockThread, 'thread-2');
    assert(notVerified === false, '验证应该失败');
  });
  
  // ============ 测试 6: PromptBuilder Review 增强 ============
  console.log('\n6. PromptBuilder Review 增强测试');
  
  await test('生成原始目标摘要', () => {
    const builder = new PromptBuilder();
    const mockThread = {
      threadId: 'test-thread',
      messages: [
        { id: '1', role: 'user', content: '实现一个用户登录功能，要求支持 JWT 验证', timestamp: new Date().toISOString(), isPublic: true },
        { id: '2', role: 'agent', agentId: 'developer', content: '好的，我来实现', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const summary = builder.getOriginalGoalSummary(mockThread);
    assert(summary.includes('实现一个用户登录功能'), '摘要应该包含原始目标');
    assert(summary.includes('JWT'), '摘要应该包含关键信息');
  });
  
  await test('Reviewer Prompt 包含增强规则', () => {
    const builder = new PromptBuilder();
    const reviewerConfig = getAgentConfig('reviewer');
    
    const mockThread = {
      threadId: 'test-thread',
      messages: [
        { id: '1', role: 'user', content: '实现登录功能', timestamp: new Date().toISOString(), isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const prompt = builder.build(reviewerConfig, '请审查这段代码', mockThread);
    assert(prompt.includes('审查猫增强规则'), '应该包含增强规则');
    assert(prompt.includes('原始目标回顾'), '应该包含原始目标回顾');
    assert(prompt.includes('审查分级标准'), '应该包含分级标准');
    assert(prompt.includes('强制检查项'), '应该包含强制检查项');
  });
  
  // 输出结果
  console.log('\n=== Phase 2 测试结果 ===');
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
  
  console.log('\nPhase 2 所有测试通过!\n');
}

runTests().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
