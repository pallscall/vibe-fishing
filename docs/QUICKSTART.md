# 🚀 快速上手指南 (Quick Start)

本指南将帮助你从零开始搭建并运行 Vibe Fishing 开发环境。

## 📋 准备工作

在开始之前，请确保你的环境满足以下要求：

### 1. 基础环境
- **操作系统**: macOS, Linux, 或 Windows (WSL2)
- **Node.js**: v18.0.0 或更高版本 (推荐 v20 LTS)
  - 检查版本: `node -v`
- **Git**: 用于克隆代码仓库

### 2. API 密钥 (必须)
你需要至少拥有以下其中一个 AI 模型的 API Key：
- **OpenAI API Key**: 用于 GPT-4o 等模型 ([获取链接](https://platform.openai.com/api-keys))
- **Anthropic API Key**: 用于 Claude 3.5 Sonnet 等模型 ([获取链接](https://console.anthropic.com/settings/keys))

> 💡 **提示**: 为了获得最佳体验（特别是代码生成和复杂推理），推荐使用 **Claude 3.5 Sonnet** 或 **GPT-4o**。

---

## 🛠️ 安装与启动

### 方式一：使用启动脚本 (推荐 - macOS/Linux)

这是最简单的启动方式，适合本地开发。

1. **克隆仓库**
   ```bash
   git clone https://github.com/vibe-fishing/vibe-fishing-open-source.git
   cd vibe-fishing-open-source
   ```

2. **配置环境变量**
   在 `backend` 目录下创建 `.env` 文件并填入你的 API Key。
   
   ```bash
   # 进入后端目录
   cd backend
   
   # 复制示例配置
   cp .env.example .env
   
   # 编辑 .env 文件
   # 填入: OPENAI_API_KEY=sk-... 或 ANTHROPIC_API_KEY=sk-...
   ```

3. **一键启动**
   回到项目根目录，运行启动脚本：
   ```bash
   # 回到根目录
   cd ..
   
   # 运行脚本
   bash ./scripts/start-all.sh
   ```

4. **访问应用**
   打开浏览器访问: [http://localhost:3000](http://localhost:3000)

---

### 方式二：使用 Docker (推荐 - 所有平台)

如果你不想安装 Node.js 环境，可以使用 Docker。

1. **配置环境变量**
   在 `backend` 目录下创建 `.env` 文件 (同上)。

2. **启动容器**
   ```bash
   docker compose -f docker/docker-compose.yml up -d --build
   ```

3. **访问应用**
   打开浏览器访问: [http://localhost:3000](http://localhost:3000)

---

## 💡 首次使用指南

### 1. 选择模式
进入界面后，你会看到底部的输入框。点击输入框上方的模式切换按钮（默认可能是 "Flash" 或 "Thinking"），选择适合你的模式：
- **Flash**: 快速问答，不展示思考过程。
- **Thinking**: 展示 AI 的思考过程 (CoT)，适合复杂逻辑。
- **Vibe Fishing**: 多智能体协作模式，适合复杂任务规划。

### 2. 尝试第一个任务
在输入框中输入以下内容试试：

> "请帮我写一个贪吃蛇游戏，使用 HTML 和 JavaScript，并保存为一个文件。"

### 3. 查看结果
- 观察 AI 的思考过程和工具调用。
- 等待 AI 生成文件。
- 在右侧的 **Preview** 面板中直接预览生成的游戏，或者查看代码。

---

## ❓ 常见问题排查

### Q: 启动脚本报错 "Permission denied"
**A:** 尝试给脚本添加执行权限：
```bash
chmod +x ./scripts/start-all.sh
```

### Q: 界面显示 "Model not found" 或 API 错误
**A:** 
1. 检查 `backend/.env` 文件是否正确创建并填入了 Key。
2. 确保 `backend/config.yaml` 中的模型名称与你拥有的 API 权限匹配。
3. 重启后端服务以应用配置更改。

### Q: 端口被占用
**A:** 默认前端使用 3000，后端使用 8000。如果被占用，可以在 `frontend/package.json` 和 `backend/.env` 中修改端口配置。

---

如果遇到其他问题，请查阅 [README.md](../README.md) 或 [架构文档](ARCHITECTURE.md)。
