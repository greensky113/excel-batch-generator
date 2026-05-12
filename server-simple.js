const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8080;

// 静态文件服务
app.use(express.static(__dirname));

// 基础路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Excel批量生成工具运行中',
    port: PORT 
  });
});

const server = app.listen(PORT, () => {
  console.log('\n✅ Excel批量生成工具v2已启动！');
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`\n按 Ctrl+C 停止服务器\n`);
});

console.log('等待连接...');
