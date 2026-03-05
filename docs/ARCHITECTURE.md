# Vibe Fishing 开发记录

本文详细记录 Vibe Fishing 的技术点、实现方式、设计原因与开发过程，作为长期维护的工程记录。

## 项目目标
- 提供可观测的多代理对话体验（规划、研究、分析、风险、批评、汇总）。
- 支持技能系统与按需加载（skill_system + read_file）。
- 具备本地沙箱能力，隔离文件与工具执行。
- 提供前端可视化（流式输出、工具时间线、Agent 轨迹、产物预览）。
- 保持结构清晰，便于迁移到容器化执行与更强安全隔离。

## 目录结构
```
.
  backend/                    后端服务（Hono + LangGraph）
    src/
      agents/                 master agent 提示词基座
      config/                 应用与模型配置解析
      mcp/                    MCP 工具加载与调用
      prompts/                规划/研究/分析等系统提示词
      routes/                 API 路由（health、chat、models、threads、skills、uploads、artifacts、mcp）
      sandbox/                本地沙箱与线程目录管理
      skills/                 技能加载与启用状态
      store/                  线程与产物持久化
  frontend/                   前端应用（Next.js App Router）
    src/
      app/                    页面与布局
      components/             Chat 与控制面板组件
      lib/                    类型与工具函数
  scripts/                    本地启动脚本
  skills/                     技能库（SKILL.md + scripts）
  README.md                   本文档（开发记录）
```

## 架构总览
系统由前端（Next.js）与后端（Hono + LangGraph）组成，核心路径如下：
1. 前端通过 `/chat/stream` 建立 SSE
2. 后端解析模式、技能与工具集
3. LangGraph 触发多代理或单代理流程
4. 代理结果与工具事件流式回传
5. 前端更新消息、时间线、产物预览

## 后端技术点（详细）

### 1) Hono API 服务
- 实现方式：`src/index.ts` 中注册 routes（models、chat、skills、uploads、artifacts）。
- 设计原因：Hono 轻量、无额外运行时开销，适合 SSE 与高频请求。

### 2) Chat 核心编排
- 实现方式：提供 `/chat`（非流式）与 `/chat/stream`（SSE）两条路径，统一使用 `ChatRequestSchema` 校验。
- 设计原因：流式响应优化交互体验，非流式保留兼容性。

### 3) 多代理编排（LangGraph）
- 实现方式：LangGraph 流程定义为 Planner → Researcher → (Analyst → Risk → Critic) → Reporter。
- 设计原因：分工清晰、产出结构化，且便于前端按 section 展示。
- 关键节点：`planner` 生成计划，`researcher` 扩展事实与假设，`analyst/risk/critic` 分析与风险补充，`reporter` 输出最终结果。

### 4) Master Agent 提示词基座
- 实现方式：`MASTER_AGENT_PROMPT` 作为 system prompt 基座，统一行为规范。
- 设计原因：保持全局风格一致，降低提示词漂移。

### 5) 技能系统（Skills）
- 实现方式：读取 `skills/*/SKILL.md`，解析 frontmatter，结合 `skills_state.json` 过滤启用。
- 调用方式：自动技能选择或 `/skill` 指令指定。
- 设计原因：把高频流程沉淀成技能文档，提升复用与一致性。

#### 技能加载时机（详细）
- **请求进入时**：每次 `/chat` 或 `/chat/stream` 请求都会先解析技能指令与自动路由。
  - 若用户显式 `/skill xxx`，直接指定技能；
  - 否则触发 `maybeSelectSkill`，根据消息与当前已启用技能列表选择。
- **系统提示词组装时**：构建 system prompt 时，会把 `skill_system`（可用技能清单 + 位置）写入 system 基座，并在命中技能时追加该技能的 `SKILL.md` 全文。
- **工具读取时**：模型若决定读取技能细节，会通过 `read_file` 读取 `/mnt/skills/.../SKILL.md`，这一步由工具层完成并记录到 `skillReads`。
- **持久化与展示**：选择过的技能会写入 `meta.skills`，读取过的技能会写入 `meta.skillReads`，前端以标签形式展示。

### 6) 工具系统（MCP + 本地工具）
- 实现方式：OpenAI-compatible 工具协议 + MCP 工具加载；本地补齐 `read_file / write_file / list_dir / bash`。
- 设计原因：在无 MCP 的情况下保留核心可用性，同时兼容外部工具。

