@echo off
chcp 65001 >nul
title Excel批量生成工具
echo.
echo ========================================
echo    Excel批量生成工具 V1.1
echo ========================================
echo.

REM 检查Node.js
node -v >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js
    echo.
    echo 请先安装 Node.js：
    echo 1. 访问 https://nodejs.org/
    echo 2. 下载并安装 LTS 版本
    echo.
    pause
    exit /b
)

echo [OK] 检测到 Node.js
for /f "tokens=*" %%i in ('node -v') do echo      版本: %%i
echo.

REM 检查依赖
if not exist "node_modules" (
    echo [首次运行] 正在安装依赖...
    call npm install
    echo.
)

REM 启动服务器
echo [启动中] 正在启动服务器...
echo.
echo ========================================
echo    服务器启动成功！
echo.
echo    请在浏览器访问：
echo    http://localhost:3000
echo.
echo    按 Ctrl+C 可以停止服务器
echo ========================================
echo.
npm start
pause
