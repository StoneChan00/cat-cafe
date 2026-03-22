const { invoke } = require('./invoke');

invoke('glm', process.argv[2] || '你好').catch((error) => {
  console.error(`执行错误: ${error.message}`);
  process.exit(1);
});