### 7) 本地沙箱与路径映射
- 实现方式：每个 thread 创建 `storage/threads/{id}/user-data/{workspace,uploads,outputs}`。
- 虚拟路径映射：
  - `/tmp/user-data/workspace` → workspace
  - `/tmp/user-data/uploads` → uploads
  - `/tmp/user-data/outputs` → outputs
  - `/mnt/skills` → skills
- 设计原因：延续 Vibe Fishing 的路径抽象，便于迁移到容器与远端执行环境。

### 8) Bash 安全策略
- 实现方式：`bash` 工具执行前进行黑名单过滤（系统管理、权限修改、远程连接等高危指令）。
- 设计原因：降低误操作风险，避免破坏系统环境。

### 9) 产物与线程存储
- 实现方式：产物写入 `storage/artifacts/{threadId}`，线程消息写入 `storage/threads.json`。
- 设计原因：本地持久化便于调试与快速回放，不依赖外部数据库。

### 10) 上传与下载
- 实现方式：`/uploads` 支持按 threadId 上传文件、列举与下载。
- 输出：返回虚拟路径 `/tmp/user-data/uploads/*` 供工具调用。
- 设计原因：保持与沙箱路径一致，便于模型直接操作。

### 11) OpenAI-compatible 稳定性处理
- 实现方式：对空内容响应做容错处理并记录警告。
- 设计原因：兼容多厂商实现差异，避免流程中断。

### 12) 可观测性事件
- 实现方式：SSE 推送 `agent_start/agent_end/agent_delta`、`tool_start/tool_end`，以及产物产生事件 `artifact`。
- 设计原因：前端可直接渲染时间线与阶段化输出，提升可解释性。

## 前端技术点（详细）

### 1) Next.js App Router
- 实现方式：使用 `app/` 结构 + 组件化拆分（Chat、Settings、StatusPanel）。
- 设计原因：便于页面与状态拆分，减少耦合。

### 2) SSE 流式渲染
- 实现方式：前端 SSE 解析事件，增量更新 content、thinking、plan、research 等字段。
- 设计原因：提升响应感知速度，匹配 LLM 流式输出特点。

### 3) Agent 轨迹与工具时间线
- 实现方式：事件驱动更新 `agentTimeline` 与 `toolTimeline`，并在 UI 展示。
- 设计原因：清晰呈现多代理协作过程，便于审计。

### 4) 产物预览
- 实现方式：基于 artifact 类型判断预览方式（markdown/image/video/text/pdf），并提供文件树目录展开与 HTML/文本源码查看。
- 设计原因：可直接查看输出结果，避免二次下载。


## API 设计要点
- `/health`：健康检查。
- `/chat`：非流式请求与响应。
- `/chat/stream`：SSE 流式请求。
- `/models`：可用模型列表。
- `/skills`：技能列表 / 更新启用状态 / 读取内容。
- `/threads`：线程列表 / 创建 / 获取 / 删除 / 追加消息。
- `/uploads`：上传 / 列举 / 下载。
- `/artifacts`：生成产物读取 / 预览 / 打包下载。
- `/artifacts/:threadId/*`：读取任意层级的 artifact 文件（支持子目录）。
- `/mcp/config`：读取/更新 MCP server 配置（更新时会校验可达性）。
- `/memory`：预留的 memory 接口（当前返回空数组）。

## 关键数据流
1. 用户消息 → `/chat/stream`
2. 服务端解析模式、技能、工具集
3. LangGraph 启动代理链
4. 事件流写入前端状态
5. 持久化线程消息与产物

## 设计取舍
- 选择 LangGraph：便于多代理流程编排与并行节点扩展。
- 选择 Hono：轻量、依赖少、SSE 易维护。
- 采用本地存储：减少外部依赖，调试成本低。
- 技能与沙箱路径统一：减少模型提示词差异与迁移成本。

## 开发记录（阶段性）
- 引入 Master Agent 与 skill_system 注入
- 增加技能读取工具与技能使用可观测性
- 对接本地沙箱路径映射与基础文件工具
- 补齐 uploads 路由与 artifacts 产物输出
- 增强 bash 工具安全策略

## 运行方式（参考）
- 后端：`cd backend && npm run dev`
- 前端：`cd frontend && npm run dev`
