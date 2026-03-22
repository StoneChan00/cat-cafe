/**
 * 集成测试
 * 测试模块间的协作
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 测试数据目录
const TEST_DATA_DIR = path.join(__dirname, '..', '.test-data');

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
  console.log('\n=== 集成测试 ===\n');
  
  setupTestEnv();
  
  const { ThreadStore } = require('../dist/store/ThreadStore');
  const { Router } = require('../dist/router/Router');
  const { PromptBuilder } = require('../dist/prompt/PromptBuilder');
  const { getAgentConfig, resolveAgentAlias } = require('../dist/config/agents');
  const { parseUserInput, extractA2ATriggers, WorklistEngine } = require('../dist/router/Router');
  
  // 测试 1: ThreadStore 创建和消息持久化
  console.log('1. ThreadStore 持久化测试');
  await test('创建 Thread', async () => {
    const store = new ThreadStore();
    const thread = await store.create();
    assert(thread.threadId, 'Thread should have an ID');
    assert(thread.status === 'idle', 'Initial status should be idle');
  });
  
  await test('添加消息到 Thread', async () => {
    const store = new ThreadStore();
    const thread = await store.create();
    await store.addMessage(thread.threadId, {
      role: 'user',
      content: 'Hello',
      isPublic: true
    });
    
    const loaded = await store.get(thread.threadId);
    assert(loaded?.messages.length === 1, 'Should have 1 message');
    assert(loaded?.messages[0].content === 'Hello', 'Message content should match');
  });
  
  // 测试 2: Router 功能
  console.log('\n2. Router 功能测试');
  await test('解析 @developer 输入', () => {
    const parsed = parseUserInput('@developer 实现一个功能');
    assert(parsed.targetAgent === 'developer', 'Should resolve to developer');
    assert(parsed.hasExplicitAgent === true, 'Should have explicit agent');
    assert(parsed.content.includes('实现一个功能'), 'Should extract content');
  });
  
  await test('解析无 @agent 输入', () => {
    const parsed = parseUserInput('这是一个普通请求');
    assert(parsed.targetAgent === undefined, 'Should not have target agent');
    assert(parsed.hasExplicitAgent === false, 'Should not have explicit agent');
  });
  
  await test('解析中文别名', () => {
    const parsed = parseUserInput('@开发猫 写代码');
    assert(parsed.targetAgent === 'developer', 'Should resolve 开发猫 to developer');
  });
  
  // 测试 3: A2A 触发提取
  console.log('\n3. A2A 触发测试');
  await test('提取 @reviewer 触发', () => {
    const triggers = extractA2ATriggers('任务完成，@reviewer 请检查', 'developer');
    assert(triggers.length === 1, 'Should have 1 trigger');
    assert(triggers[0].targetAgent === 'reviewer', 'Should trigger reviewer');
    assert(triggers[0].triggeredBy === 'developer', 'Should be triggered by developer');
  });
  
  await test('不提取自己', () => {
    const triggers = extractA2ATriggers('我完成了 @developer 继续做', 'developer');
    // 不应该触发自己
    const selfTriggers = triggers.filter(t => t.targetAgent === 'developer');
    assert(selfTriggers.length === 0, 'Should not trigger self');
  });
  
  // 测试 4: Worklist Engine
  console.log('\n4. Worklist Engine 测试');
  await test('创建初始 Worklist', () => {
    const engine = new WorklistEngine();
    const worklist = engine.createInitialWorklist('developer', 'Test task');
    assert(worklist.length === 1, 'Should have 1 item');
    assert(worklist[0].agentId === 'developer', 'Should be developer');
  });
  
  await test('深度限制', () => {
    const engine = new WorklistEngine(2);
    const thread = {
      threadId: 'test',
      messages: [],
      worklist: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 添加第一个
    engine.addWorkItem(thread, {
      targetAgent: 'reviewer',
      reason: 'Test 1',
      triggeredBy: 'developer'
    });
    
    // 添加第二个
    engine.addWorkItem(thread, {
      targetAgent: 'creative',
      reason: 'Test 2',
      triggeredBy: 'reviewer'
    });
    
    // 应该被拒绝（超过深度）
    const result = engine.addWorkItem(thread, {
      targetAgent: 'developer',
      reason: 'Test 3',
      triggeredBy: 'creative'
    });
    
    assert(result === false, 'Should reject due to max depth');
  });
  
  // 测试 5: Prompt Builder
  console.log('\n5. Prompt Builder 测试');
  await test('生成完整 Prompt', () => {
    const builder = new PromptBuilder();
    const devConfig = getAgentConfig('developer');
    const prompt = builder.build(devConfig, 'Test task');
    
    assert(prompt.includes('开发猫'), 'Should include agent name');
    assert(prompt.includes('Test task'), 'Should include task');
    assert(prompt.includes('交接五件套'), 'Should include meta rules');
    assert(prompt.includes('cat_cafe_get_context'), 'Should mention tools');
  });
  
  await test('包含 Thread 上下文', () => {
    const builder = new PromptBuilder();
    const devConfig = getAgentConfig('developer');
    const threadContext = {
      threadId: 'test',
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: '', isPublic: true }
      ],
      worklist: [],
      status: 'idle',
      createdAt: '',
      updatedAt: ''
    };
    
    const prompt = builder.build(devConfig, 'Test', threadContext);
    assert(prompt.includes('Hello'), 'Should include thread messages');
  });
  
  // 输出结果
  console.log('\n=== 测试结果 ===');
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
  
  console.log('\n所有测试通过!\n');
}

runTests().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});