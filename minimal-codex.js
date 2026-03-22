const { invoke } = require('./invoke');

invoke('codex', process.argv[2] || '你好').catch((error) => {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
});
