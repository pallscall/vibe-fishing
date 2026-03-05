# Vibe Fishing

> 一个面向“可观测多代理协作”的对话式开发环境。

![demo](20260302210417_rec_.gif)

## 📖 简介

Vibe Fishing 是一个现代化的 AI 辅助开发环境，专注于提供透明、可观测的多代理（Multi-Agent）协作体验。它通过可视化的方式展示代理的思考过程、工具调用时间线以及产物生成流程，帮助开发者更好地理解和控制 AI 的行为。

后端采用 Hono + LangGraph 负责多代理编排、技能系统与沙箱管理；前端基于 Next.js 提供流畅的流式渲染与交互体验。

## ✨ 核心特性

- **🤖 多模式对话**：支持 Flash（极速）、Thinking（思考流）、Pro（结构化规划）、Ultra（深度分析）及 Vibe Fishing（多代理协作）等多种模式。
- **👁️ 全链路可观测**：实时展示 Agent 轨迹、思考/正文分段、工具调用时间线，让 AI 的决策过程一目了然。
- **🧩 技能系统**：支持动态加载技能（Skill），提供技能路由与读取记录可视化，实现按需扩展能力。
- **📦 沙箱文件体系**：内置虚拟文件系统（uploads/workspace/outputs），支持产物在线预览（HTML/Markdown/Text等）与打包下载。
- **🔌 MCP 扩展**：通过 Model Context Protocol (MCP) 无缝接入外部工具，支持在前端面板管理 Server 配置。
- **🧵 会话线程管理**：完整的 Thread 生命周期管理，支持消息与产物的本地持久化存储。
- **🌐 内置联网搜索**：集成 Tavily 搜索服务，支持 `web_search` 工具调用。

## 🚀 快速开始

### 一键启动 (最简方式)

> 💡 **提示**: 首次使用请查看 [🚀 快速上手指南 (Quick Start)](docs/QUICKSTART.md) 获取详细步骤。

```bash
# 1. 克隆仓库
git clone https://github.com/vibe-fishing/vibe-fishing-open-source.git
cd vibe-fishing-open-source

# 2. 配置 API Key (需拥有 OpenAI/Anthropic Key)
cp backend/.env.example backend/.env
# 编辑 backend/.env 并填入 API Key

# 3. 启动服务
bash ./scripts/start-all.sh
```

- 前端地址：`http://localhost:3000`
- 后端地址：`http://localhost:8000`

### 本地开发启动（端口占用时推荐）

后端与前端端口都可通过环境变量调整；当后端不在 `8000` 时，需要同步设置前端的 `NEXT_PUBLIC_API_BASE_URL`。

```bash
# 后端（示例：8001）
cd backend
PORT=8001 yarn dev

# 前端（示例：3001，并指向后端 8001）
cd ../frontend
PORT=3001 NEXT_PUBLIC_API_BASE_URL=http://localhost:8001 yarn dev
```

### 更多方式

- **分步安装**: 详见 [docs/QUICKSTART.md#方式一-使用启动脚本-推荐-macoslinux](docs/QUICKSTART.md#方式一-使用启动脚本-推荐-macoslinux)
- **Docker 部署**: 详见 [docs/QUICKSTART.md#方式二-使用-docker-推荐-所有平台](docs/QUICKSTART.md#方式二-使用-docker-推荐-所有平台)


## 🛠️ 使用指南

### 对话模式说明

| 模式 | 描述 |
|------|------|
| **Flash** | 极速模式，关闭或弱化思考输出，适合简单问答。 |
| **Thinking** | 开启思维链（CoT），流式展示思考过程，提升可解释性。 |
| **Pro** | 结构化输出模式，包含 Planner/Researcher/Reporter 角色，先规划后执行。 |
| **Ultra** | 深度分析模式，在 Pro 基础上增加 Analyst/Risk/Critic 等角色，全面覆盖细节。 |
| **Vibe Fishing** | 多代理协作模式，倾向于使用 `task` 进行子任务委派，前端集中展示 Agent 协作。 |

### 常用指令

在对话框中输入以下指令可触发特定功能：

- `/multi <内容>`：强制开启多代理协作链路。
- `/skill <skillId> <内容>`：指定当前消息使用特定技能。
- `/compact [focus]`：对当前会话线程进行摘要压缩，`focus` 为可选的关注点参数。

### 文件与产物管理

后端在每个线程下维护独立的文件目录，并通过虚拟路径暴露给 AI 工具：

- `/tmp/user-data/uploads`：用户上传区
- `/tmp/user-data/workspace`：工作区
- `/tmp/user-data/outputs`：最终交付区

当 AI 生成文件到 `outputs` 目录时，前端会自动识别为 Artifact 并展示在预览面板中，支持：
- 任意后缀文件的预览与源码查看（无法文本化的内容会以二进制/base64 方式展示）
- 大文件按前缀截断展示（默认最多 2MB），避免页面卡顿
- 打包下载所有产物

### Timeline（树形）

Timeline 面板以树形方式聚合展示执行轨迹：
- Agent → Component（工具）→ Call（单次调用）
- 每一层会汇总耗时与状态（running/done/error），便于定位耗时与失败点

## ⚙️ 配置说明

### 核心配置

主要配置文件位于 `backend/config.yaml`（需从 example 复制）。

- **模型配置**：定义可用的 LLM 模型及其参数。
- **服务端口**：默认 `8000`，可通过 `PORT` 环境变量修改。

### 环境变量

建议参考 `backend/.env.example` 创建 `.env` 文件。

| 变量名 | 描述 |
|--------|------|
| `OPENAI_API_KEY` | OpenAI 接口密钥 |
| `ANTHROPIC_API_KEY` | Anthropic 接口密钥 |
| `TAVILY_API_KEY` | 启用联网搜索所需的 Tavily Key |
| `MCP_ENABLED` | 是否启用 MCP (默认 true) |
| `SANDBOX_PROVIDER` | 沙箱提供商 (local/docker/volcengine) |
| `PORT` | 服务端口（后端默认 8000；前端默认 3000） |
| `NEXT_PUBLIC_API_BASE_URL` | 前端请求后端的 Base URL（默认 http://localhost:8000） |

### 沙箱配置

后端支持多种沙箱模式：
1. **静态/共享 Sandbox** (默认)：连接现有的 AIO Sandbox。
2. **按线程隔离 (Lifecycle)**：每个线程创建独立的运行环境，需设置 `SANDBOX_PER_THREAD_LIFECYCLE=true` 并配置相应的 Provider (如 docker 或 cloud function)。

## 🏗️ 架构与开发

本项目包含两个主要部分：
- `backend/`: TypeScript 后端服务
- `frontend/`: Next.js 前端应用
- `skills/`: 技能定义与脚本

关于详细的架构设计、技术选型及开发记录，请参阅 [架构文档](docs/ARCHITECTURE.md)。

## 🤝 贡献指南

欢迎提交 Pull Request 或 Issue！在提交代码前，请确保：
1. 代码风格保持一致。
2. 新增功能包含必要的测试。
3. 更新相关文档。

## 📄 许可证

本项目采用 MIT 许可证（如适用），详情请查看各子目录下的 LICENSE 文件。
