# GitHub 推送指南

## 步骤 1：安装 Git

如果您的系统还没有安装 Git，请先下载并安装：
- 下载地址：https://git-scm.com/download/win
- 安装时选择"Use Git from the Windows Command Prompt"

## 步骤 2：配置 Git

打开命令行（CMD 或 PowerShell），配置您的 Git 用户信息：

```bash
git config --global user.name "您的GitHub用户名"
git config --global user.email "您的GitHub邮箱"
```

## 步骤 3：在 GitHub 上创建仓库

1. 访问 https://github.com 并登录
2. 点击右上角的 "+" 按钮，选择 "New repository"
3. 填写仓库名称：`excel-batch-generator-v2`
4. 选择 "Private"（私有）或 "Public"（公开）
5. 点击 "Create repository"

## 步骤 4：推送代码

在项目目录中执行以下命令：

```bash
# 进入项目目录
cd "e:\trae solo\Excel批量生成工具v2"

# 初始化 Git 仓库（如果还没有初始化）
git init

# 添加所有文件到暂存区
git add .

# 提交更改
git commit -m "v2.0.0 - Excel批量生成工具v2发布

主要更新：
✨ 全新的前端界面设计，修复乱码问题
✨ 优化图片字段自动识别逻辑
✨ 支持表头名称自动识别图片字段
✨ 改进文件命名规则，支持使用字段值
✨ 添加详细的图片插入日志
✨ 优化ZIP文件夹结构支持"

# 添加远程仓库地址（将 <YOUR_GITHUB_USERNAME> 替换为您的GitHub用户名）
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/excel-batch-generator-v2.git

# 推送到 GitHub
git push -u origin master
```

## 步骤 5：验证推送

1. 刷新 GitHub 仓库页面
2. 确认所有文件已成功上传
3. 检查提交记录显示正常

## 常见问题

### Q1: 推送时要求输入用户名和密码？
**解决方案**：建议使用 Personal Access Token 代替密码
1. 在 GitHub Settings → Developer settings → Personal access tokens 生成新token
2. 将密码替换为生成的 token

### Q2: 如何更新代码？
```bash
git add .
git commit -m "您的更新说明"
git push
```

### Q3: 如何查看当前状态？
```bash
git status
git log
```

---

## 版本信息

**当前版本**: v2.0.0  
**更新日期**: 2026-05-12  
**项目路径**: e:\trae solo\Excel批量生成工具v2
