/**
 * 简单测试脚本
 * 验证核心模块可以正常加载和初始化
 */

const { ThreadStore } = require('./dist/store/ThreadStore');
const { CallbackServer } = require('./dist/server/CallbackServer');
const { Router } = require('./dist/router/Router');
const { PromptBuilder } = require('./dist/prompt/PromptBuilder');
const { OpenCodeAgentRunner } = require('./dist/runner/OpenCodeAgentRunner');
const { getAgentConfig, getAllAgentConfigs, resolveAgentAlias } = require('./dist/config/agents');

console.log('=== 测试核心模块加载 ===\n');

// 测试 Agent 配置
console.log('1. Agent 配置测试');
const agents = getAllAgentConfigs();
console.log(`   - 加载了 ${agents.length} 个 Agent 配置`);
for (const agent of agents) {
  console.log(`   - ${agent.name} (${agent.id}): ${agent.model}`);
}

// 测试 Alias 解析
console.log('\n2. Agent Alias 解析测试');
const testAliases = ['developer', 'dev', '开发猫', 'reviewer', '审查', 'creative', '创意'];
for (const alias of testAliases) {
  const resolved = resolveAgentAlias(alias);
  console.log(`   - "${alias}" -> ${resolved || 'null'}`);
}

// 测试 ThreadStore
console.log('\n3. ThreadStore 测试');
const threadStore = new ThreadStore();
console.log('   - ThreadStore 实例化成功');

// 测试 Router
console.log('\n4. Router 测试');
const router = new Router();
const testInputs = [
  '@developer 实现一个功能',
  '@reviewer 请检查代码',
  '这是一个普通的请求',
  '@dev 快速修复bug'
];
for (const input of testInputs) {
  const parsed = router.routeUserInput(input);
  console.log(`   - "${input}" -> agent: ${parsed.agent}`);
}

// 测试 PromptBuilder
console.log('\n5. PromptBuilder 测试');
const promptBuilder = new PromptBuilder();
const devConfig = getAgentConfig('developer');
const prompt = promptBuilder.build(devConfig, '测试任务：写一首关于猫的诗');
console.log(`   - 生成的 Prompt 长度: ${prompt.length} 字符`);
console.log(`   - Prompt 包含系统提示: ${prompt.includes('开发猫')}`);
console.log(`   - Prompt 包含元规则: ${prompt.includes('交接五件套')}`);

// 测试 CallbackServer
console.log('\n6. CallbackServer 测试');
const callbackServer = new CallbackServer({ port: 3201 }, threadStore);
const credentials = callbackServer.getCredentials();
console.log(`   - CallbackServer 实例化成功`);
console.log(`   - invocationId: ${credentials.invocationId.slice(0, 8)}...`);
console.log(`   - callbackToken: ${credentials.callbackToken.slice(0, 8)}...`);
console.log(`   - API URL: ${callbackServer.getApiUrl()}`);

// 测试 OpenCodeAgentRunner
console.log('\n7. OpenCodeAgentRunner 测试');
const runner = new OpenCodeAgentRunner();
console.log('   - OpenCodeAgentRunner 实例化成功');
console.log(`   - 是否已中止: ${runner.isAborted()}`);

console.log('\n=== 所有测试通过 ===\n');