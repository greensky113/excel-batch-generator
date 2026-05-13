#!/bin/bash

# Excel批量生成工具 V1.1 - macOS/Linux 启动脚本
clear
echo "========================================"
echo "   Excel批量生成工具 V1.1"
echo "========================================"
echo ""

# 检查是否有 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js！"
    echo ""
    echo "请先安装 Node.js："
    echo "1. 访问 https://nodejs.org/"
    echo "2. 下载并安装 LTS 版本"
    echo "3. 重新运行此脚本"
    echo ""
    exit 1
fi

# 显示 Node.js 版本
NODE_VERSION=$(node -v)
echo "[信息] 检测到 Node.js"
echo "       版本: $NODE_VERSION"
echo ""

# 检查是否需要安装依赖
if [ ! -d "node_modules" ]; then
    echo "[首次运行] 正在安装依赖，请稍候..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[错误] 依赖安装失败！"
        exit 1
    fi
    echo ""
    echo "[完成] 依赖安装成功！"
    echo ""
fi

# 启动服务器
echo "[启动中] 正在启动服务器..."
echo ""
echo "========================================"
echo "   服务器启动成功！"
echo ""
echo "   请在浏览器访问："
echo "   http://localhost:3000"
echo ""
echo "   按 Ctrl+C 可以停止服务器"
echo "========================================"
echo ""
npm start
echo ""
echo "[结束] 服务器已停止"