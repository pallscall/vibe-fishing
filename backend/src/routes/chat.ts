import { Hono } from 'hono'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { z } from 'zod'
import { findModelConfig, getModelConfigs, type ModelConfig } from '../config/models'
import { loadAppConfig } from '../config/appConfig'
import { getSubagentConfig, getSubagentNames } from '../subagents/registry'
import {
  ANALYST_PROMPT,
  CODER_PROMPT,
  CRITIC_PROMPT,
  PLANNER_PROMPT,
  REPORTER_PROMPT,
  RESEARCHER_PROMPT,
  RISK_PROMPT,
  SKILL_ROUTER_PROMPT,
  SUBAGENT_PROMPT,
  VIBEFISHING_SUBAGENT_GUIDE
} from '../prompts/chatPrompts'
import { appendMessage, createThread, getThread, updateThreadSummary } from '../store/threads'
import { saveFileArtifact, saveTextArtifact } from '../store/artifacts'
import { getSkillByName, loadSkills, resolveSkillsPath, type SkillDefinition } from '../skills/loader'
import { executeMcpTool, loadMcpToolset, type OpenAiToolDefinition } from '../mcp/tools'
import type { McpServerConfig } from '../mcp/config'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { MASTER_AGENT_PROMPT, buildSkillSystemSection } from '../agents/masterAgent'
import { ensureThreadData, getSkillsContainerPath, type ThreadData } from '../sandbox/threadData'

export const chatRoute = new Hono()

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  modelId: z.string().optional(),
  threadId: z.string().optional(),
  multiAgent: z.boolean().optional(),
  mode: z.enum(['flash', 'thinking', 'pro', 'ultra', 'vibefishing']).optional()
})

const resolveDefaultModel = () => {
  const configs = getModelConfigs()
  const preferred = configs.find((model) => Boolean(model.apiKey))
  return preferred ?? configs[0]
}

const getApiKey = (model: ModelConfig) => {
  if (model.apiKey) return model.apiKey
  throw new Error(`Missing apiKey for model ${model.id}`)
}

const buildEndpoint = (baseUrl: string, path: string) => {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBase).toString()
}

const parseContextMaxMessages = () => {
  const fromConfig = loadAppConfig()?.chat?.contextMaxMessages
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  const raw = process.env.CHAT_CONTEXT_MAX_MESSAGES ?? process.env.CONTEXT_MAX_MESSAGES
  const parsed = raw ? Number.parseInt(raw, 10) : 20
  if (!Number.isFinite(parsed) || parsed <= 0) return 20
  return parsed
}

const parseSummaryEnabled = () => {
  const fromConfig = loadAppConfig()?.chat?.summaryEnabled
  if (typeof fromConfig === 'boolean') return fromConfig
  const raw = process.env.CHAT_SUMMARY_ENABLED
  if (raw === undefined) return true
  return raw.toLowerCase() !== 'false'
}

const parseAutoSkillEnabled = () => {
  const fromConfig = loadAppConfig()?.chat?.autoSkillEnabled
  if (typeof fromConfig === 'boolean') return fromConfig
  const raw = process.env.AUTO_SKILL_ENABLED
  if (raw === undefined) return true
  return raw.toLowerCase() !== 'false'
}

const parseMcpEnabled = () => {
  const fromConfig = loadAppConfig()?.chat?.mcpEnabled
  if (typeof fromConfig === 'boolean') return fromConfig
  const raw = process.env.MCP_ENABLED
  if (raw === undefined) return true
  return raw.toLowerCase() !== 'false'
}

const parseSummaryTriggerMessages = () => {
  const fromConfig = loadAppConfig()?.chat?.summaryTriggerMessages
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  const raw = process.env.CHAT_SUMMARY_TRIGGER_MESSAGES
  const parsed = raw ? Number.parseInt(raw, 10) : 40
  if (!Number.isFinite(parsed) || parsed <= 0) return 40
  return parsed
}

const parseSummaryKeepMessages = () => {
  const fromConfig = loadAppConfig()?.chat?.summaryKeepMessages
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  const raw = process.env.CHAT_SUMMARY_KEEP_MESSAGES
  const parsed = raw ? Number.parseInt(raw, 10) : 12
  if (!Number.isFinite(parsed) || parsed <= 0) return 12
  return parsed
}

const parseThinkingSummaryEnabled = () => {
  const fromConfig = loadAppConfig()?.chat?.thinkingSummaryEnabled
  if (typeof fromConfig === 'boolean') return fromConfig
  const raw = process.env.CHAT_THINKING_SUMMARY_ENABLED
  if (raw === undefined) return true
  return raw.toLowerCase() !== 'false'
}

const parseChatRequestTimeoutMs = () => {
  const fromConfig = loadAppConfig()?.chat?.requestTimeoutMs
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  const raw = process.env.CHAT_REQUEST_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : 600000
  if (!Number.isFinite(parsed) || parsed <= 0) return 600000
  return parsed
}

const parseChatStreamIdleTimeoutMs = () => {
  const fromConfig = loadAppConfig()?.chat?.streamIdleTimeoutMs
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  const raw = process.env.CHAT_STREAM_IDLE_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : 60000
  if (!Number.isFinite(parsed) || parsed <= 0) return 60000
  return parsed
}

const createRequestTimeout = (signal?: AbortSignal) => {
  const timeoutMs = parseChatRequestTimeoutMs()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const cleanup = () => {
    if (signal) signal.removeEventListener('abort', onAbort)
    clearTimeout(timeout)
  }
  return { controller, timeout, timeoutMs, cleanup }
}

const isAbortError = (error: unknown) => {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
}

const createUpstreamTimeoutError = () => {
  const error = new Error('Upstream timeout')
  error.name = 'UpstreamTimeout'
  return error
}

const splitTextForStream = (input: string, chunkSize = 800) => {
  if (!input) return []
  const chunks: string[] = []
  for (let index = 0; index < input.length; index += chunkSize) {
    chunks.push(input.slice(index, index + chunkSize))
  }
  return chunks
}

const formatMessagesForSummary = (messages: Array<{ role: string; content: string }>) => {
  return messages
    .map((message) => {
      if (message.role === 'user') return `User: ${message.content}`
      if (message.role === 'assistant') return `Assistant: ${message.content}`
      return `System: ${message.content}`
    })
    .join('\n')
}

const buildSummaryInput = (existingSummary: string | null, messages: Array<{ role: string; content: string }>) => {
  const summaryBlock = existingSummary ? `Existing summary:\n${existingSummary}\n\n` : ''
  const messagesBlock = formatMessagesForSummary(messages)
  return `${summaryBlock}New messages:\n${messagesBlock}`
}

const buildSkillRouterInput = (message: string, skills: SkillDefinition[]) => {
  const skillsList = skills
    .map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`)
    .join('\n')
  return `User request:\n${message}\n\nAvailable skills:\n${skillsList}\n\nReturn only the skill name or "NONE".`
}

const maybeSelectSkill = async (
  message: string,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  onUsage?: (usage: TokenUsage) => void
) => {
  if (!parseAutoSkillEnabled()) return null
  const enabledSkills = loadSkills().filter((skill) => skill.enabled)
  if (enabledSkills.length === 0) return null
  const routerInput = buildSkillRouterInput(message, enabledSkills)
  const result = await runAgentStep(model, SKILL_ROUTER_PROMPT, routerInput, signal, undefined, undefined, undefined, onUsage)
  const firstLine = (result.content ?? '').split('\n')[0]?.trim()
  if (!firstLine) return null
  const normalized = firstLine.replace(/[`"'']/g, '').trim()
  if (!normalized) return null
  if (normalized.toLowerCase() === 'none' || normalized.toLowerCase() === 'null') return null
  return (
    enabledSkills.find((skill) => skill.name.toLowerCase() === normalized.toLowerCase()) ??
    enabledSkills.find((skill) => skill.id.toLowerCase() === normalized.toLowerCase()) ??
    null
  )
}

type ToolExecutionContext = {
  model: ModelConfig
  systemText?: string
  threadId?: string
  send?: (event: string, data: unknown) => void
  openAiThinkingExtras?: Record<string, unknown>
  toolset?: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null
  onToolEvent?: (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => void
  onUsage?: (usage: TokenUsage) => void
  signal?: AbortSignal
  subagentCallCount?: number
  maxSubagentCalls?: number
  toolErrorRecoveryInjected?: boolean
}

type LocalToolHandler = (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string> | string

const SUBAGENT_PROMPT_MAP: Record<string, string> = {
  planner: PLANNER_PROMPT,
  researcher: RESEARCHER_PROMPT,
  analyst: ANALYST_PROMPT,
  risk: RISK_PROMPT,
  critic: CRITIC_PROMPT,
  coder: CODER_PROMPT,
  reporter: REPORTER_PROMPT
}

const MASTER_AGENT_NAME = 'master agent'

const buildSubagentDisplayName = (task: string, type: string) => {
  const text = task.toLowerCase()
  const scene =
    /网站|网页|页面|landing|web|site|html/.test(text)
      ? 'web'
      : /报告|report|research|analysis|调研|总结/.test(text)
        ? 'report'
        : /数据|chart|可视化|统计|指标|table/.test(text)
          ? 'data'
          : /代码|coding|implement|开发|编程|refactor|bug/.test(text)
            ? 'code'
            : /命令|bash|build|test|部署|deploy|install/.test(text)
              ? 'ops'
              : 'task'
  return `${type}:${scene}`
}

const buildLocalToolset = (threadData: ThreadData, threadId: string) => {
  const tools: OpenAiToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a text file from the skills or sandbox workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Execute a shell command inside the sandbox workspace',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write any generated file to the sandbox (always call this when the user expects a file)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'task',
        description: 'Delegate a task to a subagent and return its output',
        parameters: {
          type: 'object',
          properties: {
            subagent_type: { type: 'string' },
            task: { type: 'string' }
          },
          required: ['task']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List directory contents in the sandbox workspace or skills',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    }
  ]
  const skillsRoot = resolveSkillsPath()
  const skillsContainerPath = getSkillsContainerPath()
  const sandboxPrefix = '/mnt/user-data'
  const resolveSandboxPath = (rawPath: string) => {
    if (rawPath.startsWith(skillsContainerPath)) {
      const relative = path.relative(skillsContainerPath, rawPath)
      return path.resolve(skillsRoot, relative)
    }
    if (rawPath.startsWith(sandboxPrefix)) {
      const relative = rawPath.slice(sandboxPrefix.length).replace(/^\/+/, '')
      const [subdir, rest] = relative.split('/', 2)
      const base =
        subdir === 'workspace'
          ? threadData.workspacePath
          : subdir === 'uploads'
            ? threadData.uploadsPath
            : subdir === 'outputs'
              ? threadData.outputsPath
              : null
      if (!base) {
        throw new Error('Invalid sandbox path')
      }
      return rest ? path.join(base, rest) : base
    }
    return path.isAbsolute(rawPath) ? rawPath : path.join(threadData.workspacePath, rawPath)
  }
  const isWithin = (target: string, root: string) => {
    const normalizedTarget = path.resolve(target)
    const normalizedRoot = path.resolve(root)
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  }
  const ensureAllowedPath = (target: string) => {
    if (isWithin(target, skillsRoot)) return
    if (isWithin(target, threadData.workspacePath)) return
    if (isWithin(target, threadData.uploadsPath)) return
    if (isWithin(target, threadData.outputsPath)) return
    throw new Error('Path outside sandbox')
  }
  const localToolMap = new Map<string, LocalToolHandler>()
  localToolMap.set('read_file', (args) => {
    const rawPath = args?.path
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      throw new Error('Invalid path')
    }
    const targetPath = resolveSandboxPath(rawPath)
    ensureAllowedPath(targetPath)
    if (!fs.existsSync(targetPath)) {
      throw new Error('File not found')
    }
    const content = fs.readFileSync(targetPath, 'utf-8')
    return content.length > 20000 ? `${content.slice(0, 20000)}…` : content
  })
  localToolMap.set('write_file', (args) => {
    const writeOne = (rawPath: unknown, content: unknown) => {
      if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
        throw new Error('Invalid path')
      }
      if (typeof content !== 'string') {
        throw new Error('Invalid content')
      }
      const targetPath = resolveSandboxPath(rawPath)
      ensureAllowedPath(targetPath)
      const dir = path.dirname(targetPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(targetPath, content, 'utf-8')
      const artifact = saveFileArtifact(threadId, targetPath)
      return {
        path: rawPath,
        bytes: Buffer.byteLength(content, 'utf-8'),
        artifact
      }
    }
    if (Array.isArray(args)) {
      const results = args.map((entry) => writeOne(entry?.path, entry?.content))
      return JSON.stringify({ ok: true, files: results })
    }
    if (Array.isArray(args?.files)) {
      const results = args.files.map((entry: any) => writeOne(entry?.path, entry?.content))
      return JSON.stringify({ ok: true, files: results })
    }
    const result = writeOne(args?.path, args?.content)
    return JSON.stringify({ ok: true, ...result })
  })
  localToolMap.set('list_dir', (args) => {
    const rawPath = args?.path
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      throw new Error('Invalid path')
    }
    const targetPath = resolveSandboxPath(rawPath)
    ensureAllowedPath(targetPath)
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      throw new Error('Directory not found')
    }
    const entries = fs.readdirSync(targetPath, { withFileTypes: true })
    const output = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file'
    }))
    return JSON.stringify(output)
  })
  localToolMap.set('bash', (args) => {
    const command = args?.command
    const cwd = args?.cwd
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('Invalid command')
    }
    const blockedTokens = [
      'rm -rf',
      'mkfs',
      'dd ',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
      'systemctl',
      'service',
      'kill ',
      'killall',
      'pkill',
      'useradd',
      'userdel',
      'usermod',
      'groupadd',
      'groupdel',
      'groupmod',
      'chmod 777',
      'chown',
      'sudo',
      'mount',
      'umount',
      'passwd',
      'scp',
      'ssh '
    ]
    const normalized = ` ${command.toLowerCase().replace(/\s+/g, ' ').trim()} `
    if (blockedTokens.some((token) => normalized.includes(` ${token} `))) {
      throw new Error('Command is not allowed')
    }
    let resolvedCwd = threadData.workspacePath
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      const targetPath = resolveSandboxPath(cwd)
      ensureAllowedPath(targetPath)
      resolvedCwd = targetPath
    }
    const result = spawnSync(command, {
      cwd: resolvedCwd,
      shell: true,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024
    })
    return JSON.stringify({
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exit_code: typeof result.status === 'number' ? result.status : 0
    })
  })
  localToolMap.set('task', async (args, context) => {
    if (!context) {
      throw new Error('Missing tool context')
    }
    const ctx = context
    const rawType = args?.subagent_type
    const rawTask = args?.task ?? args?.input ?? args?.prompt
    const subagentType =
      typeof rawType === 'string' && rawType.trim().length > 0 ? rawType.trim().toLowerCase() : 'general-purpose'
    if (typeof rawTask !== 'string' || rawTask.trim().length === 0) {
      throw new Error('Invalid task')
    }
    const maxCalls = typeof ctx.maxSubagentCalls === 'number' ? ctx.maxSubagentCalls : 3
    ctx.subagentCallCount = (ctx.subagentCallCount ?? 0) + 1
    if (ctx.subagentCallCount > maxCalls) {
      throw new Error(`Too many task calls: max ${maxCalls}`)
    }
    const subagentConfig = getSubagentConfig(subagentType)
    if (!subagentConfig) {
      throw new Error(`Unknown subagent type: ${subagentType}. Available: ${getSubagentNames().join(', ')}`)
    }
    const subagentDisplayName = buildSubagentDisplayName(rawTask, subagentType)
    const rolePrompt = subagentConfig.systemPrompt || SUBAGENT_PROMPT_MAP[subagentType] || SUBAGENT_PROMPT
    const start = Date.now()
    ctx.send?.('agent_start', { name: subagentDisplayName })
    let content = ''
    let thinking = ''
    let thinkingActive = false
    let toolNames: string[] = []
    if (ctx.model.protocol === 'openai' || ctx.model.protocol === 'openai_compatible') {
      const messages: OpenAiMessage[] = []
      const systemContent = rolePrompt
      messages.push({ role: 'system', content: systemContent })
      messages.push({ role: 'user', content: rawTask })
      const toolset = ctx.toolset
      if (toolset && toolset.tools.length > 0) {
        const filteredTools = toolset.tools.filter((tool) => {
          const name = tool.function?.name
          if (!name) return false
          if (name === 'task') return false
          if (subagentConfig.tools?.length) return subagentConfig.tools.includes(name)
          if (subagentConfig.disallowedTools?.length) return !subagentConfig.disallowedTools.includes(name)
          return true
        })
        const filteredLocal = new Map(toolset.localToolMap)
        filteredLocal.delete('task')
        if (subagentConfig.tools?.length) {
          for (const key of Array.from(filteredLocal.keys())) {
            if (!subagentConfig.tools.includes(key)) filteredLocal.delete(key)
          }
        }
        if (subagentConfig.disallowedTools?.length) {
          for (const key of Array.from(filteredLocal.keys())) {
            if (subagentConfig.disallowedTools.includes(key)) filteredLocal.delete(key)
          }
        }
        const filteredToolset = {
          tools: filteredTools,
          toolMap: toolset.toolMap,
          localToolMap: filteredLocal
        }
        const result = await streamOpenAiWithMcp(
          messages,
          ctx.model,
          ctx.signal,
          ctx.openAiThinkingExtras,
          filteredToolset,
          (chunk) => {
            if (chunk.type === 'reasoning') {
              if (!thinkingActive) {
                thinkingActive = true
                ctx.send?.('agent_thinking_start', { name: subagentDisplayName })
              }
              thinking += chunk.value
              ctx.send?.('agent_thinking_delta', { name: subagentDisplayName, delta: chunk.value })
              return
            }
            content += chunk.value
            ctx.send?.('agent_delta', { name: subagentDisplayName, delta: chunk.value })
          },
          ctx.onToolEvent,
          { ...ctx, toolset: filteredToolset, systemText: systemContent }
        )
        toolNames = result.tools
      } else {
        for await (const chunk of callOpenAiCompatibleStream(
          messages,
          ctx.model,
          ctx.signal,
          ctx.openAiThinkingExtras,
          ctx.onUsage
        )) {
          if (chunk.type === 'reasoning') {
            if (!thinkingActive) {
              thinkingActive = true
              ctx.send?.('agent_thinking_start', { name: subagentDisplayName })
            }
            thinking += chunk.value
            ctx.send?.('agent_thinking_delta', { name: subagentDisplayName, delta: chunk.value })
            continue
          }
          content += chunk.value
          ctx.send?.('agent_delta', { name: subagentDisplayName, delta: chunk.value })
        }
      }
    } else {
      const result = await runAgentStep(ctx.model, rolePrompt, rawTask, ctx.signal, rolePrompt, ctx.openAiThinkingExtras, {
        agentName: subagentType,
        threadId: ctx.threadId
      })
      content = result.content
      toolNames = result.tools ?? []
    }
    if (thinkingActive) {
      ctx.send?.('agent_thinking_end', { name: subagentDisplayName })
    }
    ctx.send?.('agent', { name: subagentDisplayName, output: content })
    ctx.send?.('agent_end', { name: subagentDisplayName, durationMs: Date.now() - start })
    return JSON.stringify({
      content,
      thinking: thinking.length > 0 ? thinking : undefined,
      tools: toolNames,
      subagent_type: subagentType,
      config: subagentConfig.name
    })
  })
  return { tools, localToolMap }
}

const maybeLoadMcpToolset = async (model: ModelConfig, threadData: ThreadData, threadId: string) => {
  if (model.protocol !== 'openai' && model.protocol !== 'openai_compatible') return null
  const localToolset = buildLocalToolset(threadData, threadId)
  if (!parseMcpEnabled()) {
    return { tools: localToolset.tools, toolMap: new Map(), localToolMap: localToolset.localToolMap }
  }
  const toolset = await loadMcpToolset()
  return {
    tools: [...toolset.tools, ...localToolset.tools],
    toolMap: toolset.toolMap,
    localToolMap: localToolset.localToolMap
  }
}

const parseToolArguments = (raw: unknown) => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

const sanitizeToolText = (input: string) => {
  return input
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/SERVICE_ACCOUNT_SECRET_KEY\s*[:=]\s*["']?[^"'\s]+/g, 'SERVICE_ACCOUNT_SECRET_KEY=[REDACTED]')
}

const sanitizeToolArgs = (args: Record<string, unknown>) => {
  const redactValue = (value: unknown) => {
    if (typeof value !== 'string') return value
    if (value.startsWith('sk-')) return '[REDACTED]'
    if (value.startsWith('Bearer ')) return 'Bearer [REDACTED]'
    if (value.match(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) return '[REDACTED_JWT]'
    return value
  }

  const walk = (value: unknown): unknown => {
    if (!value) return value
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value === 'object') {
      const output: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k.toLowerCase().match(/(api_?key|token|secret|password|authorization|cookie)/)) {
          output[k] = '[REDACTED]'
        } else {
          const next = walk(v)
          output[k] = redactValue(next)
        }
      }
      return output
    }
    return redactValue(value)
  }

  return (walk(args) as Record<string, unknown>) ?? {}
}

const truncateToolText = (input: string, maxChars = 2000) => {
  const value = input.trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}

const buildSkillReads = (toolTimeline: Array<{ name: string; args?: Record<string, unknown> }>) => {
  const skills = loadSkills()
  if (!skills.length) return []
  const skillsRoot = resolveSkillsPath()
  const skillsContainerPath = getSkillsContainerPath()
  const skillPathMap = new Map<string, string>()
  skills.forEach((skill) => {
    const normalized = path.resolve(skill.filePath)
    skillPathMap.set(normalized, skill.name)
  })
  const result: Array<{ name: string; path: string }> = []
  const seen = new Set<string>()
  toolTimeline.forEach((tool) => {
    if (tool.name !== 'read_file') return
    const rawPath = tool.args?.path
    if (typeof rawPath !== 'string') return
    const targetPath = rawPath.startsWith(skillsContainerPath)
      ? path.resolve(skillsRoot, path.relative(skillsContainerPath, rawPath))
      : path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(skillsRoot, rawPath)
    const normalizedTarget = path.resolve(targetPath)
    const skillName = skillPathMap.get(normalizedTarget)
    if (!skillName || seen.has(skillName)) return
    seen.add(skillName)
    result.push({ name: skillName, path: normalizedTarget })
  })
  return result
}

const buildFileArtifacts = (toolTimeline: Array<{ name: string; result?: string }>) => {
  const artifacts: Array<{ name: string; size: number; url: string }> = []
  for (const entry of toolTimeline) {
    if (entry.name !== 'write_file') continue
    const raw = entry.result
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    let parsed: any = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const collect = (artifact: any) => {
      const name = artifact?.name
      const size = artifact?.size
      const url = artifact?.url
      if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') return
      if (artifacts.some((item) => item.url === url)) return
      artifacts.push({ name, size, url })
    }
    if (parsed?.artifact) {
      collect(parsed.artifact)
      continue
    }
    if (Array.isArray(parsed?.files)) {
      parsed.files.forEach((item: any) => {
        if (item?.artifact) collect(item.artifact)
      })
    }
  }
  return artifacts
}

const stringifyToolResult = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const truncateTextHeadTail = (value: string, maxChars: number, headChars = 5200, tailChars = 1800) => {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const head = text.slice(0, Math.min(headChars, Math.max(0, maxChars - 1200)))
  const tail = text.slice(Math.max(0, text.length - Math.min(tailChars, Math.max(0, maxChars - head.length - 200))))
  return `${head}\n\n[TRUNCATED ${text.length - head.length - tail.length} chars]\n\n${tail}`
}

const takeTailLines = (value: string, maxLines: number, maxChars: number) => {
  const text = value.trim()
  if (!text) return ''
  const lines = text.split('\n')
  const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n')
  if (tail.length <= maxChars) return tail
  return truncateTextHeadTail(tail, maxChars, Math.floor(maxChars * 0.7), Math.floor(maxChars * 0.25))
}

const formatToolResultForModel = (toolName: string, result: unknown) => {
  const raw = sanitizeToolText(stringifyToolResult(result))
  if (toolName === 'bash') {
    let parsed: any = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object') {
      const stdout = typeof parsed.stdout === 'string' ? parsed.stdout : ''
      const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : ''
      const exitCode = typeof parsed.exit_code === 'number' ? parsed.exit_code : typeof parsed.status === 'number' ? parsed.status : 0
      const payload = {
        exit_code: exitCode,
        stdout_tail: takeTailLines(stdout, 80, 4500),
        stderr_tail: takeTailLines(stderr, 80, 4500)
      }
      return JSON.stringify(payload, null, 2)
    }
    return truncateTextHeadTail(raw, 9000)
  }
  if (toolName === 'task') {
    return truncateTextHeadTail(raw, 8000, 5200, 1800)
  }
  if (toolName === 'read_file') {
    return truncateTextHeadTail(raw, 8000, 5200, 1800)
  }
  if (toolName === 'write_file') {
    return truncateTextHeadTail(raw, 6000, 4200, 1200)
  }
  return truncateTextHeadTail(raw, 9000, 6000, 1800)
}

const executeMcpToolCalls = async (
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>,
  toolset: {
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  },
  onToolEvent?: (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => void,
  context?: ToolExecutionContext
) => {
  const toolMessages: OpenAiMessage[] = []
  const toolNames: string[] = []
  let hadError = false
  const toolArgsLogEnabled = process.env.VIBE_FISHING_TOOL_ARGS_LOG === 'true'
  for (const call of toolCalls) {
    if (!call?.name || !call?.id) continue
    if (toolArgsLogEnabled) {
      const rawText =
        typeof call.arguments === 'string'
          ? call.arguments
          : typeof call.arguments === 'object'
            ? JSON.stringify(call.arguments)
            : String(call.arguments ?? '')
      const safeRaw = truncateToolText(sanitizeToolText(rawText))
      console.info('tool_args_raw', { name: call.name, id: call.id, raw: safeRaw })
    }
    const args = sanitizeToolArgs(parseToolArguments(call.arguments))
    const entry = toolset.toolMap.get(call.name)
    const toolStart = Date.now()
    onToolEvent?.('tool_start', {
      callId: call.id,
      name: call.name,
      serverName: entry?.serverName,
      toolName: entry?.toolName,
      args
    })
    let result: unknown
    let ok = true
    try {
      const localTool = toolset.localToolMap.get(call.name)
      if (localTool) {
        result = await localTool(args, context)
      } else {
        result = await executeMcpTool(toolset.toolMap, call.name, args)
      }
      const raw = typeof result === 'string' ? result : JSON.stringify(result)
      const safe = truncateToolText(sanitizeToolText(raw))
      onToolEvent?.('tool_end', {
        callId: call.id,
        name: call.name,
        durationMs: Date.now() - toolStart,
        ok: true,
        result: safe
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ok = false
      hadError = true
      result = { error: message }
      onToolEvent?.('tool_end', {
        callId: call.id,
        name: call.name,
        durationMs: Date.now() - toolStart,
        ok: false,
        error: truncateToolText(sanitizeToolText(message))
      })
    }
    const modelToolContent = ok
      ? formatToolResultForModel(call.name, result)
      : truncateTextHeadTail(sanitizeToolText(stringifyToolResult(result)), 4000, 2800, 900)
    toolMessages.push({
      role: 'tool',
      content: modelToolContent,
      tool_call_id: call.id
    })
    if (ok) {
      toolNames.push(call.name)
    }
  }
  return { toolMessages, toolNames, hadError }
}

const truncateLogText = (input: string, maxChars = 2000) => {
  const value = input.trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}

const sanitizeModelLogText = (input: string) => {
  return input
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/SERVICE_ACCOUNT_SECRET_KEY\s*[:=]\s*["']?[^"'\s]+/g, 'SERVICE_ACCOUNT_SECRET_KEY=[REDACTED]')
}

const formatMessageContentForLog = (content: unknown) => {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

const summarizeMessagesForLog = (messages: Array<{ role: string; content: unknown }>) => {
  return messages.map((message) => ({
    role: message.role,
    content: sanitizeModelLogText(formatMessageContentForLog(message.content))
  }))
}

const summarizeToolsForLog = (tools: unknown) => {
  if (!Array.isArray(tools)) return tools
  const names = tools
    .map((tool: any) => tool?.function?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
  return { tool_count: tools.length, tool_names: names.slice(0, 80) }
}

type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

const normalizeOpenAiUsage = (usage: any): TokenUsage | null => {
  const promptTokens = usage?.prompt_tokens
  const completionTokens = usage?.completion_tokens
  const totalTokens = usage?.total_tokens
  if ([promptTokens, completionTokens, totalTokens].some((value) => typeof value !== 'number')) return null
  return { promptTokens, completionTokens, totalTokens }
}

const normalizeAnthropicUsage = (usage: any): TokenUsage | null => {
  const promptTokens = usage?.input_tokens
  const completionTokens = usage?.output_tokens
  if ([promptTokens, completionTokens].some((value) => typeof value !== 'number')) return null
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
}

const mergeTokenUsage = (target: TokenUsage, usage: TokenUsage) => {
  target.promptTokens += usage.promptTokens
  target.completionTokens += usage.completionTokens
  target.totalTokens += usage.totalTokens
}

const logModelResponse = (params: { protocol: string; modelId: string; response: string }) => {
  const safe = truncateLogText(sanitizeModelLogText(params.response))
  console.info(
    'model_response',
    JSON.stringify(
      {
        protocol: params.protocol,
        modelId: params.modelId,
        response: safe
      },
      null,
      2
    )
  )
}

const logModelRequest = (params: {
  protocol: string
  modelId: string
  endpoint: string
  payload: Record<string, unknown>
}) => {
  const payload = { ...params.payload }
  const rawMessages = payload.messages
  if (Array.isArray(rawMessages)) {
    payload.messages = summarizeMessagesForLog(rawMessages as Array<{ role: string; content: string }>)
  }
  if (typeof payload.system === 'string') {
    payload.system = truncateLogText(sanitizeModelLogText(payload.system))
  }
  if (payload.tools !== undefined) {
    payload.tools = summarizeToolsForLog(payload.tools)
  }
  console.info(
    'model_request',
    JSON.stringify(
      {
        protocol: params.protocol,
        modelId: params.modelId,
        endpoint: params.endpoint,
        payload
      },
      null,
      2
    )
  )
}

const callOpenAiCompatible = async (
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  options?: { temperature?: number; maxTokens?: number },
  requestExtras?: Record<string, unknown>,
  onUsage?: (usage: TokenUsage) => void
) => {
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'chat/completions')
  const { controller, timeoutMs, cleanup } = createRequestTimeout(signal)

  try {
    const payload: Record<string, unknown> = {
      model: model.model,
      messages,
      temperature: options?.temperature ?? 0.7
    }
    if (options?.maxTokens) {
      payload.max_tokens = options.maxTokens
    }
    if (requestExtras) {
      Object.assign(payload, requestExtras)
    }
    logModelRequest({ protocol: model.protocol, modelId: model.id, endpoint, payload })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`OpenAI-compatible error: ${res.status} ${errorText}`)
    }

    const data = await res.json()
    const usage = normalizeOpenAiUsage(data?.usage)
    if (usage && onUsage) {
      onUsage(usage)
    }
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      console.warn('openai compatible empty content', { model: model.id })
      return ''
    }
    logModelResponse({ protocol: model.protocol, modelId: model.id, response: content as string })
    return content as string
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('openai request timeout', { timeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    cleanup()
  }
}

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: unknown
}

const callOpenAiCompatibleWithMeta = async (
  messages: OpenAiMessage[],
  model: ModelConfig,
  signal: AbortSignal | undefined,
  requestExtras?: Record<string, unknown>,
  onUsage?: (usage: TokenUsage) => void
) => {
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'chat/completions')
  const { controller, timeoutMs, cleanup } = createRequestTimeout(signal)

  try {
    const payload: Record<string, unknown> = {
      model: model.model,
      messages,
      temperature: 0.7
    }
    if (requestExtras) {
      Object.assign(payload, requestExtras)
    }
    logModelRequest({ protocol: model.protocol, modelId: model.id, endpoint, payload })

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`OpenAI-compatible error: ${res.status} ${errorText}`)
    }

    const data = await res.json()
    const usage = normalizeOpenAiUsage(data?.usage)
    if (usage && onUsage) {
      onUsage(usage)
    }
    const content = data?.choices?.[0]?.message?.content
    const toolCalls = data?.choices?.[0]?.message?.tool_calls ?? []
    const tools: string[] = Array.isArray(toolCalls)
      ? toolCalls
          .map((call: any) => call?.function?.name)
          .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
      : []
    const parsedToolCalls = Array.isArray(toolCalls)
      ? toolCalls
          .map((call: any) => ({
            id: call?.id,
            name: call?.function?.name,
            arguments: call?.function?.arguments
          }))
          .filter((call: any) => typeof call?.name === 'string' && call.name.length > 0 && call.id)
      : []
    if (!content && parsedToolCalls.length === 0) {
      console.warn('openai compatible empty content', { model: model.id })
    }
    if (content) {
      logModelResponse({ protocol: model.protocol, modelId: model.id, response: content as string })
    }
    return { content: (content ?? '') as string, tools, toolCalls: parsedToolCalls }
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('openai request timeout', { timeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    cleanup()
  }
}

const callOpenAiCompatibleStream = async function* (
  messages: OpenAiMessage[],
  model: ModelConfig,
  signal?: AbortSignal,
  requestExtras?: Record<string, unknown>,
  onUsage?: (usage: TokenUsage) => void
) {
  const streamLogEnabled = process.env.VIBE_FISHING_STREAM_LOG === 'true'
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'chat/completions')
  const requestTimeoutMs = parseChatRequestTimeoutMs()
  const idleTimeoutMs = parseChatStreamIdleTimeoutMs()
  const controller = new AbortController()
  let overallTimeout: NodeJS.Timeout | null = setTimeout(() => controller.abort(), requestTimeoutMs)
  let idleTimeout: NodeJS.Timeout | null = setTimeout(() => controller.abort(), idleTimeoutMs)

  const resetIdleTimeout = () => {
    if (!idleTimeout) return
    clearTimeout(idleTimeout)
    idleTimeout = setTimeout(() => controller.abort(), idleTimeoutMs)
  }

  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const payload: Record<string, unknown> = {
      model: model.model,
      messages,
      temperature: 0.7,
      stream: true
    }
    payload.stream_options = { include_usage: true }
    if (requestExtras) {
      Object.assign(payload, requestExtras)
    }
    logModelRequest({ protocol: model.protocol, modelId: model.id, endpoint, payload })

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`OpenAI-compatible error: ${res.status} ${errorText}`)
    }

    if (!res.body) {
      throw new Error('OpenAI-compatible streaming response missing body')
    }

    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      resetIdleTimeout()
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') return

        let json: any = null
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const usage = normalizeOpenAiUsage(json?.usage)
        if (usage && onUsage) {
          onUsage(usage)
        }
        const delta = json?.choices?.[0]?.delta?.content
        const reasoning = json?.choices?.[0]?.delta?.reasoning_content
        const thinking = json?.choices?.[0]?.delta?.thinking
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          if (streamLogEnabled) {
            const preview = reasoning.length > 200 ? `${reasoning.slice(0, 200)}…` : reasoning
          }
          yield { type: 'reasoning', value: reasoning }
          continue
        }
        if (typeof thinking === 'string' && thinking.length > 0) {
          if (streamLogEnabled) {
            const preview = thinking.length > 200 ? `${thinking.slice(0, 200)}…` : thinking
          }
          yield { type: 'reasoning', value: thinking }
          continue
        }
        if (typeof delta === 'string' && delta.length > 0) {
          if (streamLogEnabled) {
            const preview = delta.length > 200 ? `${delta.slice(0, 200)}…` : delta
          }
          yield { type: 'content', value: delta }
        }
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('openai request timeout', { requestTimeoutMs, idleTimeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    if (overallTimeout) clearTimeout(overallTimeout)
    if (idleTimeout) clearTimeout(idleTimeout)
  }
}

const callOpenAiCompatibleStreamWithMeta = async (
  messages: OpenAiMessage[],
  model: ModelConfig,
  signal: AbortSignal | undefined,
  requestExtras?: Record<string, unknown>,
  onChunk?: (chunk: { type: 'reasoning' | 'content'; value: string }) => void,
  onUsage?: (usage: TokenUsage) => void,
  onToolCallDelta?: (data: { index: number; id?: string; name?: string; arguments?: string; argumentsDelta?: string }) => void
) => {
  const streamLogEnabled = process.env.VIBE_FISHING_STREAM_LOG === 'true'
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'chat/completions')
  const requestTimeoutMs = parseChatRequestTimeoutMs()
  const idleTimeoutMs = parseChatStreamIdleTimeoutMs()
  const controller = new AbortController()
  let overallTimeout: NodeJS.Timeout | null = setTimeout(() => controller.abort(), requestTimeoutMs)
  let idleTimeout: NodeJS.Timeout | null = setTimeout(() => controller.abort(), idleTimeoutMs)

  const resetIdleTimeout = () => {
    if (!idleTimeout) return
    clearTimeout(idleTimeout)
    idleTimeout = setTimeout(() => controller.abort(), idleTimeoutMs)
  }

  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const payload: Record<string, unknown> = {
      model: model.model,
      messages,
      temperature: 0.7,
      stream: true
    }
    payload.stream_options = { include_usage: true }
    if (requestExtras) {
      Object.assign(payload, requestExtras)
    }
    logModelRequest({ protocol: model.protocol, modelId: model.id, endpoint, payload })

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`OpenAI-compatible error: ${res.status} ${errorText}`)
    }

    if (!res.body) {
      throw new Error('OpenAI-compatible streaming response missing body')
    }

    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''
    let content = ''
    const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      resetIdleTimeout()
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        if (raw === '[DONE]') {
          const toolCalls = Array.from(toolCallsByIndex.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, call]) => call)
            .filter((call) => call.id && call.name)
          const tools = Array.from(new Set(toolCalls.map((call) => call.name))).filter(Boolean)
          if (content) {
            logModelResponse({ protocol: model.protocol, modelId: model.id, response: content })
          }
          return { content, tools, toolCalls }
        }

        let json: any = null
        try {
          json = JSON.parse(raw)
        } catch {
          continue
        }
        const usage = normalizeOpenAiUsage(json?.usage)
        if (usage && onUsage) {
          onUsage(usage)
        }

        const deltaToolCalls = json?.choices?.[0]?.delta?.tool_calls
        if (Array.isArray(deltaToolCalls)) {
          for (const callDelta of deltaToolCalls) {
            const index = typeof callDelta?.index === 'number' ? callDelta.index : 0
            const existing = toolCallsByIndex.get(index) ?? { id: '', name: '', arguments: '' }
            const next = { ...existing }
            if (typeof callDelta?.id === 'string' && callDelta.id) next.id = callDelta.id
            const fn = callDelta?.function
            if (typeof fn?.name === 'string' && fn.name) next.name = fn.name
            let argumentsDelta = ''
            if (typeof fn?.arguments === 'string' && fn.arguments) {
              argumentsDelta = fn.arguments
              next.arguments += fn.arguments
            }
            toolCallsByIndex.set(index, next)
            if (onToolCallDelta) {
              const safeArgs = next.arguments ? truncateToolText(sanitizeToolText(next.arguments), 800) : undefined
              const safeDelta = argumentsDelta ? truncateToolText(sanitizeToolText(argumentsDelta), 240) : undefined
              onToolCallDelta({
                index,
                id: next.id || undefined,
                name: next.name || undefined,
                arguments: safeArgs,
                argumentsDelta: safeDelta
              })
            }
          }
        }

        const delta = json?.choices?.[0]?.delta?.content
        const reasoning = json?.choices?.[0]?.delta?.reasoning_content
        const thinking = json?.choices?.[0]?.delta?.thinking
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          if (streamLogEnabled) {
            const preview = reasoning.length > 200 ? `${reasoning.slice(0, 200)}…` : reasoning
            void preview
          }
          onChunk?.({ type: 'reasoning', value: reasoning })
          continue
        }
        if (typeof thinking === 'string' && thinking.length > 0) {
          if (streamLogEnabled) {
            const preview = thinking.length > 200 ? `${thinking.slice(0, 200)}…` : thinking
            void preview
          }
          onChunk?.({ type: 'reasoning', value: thinking })
          continue
        }
        if (typeof delta === 'string' && delta.length > 0) {
          if (streamLogEnabled) {
            const preview = delta.length > 200 ? `${delta.slice(0, 200)}…` : delta
            void preview
          }
          content += delta
          onChunk?.({ type: 'content', value: delta })
        }
      }
    }

    const toolCalls = Array.from(toolCallsByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => call.id && call.name)
    const tools = Array.from(new Set(toolCalls.map((call) => call.name))).filter(Boolean)
    if (content) {
      logModelResponse({ protocol: model.protocol, modelId: model.id, response: content })
    }
    return { content, tools, toolCalls }
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('openai request timeout', { requestTimeoutMs, idleTimeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    if (overallTimeout) clearTimeout(overallTimeout)
    if (idleTimeout) clearTimeout(idleTimeout)
  }
}

const callOpenAiWithMcp = async (
  messages: OpenAiMessage[],
  model: ModelConfig,
  requestExtras: Record<string, unknown> | undefined,
  toolset: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null,
  context?: ToolExecutionContext
) => {
  if (!toolset || toolset.tools.length === 0) {
    const result = await callOpenAiCompatibleStreamWithMeta(
      messages,
      model,
      context?.signal,
      requestExtras,
      undefined,
      context?.onUsage
    )
    return { content: result.content, tools: result.tools }
  }
  let currentMessages: OpenAiMessage[] = [...messages]
  const collectedTools: string[] = []
  const maxRounds = 20
  for (let round = 0; round < maxRounds; round += 1) {
    const toolPayload = { ...(requestExtras ?? {}), tools: toolset.tools, tool_choice: 'auto' }
    const step = await callOpenAiCompatibleStreamWithMeta(
      currentMessages,
      model,
      context?.signal,
      toolPayload,
      undefined,
      context?.onUsage
    )
    collectedTools.push(...(step.tools ?? []))
    if (!step.toolCalls.length) {
      return { content: step.content, tools: collectedTools }
    }
    const { toolMessages, toolNames, hadError } = await executeMcpToolCalls(
      step.toolCalls,
      toolset,
      context?.onToolEvent,
      context
    )
    collectedTools.push(...toolNames)
    const toolCallsPayload = step.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {})
      }
    }))
    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: toolCallsPayload
      },
      ...toolMessages
    ]
    if (hadError && round < maxRounds - 1) {
      const canInject = context ? !context.toolErrorRecoveryInjected : true
      if (canInject) {
        if (context) context.toolErrorRecoveryInjected = true
        currentMessages = [
          ...currentMessages,
          {
            role: 'user',
            content:
              '工具调用失败或未支持：请先向用户说明错误，然后尝试替代方案（修正参数重试/换可用工具/必要时不用工具继续）。'
          }
        ]
      }
    }
  }
  const final = await callOpenAiCompatibleStreamWithMeta(
    currentMessages,
    model,
    context?.signal,
    {
      ...(requestExtras ?? {}),
      tools: toolset.tools,
      tool_choice: 'none'
    },
    undefined,
    context?.onUsage
  )
  collectedTools.push(...(final.tools ?? []))
  return { content: final.content, tools: collectedTools }
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicToolDefinition = {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

const toAnthropicTools = (tools: OpenAiToolDefinition[]) => {
  const output: AnthropicToolDefinition[] = []
  for (const tool of tools) {
    const name = tool?.function?.name
    if (!name) continue
    const inputSchema = tool?.function?.parameters
    if (!inputSchema || typeof inputSchema !== 'object') continue
    output.push({
      name,
      description: tool?.function?.description,
      input_schema: inputSchema as Record<string, unknown>
    })
  }
  return output
}

const detectToolErrorResult = (raw: string) => {
  const text = raw.trim()
  if (!text) return false
  try {
    const parsed = JSON.parse(text)
    return typeof parsed?.error === 'string' && parsed.error.length > 0
  } catch {
    return false
  }
}

const callAnthropicStreamWithToolMeta = async (
  messages: AnthropicMessage[],
  system: string | undefined,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  tools: AnthropicToolDefinition[] | undefined,
  onTextDelta?: (delta: string) => void,
  onUsage?: (usage: TokenUsage) => void,
  maxTokens?: number
) => {
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.anthropic.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'messages')
  const { controller, timeoutMs, cleanup } = createRequestTimeout(signal)

  try {
    const payload: Record<string, unknown> = {
      model: model.model,
      max_tokens: maxTokens ?? 1024,
      system,
      messages,
      stream: true
    }
    if (tools && tools.length > 0) {
      payload.tools = tools
    }
    logModelRequest({ protocol: model.protocol, modelId: model.id, endpoint, payload })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic error: ${res.status} ${errorText}`)
    }

    if (!res.body) {
      throw new Error('Anthropic streaming response missing body')
    }

    type StreamBlock =
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; inputJson: string }

    const blocksByIndex: Array<StreamBlock | null> = []
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''
    let stopped = false

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue

        let json: any = null
        try {
          json = JSON.parse(raw)
        } catch {
          continue
        }

        const usage = normalizeAnthropicUsage(json?.usage ?? json?.message?.usage)
        if (usage && onUsage) {
          onUsage(usage)
        }

        const type = json?.type
        if (type === 'content_block_start') {
          const index = typeof json?.index === 'number' ? json.index : 0
          const block = json?.content_block
          if (block?.type === 'text') {
            blocksByIndex[index] = { type: 'text', text: typeof block?.text === 'string' ? block.text : '' }
          } else if (block?.type === 'tool_use') {
            const id = typeof block?.id === 'string' ? block.id : ''
            const name = typeof block?.name === 'string' ? block.name : ''
            let inputJson = ''
            if (block?.input && typeof block.input === 'object') {
              try {
                inputJson = JSON.stringify(block.input)
              } catch {
                inputJson = ''
              }
            }
            blocksByIndex[index] = { type: 'tool_use', id, name, inputJson }
          }
          continue
        }

        if (type === 'content_block_delta') {
          const index = typeof json?.index === 'number' ? json.index : 0
          const existing = blocksByIndex[index]
          const delta = json?.delta
          if (!existing || !delta) continue
          if (existing.type === 'text' && delta?.type === 'text_delta' && typeof delta?.text === 'string') {
            existing.text += delta.text
            onTextDelta?.(delta.text)
          } else if (
            existing.type === 'tool_use' &&
            delta?.type === 'input_json_delta' &&
            typeof delta?.partial_json === 'string'
          ) {
            existing.inputJson += delta.partial_json
          }
          continue
        }

        if (type === 'message_stop') {
          stopped = true
          break
        }
      }
      if (stopped) break
    }

    const blocks: AnthropicContentBlock[] = []
    for (const block of blocksByIndex) {
      if (!block) continue
      if (block.type === 'text') {
        blocks.push({ type: 'text', text: block.text })
        continue
      }
      let input: Record<string, unknown> = {}
      const trimmed = block.inputJson.trim()
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed && typeof parsed === 'object') {
            input = parsed as Record<string, unknown>
          }
        } catch {
          input = {}
        }
      }
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input })
    }

    const textParts = blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as Extract<AnthropicContentBlock, { type: 'text' }>).text)
    const text = textParts.join('')
    const toolUses = blocks.filter((b) => b.type === 'tool_use' && (b as any)?.id && (b as any)?.name)
    if (text) {
      logModelResponse({ protocol: model.protocol, modelId: model.id, response: text })
    }
    const toolsUsed: string[] = toolUses
      .map((b: any) => b?.name)
      .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
    return { blocks, text, toolUses: toolUses as Array<Extract<AnthropicContentBlock, { type: 'tool_use' }>>, tools: toolsUsed }
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('anthropic request timeout', { timeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    cleanup()
  }
}

const callAnthropicWithToolMeta = async (
  messages: AnthropicMessage[],
  system: string | undefined,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  tools: AnthropicToolDefinition[] | undefined,
  onUsage?: (usage: TokenUsage) => void
) => {
  return callAnthropicStreamWithToolMeta(messages, system, model, signal, tools, undefined, onUsage)
}

const streamAnthropicWithMcp = async (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string | undefined,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  toolset: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null,
  onTextDelta: (delta: string) => void,
  context?: ToolExecutionContext
) => {
  if (!toolset || toolset.tools.length === 0) {
    const result = await callAnthropicStreamWithToolMeta(
      messages.map((m) => ({ role: m.role, content: m.content })),
      system,
      model,
      signal,
      undefined,
      onTextDelta,
      context?.onUsage
    )
    return { tools: result.tools ?? [] }
  }

  const anthropicTools = toAnthropicTools(toolset.tools)
  let currentMessages: AnthropicMessage[] = messages.map((m) => ({ role: m.role, content: m.content }))
  const collectedTools: string[] = []
  const maxRounds = 20

  for (let round = 0; round < maxRounds; round += 1) {
    const step = await callAnthropicStreamWithToolMeta(
      currentMessages,
      system,
      model,
      signal,
      anthropicTools,
      onTextDelta,
      context?.onUsage
    )
    collectedTools.push(...(step.tools ?? []))
    if (!step.toolUses.length) {
      return { tools: collectedTools }
    }
    const toolCalls = step.toolUses.map((toolUse) => ({
      id: toolUse.id,
      name: toolUse.name,
      arguments: toolUse.input
    }))
    const { toolMessages, toolNames, hadError } = await executeMcpToolCalls(
      toolCalls,
      toolset,
      context?.onToolEvent,
      context
    )
    collectedTools.push(...toolNames)
    const resultBlocks: AnthropicContentBlock[] = toolMessages.map((toolMessage) => ({
      type: 'tool_result',
      tool_use_id: toolMessage.tool_call_id ?? '',
      content: toolMessage.content,
      is_error: detectToolErrorResult(toolMessage.content)
    }))
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: step.blocks },
      { role: 'user', content: resultBlocks }
    ]
    if (hadError && round < maxRounds - 1) {
      const canInject = context ? !context.toolErrorRecoveryInjected : true
      if (canInject) {
        if (context) context.toolErrorRecoveryInjected = true
        currentMessages = [
          ...currentMessages,
          {
            role: 'user',
            content: '工具调用失败或未支持：请先向用户说明错误，然后尝试替代方案（修正参数重试/换可用工具/必要时不用工具继续）。'
          }
        ]
      }
    }
  }

  const final = await callAnthropicStreamWithToolMeta(
    currentMessages,
    system,
    model,
    signal,
    anthropicTools,
    onTextDelta,
    context?.onUsage
  )
  collectedTools.push(...(final.tools ?? []))
  return { tools: collectedTools }
}

const callAnthropicWithMcp = async (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string | undefined,
  model: ModelConfig,
  requestExtras: Record<string, unknown> | undefined,
  toolset: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null,
  context?: ToolExecutionContext
) => {
  if (requestExtras) {
    void requestExtras
  }
  if (!toolset || toolset.tools.length === 0) {
    const result = await callAnthropicWithToolMeta(
      messages.map((m) => ({ role: m.role, content: m.content })),
      system,
      model,
      context?.signal,
      undefined,
      context?.onUsage
    )
    return { content: result.text, tools: result.tools }
  }

  const anthropicTools = toAnthropicTools(toolset.tools)
  let currentMessages: AnthropicMessage[] = messages.map((m) => ({ role: m.role, content: m.content }))
  const collectedTools: string[] = []
  const maxRounds = 20

  for (let round = 0; round < maxRounds; round += 1) {
    const step = await callAnthropicWithToolMeta(
      currentMessages,
      system,
      model,
      context?.signal,
      anthropicTools,
      context?.onUsage
    )
    collectedTools.push(...(step.tools ?? []))
    if (!step.toolUses.length) {
      return { content: step.text, tools: collectedTools }
    }

    const toolCalls = step.toolUses.map((toolUse) => ({
      id: toolUse.id,
      name: toolUse.name,
      arguments: toolUse.input
    }))
    const { toolMessages, toolNames, hadError } = await executeMcpToolCalls(
      toolCalls,
      toolset,
      context?.onToolEvent,
      context
    )
    collectedTools.push(...toolNames)

    const resultBlocks: AnthropicContentBlock[] = toolMessages.map((toolMessage) => ({
      type: 'tool_result',
      tool_use_id: toolMessage.tool_call_id ?? '',
      content: toolMessage.content,
      is_error: detectToolErrorResult(toolMessage.content)
    }))

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: step.blocks },
      { role: 'user', content: resultBlocks }
    ]

    if (hadError && round < maxRounds - 1) {
      const canInject = context ? !context.toolErrorRecoveryInjected : true
      if (canInject) {
        if (context) context.toolErrorRecoveryInjected = true
        currentMessages = [
          ...currentMessages,
          {
            role: 'user',
            content: '工具调用失败或未支持：请先向用户说明错误，然后尝试替代方案（修正参数重试/换可用工具/必要时不用工具继续）。'
          }
        ]
      }
    }
  }

  const final = await callAnthropicWithToolMeta(
    currentMessages,
    system,
    model,
    context?.signal,
    anthropicTools,
    context?.onUsage
  )
  collectedTools.push(...(final.tools ?? []))
  return { content: final.text, tools: collectedTools }
}

const streamOpenAiWithMcp = async (
  messages: OpenAiMessage[],
  model: ModelConfig,
  signal: AbortSignal | undefined,
  requestExtras: Record<string, unknown> | undefined,
  toolset: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null,
  onChunk: (chunk: { type: 'reasoning' | 'content'; value: string }) => void,
  onToolEvent?: (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => void,
  context?: ToolExecutionContext
) => {
  if (!toolset || toolset.tools.length === 0) {
    for await (const chunk of callOpenAiCompatibleStream(messages, model, signal, requestExtras, context?.onUsage)) {
      onChunk(chunk as { type: 'reasoning' | 'content'; value: string })
    }
    return { tools: [] as string[] }
  }
  let currentMessages: OpenAiMessage[] = [...messages]
  const maxRounds = 20
  const collectedTools: string[] = []
  for (let round = 0; round < maxRounds; round += 1) {
    const toolPayload = { ...(requestExtras ?? {}), tools: toolset.tools, tool_choice: 'auto' }
    const step = await callOpenAiCompatibleStreamWithMeta(
      currentMessages,
      model,
      signal,
      toolPayload,
      onChunk,
      context?.onUsage,
      context?.send
        ? (data) => {
            context.send?.('tool_call_delta', data)
          }
        : undefined
    )
    collectedTools.push(...(step.tools ?? []))
    if (!step.toolCalls.length) {
      return { tools: collectedTools }
    }
    const { toolMessages, toolNames, hadError } = await executeMcpToolCalls(step.toolCalls, toolset, onToolEvent, context)
    collectedTools.push(...toolNames)
    const toolCallsPayload = step.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {})
      }
    }))
    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: toolCallsPayload
      },
      ...toolMessages
    ]
    if (hadError && round < maxRounds - 1) {
      const canInject = context ? !context.toolErrorRecoveryInjected : true
      if (canInject) {
        if (context) context.toolErrorRecoveryInjected = true
        currentMessages = [
          ...currentMessages,
          {
            role: 'user',
            content:
              '工具调用失败或未支持：请先向用户说明错误，然后尝试替代方案（修正参数重试/换可用工具/必要时不用工具继续）。'
          }
        ]
      }
    }
  }
  for await (const chunk of callOpenAiCompatibleStream(
    currentMessages,
    model,
    signal,
    {
      ...(requestExtras ?? {}),
      tools: toolset.tools,
      tool_choice: 'none'
    },
    context?.onUsage
  )) {
    onChunk(chunk as { type: 'reasoning' | 'content'; value: string })
  }
  return { tools: collectedTools }
}

const callAnthropic = async (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string | undefined,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  options?: { maxTokens?: number },
  onUsage?: (usage: TokenUsage) => void
) => {
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.anthropic.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'messages')
  const { controller, timeoutMs, cleanup } = createRequestTimeout(signal)

  try {
    logModelRequest({
      protocol: model.protocol,
      modelId: model.id,
      endpoint,
      payload: {
        model: model.model,
        max_tokens: options?.maxTokens ?? 1024,
        system,
        messages
      }
    })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: options?.maxTokens ?? 1024,
        system,
        messages
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic error: ${res.status} ${errorText}`)
    }

    const data = await res.json()
    const content = data?.content?.[0]?.text
    if (!content) {
      throw new Error('Anthropic response missing content')
    }
    const usage = normalizeAnthropicUsage(data?.usage)
    if (usage && onUsage) {
      onUsage(usage)
    }
    logModelResponse({ protocol: model.protocol, modelId: model.id, response: content as string })
    return content as string
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('anthropic request timeout', { timeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    cleanup()
  }
}

const callAnthropicWithMeta = async (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string | undefined,
  model: ModelConfig,
  signal: AbortSignal | undefined,
  onUsage?: (usage: TokenUsage) => void
) => {
  const apiKey = getApiKey(model)
  const baseUrl = model.baseUrl ?? 'https://api.anthropic.com/v1'
  const endpoint = buildEndpoint(baseUrl, 'messages')
  const { controller, timeoutMs, cleanup } = createRequestTimeout(signal)

  try {
    logModelRequest({
      protocol: model.protocol,
      modelId: model.id,
      endpoint,
      payload: {
        model: model.model,
        max_tokens: 1024,
        system,
        messages
      }
    })
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: 1024,
        system,
        messages
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic error: ${res.status} ${errorText}`)
    }

    const data = await res.json()
    const blocks = Array.isArray(data?.content) ? data.content : []
    const text = blocks.find((b: any) => b?.type === 'text')?.text
    if (!text) {
      throw new Error('Anthropic response missing content')
    }
    const usage = normalizeAnthropicUsage(data?.usage)
    if (usage && onUsage) {
      onUsage(usage)
    }
    const tools: string[] = Array.isArray(data?.tool_calls)
      ? data.tool_calls
          .map((call: any) => call?.name)
          .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
      : []
    logModelResponse({ protocol: model.protocol, modelId: model.id, response: text as string })
    return { content: text as string, tools }
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('anthropic request timeout', { timeoutMs })
      throw createUpstreamTimeoutError()
    }
    throw error
  } finally {
    cleanup()
  }
}

const summarizeConversation = async (
  model: ModelConfig,
  existingSummary: string | null,
  messages: Array<{ role: string; content: string }>,
  onUsage?: (usage: TokenUsage) => void
) => {
  const prompt = 'You are a summarization assistant. Summarize the conversation to preserve important facts, decisions, and user preferences. Keep it concise.'
  const input = buildSummaryInput(existingSummary, messages)
  if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
    const summary = await callOpenAiCompatibleStreamWithMeta(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: input }
      ],
      model,
      undefined,
      { temperature: 0.2, max_tokens: 512 },
      undefined,
      onUsage
    )
    return summary.content.trim()
  }
  const summary = await callAnthropicStreamWithToolMeta(
    [{ role: 'user', content: input }],
    prompt,
    model,
    undefined,
    undefined,
    undefined,
    onUsage,
    512
  )
  return summary.text.trim()
}

const generateThinkingSummary = async (
  model: ModelConfig,
  userMessage: string,
  assistantMessage: string,
  onUsage?: (usage: TokenUsage) => void
) => {
  const prompt = 'Provide a brief reasoning summary in 2-4 bullet points. Do not reveal chain-of-thought. Focus on high-level approach.'
  const input = `User:\n${userMessage}\n\nAssistant:\n${assistantMessage}`
  if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
    const summary = await callOpenAiCompatibleStreamWithMeta(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: input }
      ],
      model,
      undefined,
      { temperature: 0.2, max_tokens: 256 },
      undefined,
      onUsage
    )
    return summary.content.trim()
  }
  const summary = await callAnthropicStreamWithToolMeta(
    [{ role: 'user', content: input }],
    prompt,
    model,
    undefined,
    undefined,
    undefined,
    onUsage,
    256
  )
  return summary.text.trim()
}

const parseSkillCommand = (message: string) => {
  const match = message.trim().match(/^\/skill\s+(\S+)\s*(.*)$/)
  if (!match) return null
  const skillId = match[1]
  const content = match[2] || ''
  return { skillId, content }
}

const parseMultiAgentCommand = (message: string) => {
  const match = message.trim().match(/^\/multi\s+([\s\S]+)$/)
  if (!match) return null
  return { content: match[1].trim() }
}

const parseArtifactCommand = (_message: string): { fileName?: string; content: string } | null => {
  return null
}

const buildContextBlock = (messages: Array<{ role: string; content: string }>) => {
  if (messages.length === 0) return ''
  return messages.map((entry) => `${entry.role}: ${entry.content}`).join('\n')
}

const getThinkingRequestExtras = (model: ModelConfig) => {
  if (!model.supportsThinking || !model.whenThinkingEnabled) return undefined
  return model.whenThinkingEnabled
}

const resolveModeFlags = (mode: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing' | undefined) => {
  const isPro = mode === 'pro' || mode === 'ultra'
  const thinkingEnabled = mode !== 'flash'
  return { isPro, thinkingEnabled }
}

const maybeBuildPlan = async (
  model: ModelConfig,
  message: string,
  contextBlock: string,
  systemText: string | undefined,
  thinkingEnabled: boolean,
  meta?: { threadId?: string },
  signal?: AbortSignal,
  onUsage?: (usage: TokenUsage) => void
) => {
  if (!thinkingEnabled) return null
  const plannerPrompt = 'You are Planner. Produce a concise plan with 3-5 steps. Use bullet points.'
  const plannerInput = `User Request:\n${message}\n\nContext:\n${contextBlock}`
  const requestExtras = getThinkingRequestExtras(model)
  return runAgentStep(
    model,
    plannerPrompt,
    plannerInput,
    signal,
    systemText,
    requestExtras,
    { agentName: 'planner', threadId: meta?.threadId },
    onUsage
  )
}

const runAgentStep = async (
  model: ModelConfig,
  rolePrompt: string,
  input: string,
  signal: AbortSignal | undefined,
  systemText?: string,
  requestExtras?: Record<string, unknown>,
  meta?: { agentName?: string; threadId?: string },
  onUsage?: (usage: TokenUsage) => void
) => {
  if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    const systemContent = systemText ? `${systemText}\n\n${rolePrompt}` : rolePrompt
    messages.push({ role: 'system', content: systemContent })
    messages.push({ role: 'user', content: input })
    return callOpenAiCompatibleStreamWithMeta(messages, model, signal, requestExtras, undefined, onUsage)
  }
  const systemContent = systemText ? `${systemText}\n\n${rolePrompt}` : rolePrompt
  const result = await callAnthropicWithToolMeta(
    [{ role: 'user', content: input }],
    systemContent,
    model,
    signal,
    undefined,
    onUsage
  )
  return { content: result.text, tools: result.tools }
}

const runAgentStepStreaming = async (
  model: ModelConfig,
  rolePrompt: string,
  input: string,
  signal: AbortSignal | undefined,
  onDelta: (delta: string) => void,
  systemText?: string,
  requestExtras?: Record<string, unknown>,
  meta?: { agentName?: string; threadId?: string },
  onReasoning?: (delta: string) => void,
  onUsage?: (usage: TokenUsage) => void
) => {
  if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    const systemContent = systemText ? `${systemText}\n\n${rolePrompt}` : rolePrompt
    messages.push({ role: 'system', content: systemContent })
    messages.push({ role: 'user', content: input })
    let content = ''
    for await (const chunk of callOpenAiCompatibleStream(messages, model, signal, requestExtras, onUsage)) {
      if (chunk.type === 'reasoning') {
        if (onReasoning && typeof chunk.value === 'string' && chunk.value.length > 0) {
          onReasoning(chunk.value)
        }
        continue
      }
      const delta = chunk.value
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta
        onDelta(delta)
      }
    }
    return { content, tools: [] as string[] }
  }
  const systemContent = systemText ? `${systemText}\n\n${rolePrompt}` : rolePrompt
  let content = ''
  const result = await callAnthropicStreamWithToolMeta(
    [{ role: 'user', content: input }],
    systemContent,
    model,
    signal,
    undefined,
    (delta) => {
      content += delta
      onDelta(delta)
    },
    onUsage
  )
  return { content, tools: result.tools }
}

const runMultiAgentWithLangGraph = async (params: {
  model: ModelConfig
  message: string
  contextBlock: string
  systemText?: string
  signal: AbortSignal | undefined
  openAiThinkingExtras?: Record<string, unknown>
  ultraEnabled: boolean
  mcpToolset: {
    tools: OpenAiToolDefinition[]
    toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>
    localToolMap: Map<string, LocalToolHandler>
  } | null
  threadId?: string
  send: (event: string, data: unknown) => void
  onReasoning: (delta: string) => void
  onContent: (delta: string) => void
  onToolEvent?: (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => void
  onUsage?: (usage: TokenUsage) => void
}) => {
  const {
    model,
    message,
    contextBlock,
    systemText,
    signal,
    openAiThinkingExtras,
    ultraEnabled,
    mcpToolset,
    threadId,
    send,
    onReasoning,
    onContent,
    onToolEvent,
    onUsage
  } = params

  const agents: Array<{ name: string; output: string }> = []
  const tools: string[] = []
  const toolContext: ToolExecutionContext = {
    model,
    systemText,
    threadId,
    openAiThinkingExtras,
    toolset: mcpToolset,
    onToolEvent,
    onUsage,
    signal,
    send,
    subagentCallCount: 0,
    maxSubagentCalls: 3
  }

  const GraphState = Annotation.Root({
    plannerOutput: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    }),
    researcherOutput: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    }),
    analystOutput: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    }),
    riskOutput: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    }),
    criticOutput: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    }),
    finalResponse: Annotation<string>({
      default: () => '',
      reducer: (prev, next) => (typeof next === 'string' ? next : prev)
    })
  })

  const graph = new StateGraph(GraphState) as any

  graph.addNode('planner', async () => {
    const plannerInput = `User Request:\n${message}\n\nContext:\n${contextBlock}`
    let plannerContent = ''
    let thinkingActive = false
    const start = Date.now()
    send('agent_start', { name: 'planner' })
    send('plan_start', {})
    const planner = await runAgentStepStreaming(
      model,
      PLANNER_PROMPT,
      plannerInput,
      signal,
      (delta) => {
        plannerContent += delta
        send('plan_delta', { delta })
      },
      systemText,
      openAiThinkingExtras,
      { agentName: 'planner', threadId },
      (delta) => {
        if (!thinkingActive) {
          thinkingActive = true
          send('agent_thinking_start', { name: 'planner' })
        }
        send('agent_thinking_delta', { name: 'planner', delta })
      },
      onUsage
    )
    send('plan_end', {})
    if (thinkingActive) {
      send('agent_thinking_end', { name: 'planner' })
    }
    const output = plannerContent || planner.content
    agents.push({ name: 'planner', output })
    send('agent', { name: 'planner', output })
    send('agent_end', { name: 'planner', durationMs: Date.now() - start })
    return { plannerOutput: output }
  })

  graph.addNode('researcher', async (state: any) => {
    const plannerOutput = state.plannerOutput || ''
    const researcherInput = `Plan:\n${plannerOutput}\n\nUser Request:\n${message}\n\nContext:\n${contextBlock}`
    let researcherContent = ''
    let thinkingActive = false
    const start = Date.now()
    send('agent_start', { name: 'researcher' })
    send('research_start', {})
    const researcher = await runAgentStepStreaming(
      model,
      RESEARCHER_PROMPT,
      researcherInput,
      signal,
      (delta) => {
        researcherContent += delta
        send('research_delta', { delta })
      },
      systemText,
      openAiThinkingExtras,
      { agentName: 'researcher', threadId },
      (delta) => {
        if (!thinkingActive) {
          thinkingActive = true
          send('agent_thinking_start', { name: 'researcher' })
        }
        send('agent_thinking_delta', { name: 'researcher', delta })
      },
      onUsage
    )
    send('research_end', {})
    if (thinkingActive) {
      send('agent_thinking_end', { name: 'researcher' })
    }
    const output = researcherContent || researcher.content
    agents.push({ name: 'researcher', output })
    send('agent', { name: 'researcher', output })
    send('agent_end', { name: 'researcher', durationMs: Date.now() - start })
    return { researcherOutput: output }
  })

  if (ultraEnabled) {
    graph.addNode('analyst', async (state: any) => {
      const plannerOutput = state.plannerOutput || ''
      const researcherOutput = state.researcherOutput || ''
      const analystInput = `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nUser Request:\n${message}`
      let analystContent = ''
      let thinkingActive = false
      const start = Date.now()
      send('agent_start', { name: 'analyst' })
      const analyst = await runAgentStepStreaming(
        model,
        ANALYST_PROMPT,
        analystInput,
        signal,
        (delta) => {
          analystContent += delta
          send('agent_delta', { name: 'analyst', delta })
        },
        systemText,
        openAiThinkingExtras,
        { agentName: 'analyst', threadId },
        (delta) => {
          if (!thinkingActive) {
            thinkingActive = true
            send('agent_thinking_start', { name: 'analyst' })
          }
          send('agent_thinking_delta', { name: 'analyst', delta })
      },
      onUsage
      )
      if (thinkingActive) {
        send('agent_thinking_end', { name: 'analyst' })
      }
      const output = analystContent || analyst.content
      agents.push({ name: 'analyst', output })
      send('agent', { name: 'analyst', output })
      send('agent_end', { name: 'analyst', durationMs: Date.now() - start })
      return { analystOutput: output }
    })

    graph.addNode('risk', async (state: any) => {
      const plannerOutput = state.plannerOutput || ''
      const researcherOutput = state.researcherOutput || ''
      const riskInput = `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nUser Request:\n${message}`
      let riskContent = ''
      let thinkingActive = false
      const start = Date.now()
      send('agent_start', { name: 'risk' })
      const risk = await runAgentStepStreaming(
        model,
        RISK_PROMPT,
        riskInput,
        signal,
        (delta) => {
          riskContent += delta
          send('agent_delta', { name: 'risk', delta })
        },
        systemText,
        openAiThinkingExtras,
        { agentName: 'risk', threadId },
        (delta) => {
          if (!thinkingActive) {
            thinkingActive = true
            send('agent_thinking_start', { name: 'risk' })
          }
          send('agent_thinking_delta', { name: 'risk', delta })
      },
      onUsage
      )
      if (thinkingActive) {
        send('agent_thinking_end', { name: 'risk' })
      }
      const output = riskContent || risk.content
      agents.push({ name: 'risk', output })
      send('agent', { name: 'risk', output })
      send('agent_end', { name: 'risk', durationMs: Date.now() - start })
      return { riskOutput: output }
    })

    graph.addNode('critic', async (state: any) => {
      const plannerOutput = state.plannerOutput || ''
      const researcherOutput = state.researcherOutput || ''
      const analystOutput = state.analystOutput || ''
      const riskOutput = state.riskOutput || ''
      const criticInput = `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nAnalysis:\n${analystOutput}\n\nRisks:\n${riskOutput}\n\nUser Request:\n${message}`
      let criticContent = ''
      let thinkingActive = false
      const start = Date.now()
      send('agent_start', { name: 'critic' })
      const critic = await runAgentStepStreaming(
        model,
        CRITIC_PROMPT,
        criticInput,
        signal,
        (delta) => {
          criticContent += delta
          send('agent_delta', { name: 'critic', delta })
        },
        systemText,
        openAiThinkingExtras,
        { agentName: 'critic', threadId },
        (delta) => {
          if (!thinkingActive) {
            thinkingActive = true
            send('agent_thinking_start', { name: 'critic' })
          }
          send('agent_thinking_delta', { name: 'critic', delta })
      },
      onUsage
      )
      if (thinkingActive) {
        send('agent_thinking_end', { name: 'critic' })
      }
      const output = criticContent || critic.content
      agents.push({ name: 'critic', output })
      send('agent', { name: 'critic', output })
      send('agent_end', { name: 'critic', durationMs: Date.now() - start })
      return { criticOutput: output }
    })
  }

  graph.addNode('reporter', async (state: any) => {
    const plannerOutput = state.plannerOutput || ''
    const researcherOutput = state.researcherOutput || ''
    const analystOutput = ultraEnabled ? state.analystOutput || '' : ''
    const riskOutput = ultraEnabled ? state.riskOutput || '' : ''
    const criticOutput = ultraEnabled ? state.criticOutput || '' : ''
    const reporterInput = ultraEnabled
      ? `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nAnalysis:\n${analystOutput}\n\nRisks:\n${riskOutput}\n\nCritique:\n${criticOutput}\n\nUser Request:\n${message}`
      : `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nUser Request:\n${message}`
    const start = Date.now()
    send('agent_start', { name: 'reporter' })
    let thinkingActive = false
    let response = ''
    if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
      const streamMessages: OpenAiMessage[] = []
      const systemContent = systemText ? `${systemText}\n\n${REPORTER_PROMPT}` : REPORTER_PROMPT
      streamMessages.push({ role: 'system', content: systemContent })
      streamMessages.push({ role: 'user', content: reporterInput })
      const result = await streamOpenAiWithMcp(
        streamMessages,
        model,
        signal,
        openAiThinkingExtras,
        mcpToolset,
        (chunk) => {
          if (chunk.type === 'reasoning') {
            if (!thinkingActive) {
              thinkingActive = true
              send('agent_thinking_start', { name: 'reporter' })
            }
            send('agent_thinking_delta', { name: 'reporter', delta: chunk.value })
            onReasoning(chunk.value)
          } else {
            response += chunk.value
            onContent(chunk.value)
          }
        },
        onToolEvent,
        toolContext
      )
      tools.push(...result.tools)
    } else {
      const reporter = await runAgentStep(
        model,
        REPORTER_PROMPT,
        reporterInput,
        signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'reporter', threadId },
        onUsage
      )
      response = reporter.content
      splitTextForStream(response).forEach((chunk) => {
        send('delta', { delta: chunk })
      })
    }
    if (thinkingActive) {
      send('agent_thinking_end', { name: 'reporter' })
    }
    send('agent', { name: 'reporter', output: response })
    send('agent_end', { name: 'reporter', durationMs: Date.now() - start })
    return { finalResponse: response }
  })

  graph.addEdge(START, 'planner')
  graph.addEdge('planner', 'researcher')
  if (ultraEnabled) {
    graph.addEdge('researcher', 'analyst')
    graph.addEdge('analyst', 'risk')
    graph.addEdge('risk', 'critic')
    graph.addEdge('critic', 'reporter')
  } else {
    graph.addEdge('researcher', 'reporter')
  }
  graph.addEdge('reporter', END)

  const app = graph.compile()
  const result = await app.invoke({
    plannerOutput: '',
    researcherOutput: '',
    analystOutput: '',
    riskOutput: '',
    criticOutput: '',
    finalResponse: ''
  })

  return { finalResponse: result.finalResponse || '', agents, tools }
}

// 处理聊天的流式响应请求
chatRoute.post('/stream', async (c) => {
  // 解析并校验请求体
  let body: z.infer<typeof ChatRequestSchema>
  try {
    body = ChatRequestSchema.parse(await c.req.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    const messageText = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: messageText }, 400)
  }

  // 解析多代理/产物/技能指令并还原用户消息
  const multiAgentCommand = parseMultiAgentCommand(body.message)
  const rawMessage = multiAgentCommand ? multiAgentCommand.content : body.message
  const artifactCommand = parseArtifactCommand(rawMessage)
  const rawMessageWithoutArtifact = artifactCommand ? artifactCommand.content : rawMessage
  const skillCommand = parseSkillCommand(rawMessageWithoutArtifact)
  const message = skillCommand ? (skillCommand.content || `使用技能 ${skillCommand.skillId}`) : rawMessageWithoutArtifact
  // 解析模型与线程
  const modelId = body.modelId
  const incomingThreadId = body.threadId
  const thread = incomingThreadId ? getThread(incomingThreadId) : createThread()
  if (!thread) {
    return c.json({ error: 'Thread not found', threadId: incomingThreadId }, 404)
  }
  const model = modelId ? findModelConfig(modelId) : resolveDefaultModel()
  if (!model) {
    return c.json({ error: 'Unsupported modelId', modelId }, 400)
  }
  const threadData = ensureThreadData(thread.id)
  const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const onUsage = (usage: TokenUsage) => mergeTokenUsage(tokenUsage, usage)
  let autoSkill: SkillDefinition | null = null
  if (!skillCommand) {
    autoSkill = await maybeSelectSkill(rawMessageWithoutArtifact, model, c.req.raw.signal, onUsage)
  }

  // 写入用户消息
  appendMessage(thread.id, {
    id: randomUUID(),
    role: 'user',
    content: message,
    createdAt: Date.now()
  })

  // 设置 SSE 响应头
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  }

  const encoder = new TextEncoder()

  // 构建 SSE 流
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const agentTimeline: Array<{
        name: string
        status: 'running' | 'done' | 'error'
        durationMs?: number
        output?: string
        thinking?: string
        thinkingActive?: boolean
      }> = []
      const trace: Array<
        | {
            type: 'agent'
            agentName: string
            phase: 'thinking' | 'output'
            status: 'running' | 'done'
            content: string
            durationMs?: number
          }
        | {
            type: 'tool'
            callId?: string
            name: string
            serverName?: string
            toolName?: string
            status: 'running' | 'done' | 'error'
            durationMs?: number
            args?: Record<string, unknown>
            result?: string
            error?: string
          }
      > = []
      const updateAgentTimeline = (entry: {
        name: string
        status?: 'running' | 'done' | 'error'
        durationMs?: number
        output?: string
        thinking?: string
        thinkingActive?: boolean
      }) => {
        const index = agentTimeline.findIndex((item) => item.name === entry.name)
        if (index >= 0) {
          agentTimeline[index] = { ...agentTimeline[index], ...entry }
        } else {
          agentTimeline.push({
            name: entry.name,
            status: entry.status ?? 'running',
            durationMs: entry.durationMs,
            output: entry.output,
            thinking: entry.thinking,
            thinkingActive: entry.thinkingActive
          })
        }
      }
      const findLastTrace = (predicate: (item: (typeof trace)[number]) => boolean) => {
        for (let index = trace.length - 1; index >= 0; index -= 1) {
          const item = trace[index]
          if (predicate(item)) return item
        }
        return null
      }
      // 安全关闭流
      const closeStream = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
        }
      }
      // 发送标准 SSE 事件
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          if (event === 'agent_start') {
            const name = (data as any)?.name
            if (typeof name === 'string' && name.length > 0) {
              updateAgentTimeline({ name, status: 'running' })
            }
          }
          if (event === 'agent_end') {
            const name = (data as any)?.name
            const durationMs = (data as any)?.durationMs
            if (typeof name === 'string' && name.length > 0) {
              updateAgentTimeline({
                name,
                status: 'done',
                durationMs: typeof durationMs === 'number' ? durationMs : undefined
              })
            }
          }
          if (event === 'agent') {
            const name = (data as any)?.name
            const output = (data as any)?.output
            if (typeof name === 'string' && name.length > 0 && typeof output === 'string') {
              updateAgentTimeline({ name, status: 'done', output })
            }
          }
          if (event === 'agent_thinking_start') {
            const name = (data as any)?.name
            if (typeof name === 'string' && name.length > 0) {
              updateAgentTimeline({ name, thinkingActive: true })
              trace.push({
                type: 'agent',
                agentName: name,
                phase: 'thinking',
                status: 'running',
                content: ''
              })
            }
          }
          if (event === 'agent_thinking_delta') {
            const name = (data as any)?.name
            const delta = (data as any)?.delta
            if (typeof name === 'string' && name.length > 0 && typeof delta === 'string') {
              const current = agentTimeline.find((item) => item.name === name)?.thinking ?? ''
              updateAgentTimeline({ name, thinking: `${current}${delta}`, thinkingActive: true })
              const last = findLastTrace(
                (item) =>
                  item.type === 'agent' && item.agentName === name && item.phase === 'thinking' && item.status === 'running'
              )
              if (last && last.type === 'agent') {
                last.content = `${last.content}${delta}`
              } else {
                trace.push({
                  type: 'agent',
                  agentName: name,
                  phase: 'thinking',
                  status: 'running',
                  content: delta
                })
              }
            }
          }
          if (event === 'agent_thinking_end') {
            const name = (data as any)?.name
            if (typeof name === 'string' && name.length > 0) {
              updateAgentTimeline({ name, thinkingActive: false })
              const last = findLastTrace(
                (item) =>
                  item.type === 'agent' && item.agentName === name && item.phase === 'thinking' && item.status === 'running'
              )
              if (last && last.type === 'agent') {
                last.status = 'done'
              }
            }
          }
          if (event === 'agent_delta') {
            const name = (data as any)?.name
            const delta = (data as any)?.delta
            if (typeof name === 'string' && name.length > 0 && typeof delta === 'string') {
              const last = findLastTrace(
                (item) =>
                  item.type === 'agent' && item.agentName === name && item.phase === 'output' && item.status === 'running'
              )
              if (last && last.type === 'agent') {
                last.content = `${last.content}${delta}`
              } else {
                trace.push({
                  type: 'agent',
                  agentName: name,
                  phase: 'output',
                  status: 'running',
                  content: delta
                })
              }
            }
          }
          if (event === 'agent') {
            const name = (data as any)?.name
            const output = (data as any)?.output
            if (typeof name === 'string' && name.length > 0 && typeof output === 'string') {
              const last = findLastTrace(
                (item) =>
                  item.type === 'agent' && item.agentName === name && item.phase === 'output' && item.status === 'running'
              )
              if (last && last.type === 'agent') {
                last.content = output
                last.status = 'done'
              } else {
                trace.push({
                  type: 'agent',
                  agentName: name,
                  phase: 'output',
                  status: 'done',
                  content: output
                })
              }
            }
          }
          if (event === 'agent_end') {
            const name = (data as any)?.name
            const durationMs = (data as any)?.durationMs
            if (typeof name === 'string' && name.length > 0) {
              const last = findLastTrace(
                (item) =>
                  item.type === 'agent' && item.agentName === name && item.phase === 'output' && item.status === 'running'
              )
              if (last && last.type === 'agent') {
                last.status = 'done'
                last.durationMs = typeof durationMs === 'number' ? durationMs : undefined
              }
            }
          }
          if (event === 'tool_start') {
            const callId = (data as any)?.callId
            const name = (data as any)?.name
            const serverName = (data as any)?.serverName
            const toolName = (data as any)?.toolName
            const args = (data as any)?.args
            if (typeof name === 'string' && name.length > 0) {
              trace.push({
                type: 'tool',
                callId: typeof callId === 'string' ? callId : undefined,
                name,
                serverName: typeof serverName === 'string' ? serverName : undefined,
                toolName: typeof toolName === 'string' ? toolName : undefined,
                status: 'running',
                args: typeof args === 'object' && args ? (args as Record<string, unknown>) : undefined
              })
            }
          }
          if (event === 'tool_call_delta') {
            const callId = (data as any)?.id
            const name = (data as any)?.name
            const index = (data as any)?.index
            const argsPreview = (data as any)?.arguments
            const resolvedName =
              typeof name === 'string' && name.length > 0
                ? name
                : typeof index === 'number'
                  ? `tool_call[${index}]`
                  : 'tool_call'
            const resolvedCallId = typeof callId === 'string' && callId.length > 0 ? callId : undefined
            const last = findLastTrace(
              (item) =>
                item.type === 'tool' &&
                item.status === 'running' &&
                (resolvedCallId ? item.callId === resolvedCallId : item.name === resolvedName)
            )
            const nextArgs =
              typeof argsPreview === 'string' && argsPreview.length > 0 ? ({ arguments: argsPreview } as Record<string, unknown>) : undefined
            if (last && last.type === 'tool') {
              last.callId = resolvedCallId ?? last.callId
              last.name = resolvedName
              if (nextArgs) {
                last.args = { ...(last.args ?? {}), ...nextArgs }
              }
            } else {
              trace.push({
                type: 'tool',
                callId: resolvedCallId,
                name: resolvedName,
                status: 'running',
                args: nextArgs
              })
            }
          }
          if (event === 'tool_end') {
            const callId = (data as any)?.callId
            const name = (data as any)?.name
            const durationMs = (data as any)?.durationMs
            const ok = (data as any)?.ok
            const result = (data as any)?.result
            const error = (data as any)?.error
            if (typeof name === 'string' && name.length > 0) {
              const matchId = typeof callId === 'string' && callId.length > 0 ? callId : undefined
              const last = findLastTrace(
                (item) =>
                  item.type === 'tool' &&
                  item.status === 'running' &&
                  (matchId ? item.callId === matchId : item.name === name)
              )
              const status: 'done' | 'error' = ok === false ? 'error' : 'done'
              if (last && last.type === 'tool') {
                last.status = status
                last.durationMs = typeof durationMs === 'number' ? durationMs : undefined
                if (typeof result === 'string') last.result = result
                if (typeof error === 'string') last.error = error
              } else {
                trace.push({
                  type: 'tool',
                  callId: matchId,
                  name,
                  status,
                  durationMs: typeof durationMs === 'number' ? durationMs : undefined,
                  result: typeof result === 'string' ? result : undefined,
                  error: typeof error === 'string' ? error : undefined
                })
              }
            }
          }
          controller.enqueue(encoder.encode(`event: ${event}\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closeStream()
        }
      }

      // 心跳保持连接
      const sendPing = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`))
        } catch {
          closeStream()
        }
      }

      // 发送起始事件与保活定时器
      send('start', { threadId: thread.id, modelId: model.id })
      const pingInterval = setInterval(() => {
        try {
          sendPing()
        } catch {
          clearInterval(pingInterval)
        }
      }, 15000)
      // 监听客户端中止
      const onAbort = () => {
        clearInterval(pingInterval)
        closeStream()
      }
      c.req.raw.signal.addEventListener('abort', onAbort)

      ;(async () => {
        try {
          // 触发自动摘要并维护上下文
          if (parseSummaryEnabled()) {
            const summaryTrigger = parseSummaryTriggerMessages()
            const summaryKeep = parseSummaryKeepMessages()
            const nonSystemMessages = thread.messages.filter((entry) => entry.role !== 'system')
            if (nonSystemMessages.length > summaryTrigger) {
              const toSummarize = nonSystemMessages.slice(0, Math.max(0, nonSystemMessages.length - summaryKeep))
              const keepMessages = nonSystemMessages.slice(-summaryKeep)
              if (toSummarize.length > 0) {
              const summary = await summarizeConversation(model, thread.summary ?? null, toSummarize, onUsage)
                const updatedThread = updateThreadSummary(thread.id, summary, keepMessages)
                if (updatedThread) {
                  thread.messages = updatedThread.messages
                  thread.summary = updatedThread.summary
                }
              }
            }
          }

          // 组装系统提示词
          const systemMessages = thread.messages.filter((entry) => entry.role === 'system')
          const systemTextParts: string[] = []
          systemTextParts.push(MASTER_AGENT_PROMPT)
          const skillsPromptSection = buildSkillSystemSection()
          if (skillsPromptSection) {
            systemTextParts.push(skillsPromptSection)
          }
          if (body.mode === 'vibefishing') {
            systemTextParts.push(VIBEFISHING_SUBAGENT_GUIDE)
          }
          if (artifactCommand) {
            systemTextParts.push('You are generating content for a text file. Output only the file content with no extra explanations.')
          }
          const activeSkillId = skillCommand?.skillId ?? autoSkill?.id
          if (activeSkillId) {
            const skill = skillCommand ? getSkillByName(skillCommand.skillId) : autoSkill
            if (!skill) {
              send('error', { error: 'Skill not found', skillId: activeSkillId })
              return
            }
            if (!skill.enabled) {
              send('error', { error: 'Skill is disabled', skillId: activeSkillId })
              return
            }
            systemTextParts.push(skill.content)
          }
          if (systemMessages.length > 0) {
            systemTextParts.push(systemMessages[systemMessages.length - 1]?.content ?? '')
          }
          if (thread.summary) {
            systemTextParts.push(`Conversation summary:\n${thread.summary}`)
          }
          const systemText = systemTextParts.length > 0 ? systemTextParts.join('\n\n') : undefined

          // 构建上下文与模式开关
          const nonSystemMessages = thread.messages.filter((entry) => entry.role !== 'system')
          const contextMaxMessages = parseContextMaxMessages()
          const contextSlice = nonSystemMessages.slice(-contextMaxMessages)
          const contextBlock = buildContextBlock(contextSlice)
          const { isPro, thinkingEnabled } = resolveModeFlags(body.mode)
          const ultraEnabled = body.mode === 'ultra'
          const multiAgentEnabled = Boolean(body.multiAgent) || Boolean(multiAgentCommand) || body.mode === 'ultra'
          const openAiThinkingExtras = thinkingEnabled ? getThinkingRequestExtras(model) : undefined
          const mcpToolset = await maybeLoadMcpToolset(model, threadData, thread.id)

          // 生成回复并流式发送
          let finalResponse = ''
          let reasoningContent = ''
          let reasoningActive = false
          const agents: Array<{ name: string; output: string }> = []
          const tools: string[] = []
          const toolTimeline: Array<{
            callId?: string
            name: string
            serverName?: string
            toolName?: string
            status: 'running' | 'done' | 'error'
            durationMs?: number
            args?: Record<string, unknown>
            result?: string
            error?: string
          }> = []

          const updateToolTimeline = (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => {
            const callId = typeof data.callId === 'string' ? data.callId : undefined
            const name = typeof data.name === 'string' ? data.name : ''
            if (!name) return
            const index = toolTimeline.findIndex((item) =>
              callId ? item.callId === callId : item.name === name
            )
            if (event === 'tool_start') {
              const next = {
                callId,
                name,
                serverName: typeof data.serverName === 'string' ? data.serverName : undefined,
                toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
                status: 'running' as const,
                args: (data.args as Record<string, unknown>) ?? undefined
              }
              if (index >= 0) {
                toolTimeline[index] = { ...toolTimeline[index], ...next }
              } else {
                toolTimeline.push(next)
              }
              return
            }
            const status: 'done' | 'error' = data.ok === false ? 'error' : 'done'
            const next = {
              callId,
              name,
              status,
              durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
              result: typeof data.result === 'string' ? data.result : undefined,
              error: typeof data.error === 'string' ? data.error : undefined
            }
            if (index >= 0) {
              toolTimeline[index] = { ...toolTimeline[index], ...next }
            } else {
              toolTimeline.push(next)
            }
          }

          const onToolEvent = (event: 'tool_start' | 'tool_end', data: Record<string, unknown>) => {
            updateToolTimeline(event, data)
            send(event, data)
          }
          const toolContext: ToolExecutionContext = {
            model,
            systemText,
            threadId: thread.id,
            openAiThinkingExtras,
            toolset: mcpToolset,
            onToolEvent,
            onUsage,
            signal: c.req.raw.signal,
            send,
            subagentCallCount: 0,
            maxSubagentCalls: 3
          }

          if (multiAgentEnabled) {
            const onReasoning = (delta: string) => {
              if (!reasoningActive) {
                reasoningActive = true
                send('reasoning_start', {})
              }
              reasoningContent += delta
              send('reasoning_delta', { delta })
            }
            const onContent = (delta: string) => {
              if (reasoningActive) {
                reasoningActive = false
                send('reasoning_end', {})
              }
              finalResponse += delta
              send('delta', { delta })
            }
            const result = await runMultiAgentWithLangGraph({
              model,
              message,
              contextBlock,
              systemText,
              signal: c.req.raw.signal,
              openAiThinkingExtras,
              ultraEnabled,
              mcpToolset,
              threadId: thread.id,
              send,
              onReasoning,
              onContent,
              onToolEvent,
              onUsage
            })
            finalResponse = result.finalResponse
            agents.push(...result.agents)
            tools.push(...result.tools)
          } else if (isPro) {
            const plannerPrompt = PLANNER_PROMPT
            const researcherPrompt = RESEARCHER_PROMPT
            const reporterPrompt = REPORTER_PROMPT
            const plannerInput = `User Request:\n${message}\n\nContext:\n${contextBlock}`
            let plannerContent = ''
            const plannerStart = Date.now()
            send('agent_start', { name: 'planner' })
            send('plan_start', {})
              let plannerThinkingActive = false
              const planner = await runAgentStepStreaming(
                model,
                plannerPrompt,
                plannerInput,
                c.req.raw.signal,
                (delta) => {
                  plannerContent += delta
                  send('plan_delta', { delta })
                },
                systemText,
                openAiThinkingExtras,
                { agentName: 'planner', threadId: thread.id },
                (delta) => {
                  if (!plannerThinkingActive) {
                    plannerThinkingActive = true
                    send('agent_thinking_start', { name: 'planner' })
                  }
                  send('agent_thinking_delta', { name: 'planner', delta })
                },
                onUsage
              )
            send('plan_end', {})
              if (plannerThinkingActive) {
                send('agent_thinking_end', { name: 'planner' })
              }
            const plannerOutput = plannerContent || planner.content
            agents.push({ name: 'planner', output: plannerOutput })
            send('agent', { name: 'planner', output: plannerOutput })
            send('agent_end', { name: 'planner', durationMs: Date.now() - plannerStart })
            const researcherInput = `Plan:\n${plannerOutput}\n\nUser Request:\n${message}\n\nContext:\n${contextBlock}`
            let researcherContent = ''
            const researcherStart = Date.now()
            send('agent_start', { name: 'researcher' })
            send('research_start', {})
              let researcherThinkingActive = false
              const researcher = await runAgentStepStreaming(
                model,
                researcherPrompt,
                researcherInput,
                c.req.raw.signal,
                (delta) => {
                  researcherContent += delta
                  send('research_delta', { delta })
                },
                systemText,
                openAiThinkingExtras,
                { agentName: 'researcher', threadId: thread.id },
                (delta) => {
                  if (!researcherThinkingActive) {
                    researcherThinkingActive = true
                    send('agent_thinking_start', { name: 'researcher' })
                  }
                  send('agent_thinking_delta', { name: 'researcher', delta })
                },
                onUsage
              )
            send('research_end', {})
              if (researcherThinkingActive) {
                send('agent_thinking_end', { name: 'researcher' })
              }
            const researcherOutput = researcherContent || researcher.content
            agents.push({ name: 'researcher', output: researcherOutput })
            send('agent', { name: 'researcher', output: researcherOutput })
            send('agent_end', { name: 'researcher', durationMs: Date.now() - researcherStart })
            const reporterInput = `Plan:\n${plannerOutput}\n\nResearch:\n${researcherOutput}\n\nUser Request:\n${message}`

            // Reporter 输出（支持 OpenAI 流式与非流式）
            if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
              const streamMessages: OpenAiMessage[] = []
              const systemContent = systemText ? `${systemText}\n\n${reporterPrompt}` : reporterPrompt
              streamMessages.push({ role: 'system', content: systemContent })
              streamMessages.push({ role: 'user', content: reporterInput })
                const reporterStart = Date.now()
              send('agent_start', { name: 'reporter' })
                let reporterThinkingActive = false
              const result = await streamOpenAiWithMcp(
                streamMessages,
                model,
                c.req.raw.signal,
                openAiThinkingExtras,
                mcpToolset,
                (chunk) => {
                  if (chunk.type === 'reasoning') {
                    if (!reasoningActive) {
                      reasoningActive = true
                      send('reasoning_start', {})
                    }
                    reasoningContent += chunk.value
                    send('reasoning_delta', { delta: chunk.value })
                      if (!reporterThinkingActive) {
                        reporterThinkingActive = true
                        send('agent_thinking_start', { name: 'reporter' })
                      }
                      send('agent_thinking_delta', { name: 'reporter', delta: chunk.value })
                  } else {
                    if (reasoningActive) {
                      reasoningActive = false
                      send('reasoning_end', {})
                    }
                    finalResponse += chunk.value
                    send('delta', { delta: chunk.value })
                      send('agent_delta', { name: 'reporter', delta: chunk.value })
                  }
                },
                onToolEvent,
                toolContext
              )
              tools.push(...result.tools)
                if (reporterThinkingActive) {
                  send('agent_thinking_end', { name: 'reporter' })
                }
              send('agent', { name: 'reporter', output: finalResponse })
              send('agent_end', { name: 'reporter', durationMs: Date.now() - reporterStart })
            } else {
              const reporterStart = Date.now()
              send('agent_start', { name: 'reporter' })
              finalResponse = ''
              await runAgentStepStreaming(
                model,
                reporterPrompt,
                reporterInput,
                c.req.raw.signal,
                (delta) => {
                  finalResponse += delta
                  send('delta', { delta })
                  send('agent_delta', { name: 'reporter', delta })
                },
                systemText,
                openAiThinkingExtras,
                { agentName: 'reporter', threadId: thread.id },
                undefined,
                onUsage
              )
              send('agent', { name: 'reporter', output: finalResponse })
              send('agent_end', { name: 'reporter', durationMs: Date.now() - reporterStart })
            }
          // OpenAI 协议：支持思考流式与计划注入
          } else if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
            let planForPrompt: string | null = null
            if (isPro) {
              const planResult = await maybeBuildPlan(model, message, contextBlock, systemText, thinkingEnabled, {
                threadId: thread.id
              }, c.req.raw.signal, onUsage)
              if (planResult) {
                send('agent_start', { name: 'planner' })
                agents.push({ name: 'planner', output: planResult.content })
                send('agent', { name: 'planner', output: planResult.content })
                send('agent_end', { name: 'planner', durationMs: 0 })
                planForPrompt = planResult.content
              }
            }
            const openAiMessages: OpenAiMessage[] = []
            let systemContent = systemText
            if (planForPrompt) {
              systemContent = systemContent
                ? `${systemContent}\n\nPlan:\n${planForPrompt}\n\nFollow the plan.`
                : `Plan:\n${planForPrompt}\n\nFollow the plan.`
            }
            if (systemContent) {
              openAiMessages.push({ role: 'system', content: systemContent })
            }
            openAiMessages.push(
              ...contextSlice.map((entry) => ({ role: entry.role as 'user' | 'assistant', content: entry.content }))
            )
            const assistantStart = Date.now()
            send('agent_start', { name: MASTER_AGENT_NAME })
            let assistantThinkingActive = false
            const result = await streamOpenAiWithMcp(
              openAiMessages,
              model,
              c.req.raw.signal,
              openAiThinkingExtras,
              mcpToolset,
              (chunk) => {
                if (chunk.type === 'reasoning') {
                  if (!reasoningActive) {
                    reasoningActive = true
                    send('reasoning_start', {})
                  }
                  reasoningContent += chunk.value
                  send('reasoning_delta', { delta: chunk.value })
                  if (!assistantThinkingActive) {
                    assistantThinkingActive = true
                    send('agent_thinking_start', { name: MASTER_AGENT_NAME })
                  }
                  send('agent_thinking_delta', { name: MASTER_AGENT_NAME, delta: chunk.value })
                } else {
                  if (reasoningActive) {
                    reasoningActive = false
                    send('reasoning_end', {})
                  }
                  finalResponse += chunk.value
                  send('delta', { delta: chunk.value })
                  send('agent_delta', { name: MASTER_AGENT_NAME, delta: chunk.value })
                }
              },
              onToolEvent,
              toolContext
            )
            tools.push(...result.tools)
            if (assistantThinkingActive) {
              send('agent_thinking_end', { name: MASTER_AGENT_NAME })
            }
            send('agent', { name: MASTER_AGENT_NAME, output: finalResponse })
            send('agent_end', { name: MASTER_AGENT_NAME, durationMs: Date.now() - assistantStart })
          // Anthropic 协议：非流式返回
          } else {
            const anthropicMessages = contextSlice.map((entry) => ({
              role: entry.role as 'user' | 'assistant',
              content: entry.content
            }))
            let planOutput: string | null = null
            if (isPro) {
              const planResult = await maybeBuildPlan(model, message, contextBlock, systemText, thinkingEnabled, {
                threadId: thread.id
              }, c.req.raw.signal, onUsage)
              if (planResult) {
                planOutput = planResult.content
                agents.push({ name: 'planner', output: planResult.content })
                send('agent', { name: 'planner', output: planResult.content })
              }
            }
            const combinedSystemText = planOutput
              ? systemText
                ? `${systemText}\n\nPlan:\n${planOutput}\n\nFollow the plan.`
                : `Plan:\n${planOutput}\n\nFollow the plan.`
              : systemText
            let streamedResponse = ''
            const result = await streamAnthropicWithMcp(
              anthropicMessages,
              combinedSystemText,
              model,
              c.req.raw.signal,
              mcpToolset,
              (delta) => {
                streamedResponse += delta
                send('delta', { delta })
              },
              toolContext
            )
            finalResponse = streamedResponse
            tools.push(...(result.tools ?? []))
          }

          // 结束思考流式
          if (reasoningActive) {
            reasoningActive = false
            send('reasoning_end', {})
          }
          if (!finalResponse.trim() && reasoningContent.trim()) {
            finalResponse = reasoningContent.trim()
            splitTextForStream(finalResponse).forEach((chunk) => {
              send('delta', { delta: chunk })
            })
          }
          // 生成思考摘要（如开启）
          const thinkingSummary = reasoningContent.trim()
            ? reasoningContent.trim()
            : parseThinkingSummaryEnabled()
              ? await generateThinkingSummary(model, message, finalResponse, onUsage).catch(() => null)
              : null

          // 持久化产物与助手消息
          const toolArtifacts = toolTimeline.length > 0 ? buildFileArtifacts(toolTimeline) : []
          const artifacts = (artifactCommand
            ? [saveTextArtifact(thread.id, artifactCommand.fileName, finalResponse)]
            : []
          ).concat(toolArtifacts)
          const skillReads = toolTimeline.length > 0 ? buildSkillReads(toolTimeline) : []
          const updated = appendMessage(thread.id, {
            id: randomUUID(),
            role: 'assistant',
            content: finalResponse,
            meta: {
              thinking: thinkingSummary,
              skills:
                (activeSkillId ? [activeSkillId] : []).concat(skillReads.map((item) => item.name)).filter(Boolean),
              skillReads: skillReads.length > 0 ? skillReads : undefined,
              tools,
              agents: agents.length > 0 ? agents : undefined,
              agentTimeline: agentTimeline.length > 0 ? agentTimeline : undefined,
              toolTimeline: toolTimeline.length > 0 ? toolTimeline : undefined,
              trace: trace.length > 0 ? trace : undefined,
              artifacts: artifacts.length > 0 ? artifacts : undefined,
              tokenUsage: tokenUsage.totalTokens > 0 ? tokenUsage : undefined
            },
            createdAt: Date.now()
          })
          const latestMeta = updated?.messages?.[updated.messages.length - 1]?.meta ?? null
          // 通知前端完成与最终消息
          send('done', {
            modelId: model.id,
            threadId: thread.id,
            messages: updated?.messages ?? [],
            meta: latestMeta
          })
        } catch (error) {
          // 运行中错误透传给前端
          const messageText = error instanceof Error ? error.message : 'Unknown error'
          send('error', { error: messageText })
        } finally {
          // 清理定时器与事件监听
          clearInterval(pingInterval)
          c.req.raw.signal.removeEventListener('abort', onAbort)
          try {
            closeStream()
          } catch {
          }
        }
      })()
    }
  })

  return c.newResponse(stream, 200, headers)
})

chatRoute.post('/', async (c) => {
  try {
    const body = ChatRequestSchema.parse(await c.req.json())
    const multiAgentCommand = parseMultiAgentCommand(body.message)
    const rawMessage = multiAgentCommand ? multiAgentCommand.content : body.message
    const artifactCommand = parseArtifactCommand(rawMessage)
    const rawMessageWithoutArtifact = artifactCommand ? artifactCommand.content : rawMessage
    const skillCommand = parseSkillCommand(rawMessageWithoutArtifact)
    const message = skillCommand ? (skillCommand.content || `使用技能 ${skillCommand.skillId}`) : rawMessageWithoutArtifact
    const modelId = body.modelId
    const incomingThreadId = body.threadId
    const thread = incomingThreadId ? getThread(incomingThreadId) : createThread()
    if (!thread) {
      return c.json({ error: 'Thread not found', threadId: incomingThreadId }, 404)
    }
    const model = modelId ? findModelConfig(modelId) : resolveDefaultModel()

    if (!model) {
      return c.json({ error: 'Unsupported modelId', modelId }, 400)
    }
    const tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const onUsage = (usage: TokenUsage) => mergeTokenUsage(tokenUsage, usage)
    let autoSkill: SkillDefinition | null = null
    if (!skillCommand) {
      autoSkill = await maybeSelectSkill(rawMessageWithoutArtifact, model, c.req.raw.signal, onUsage)
    }

    console.info('chat request', {
      threadId: thread.id,
      modelId: model.id,
      messageLength: message.length,
      hasSkill: Boolean(skillCommand),
      multiAgent: Boolean(body.multiAgent) || Boolean(multiAgentCommand)
    })

    appendMessage(thread.id, {
      id: randomUUID(),
      role: 'user',
      content: message,
      createdAt: Date.now()
    })

    if (parseSummaryEnabled()) {
      const summaryTrigger = parseSummaryTriggerMessages()
      const summaryKeep = parseSummaryKeepMessages()
      const nonSystemMessages = thread.messages.filter((entry) => entry.role !== 'system')
      if (nonSystemMessages.length > summaryTrigger) {
        const toSummarize = nonSystemMessages.slice(0, Math.max(0, nonSystemMessages.length - summaryKeep))
        const keepMessages = nonSystemMessages.slice(-summaryKeep)
        if (toSummarize.length > 0) {
          const summary = await summarizeConversation(model, thread.summary ?? null, toSummarize, onUsage)
          const updatedThread = updateThreadSummary(thread.id, summary, keepMessages)
          if (updatedThread) {
            thread.messages = updatedThread.messages
            thread.summary = updatedThread.summary
          }
        }
      }
    }

    const systemMessages = thread.messages.filter((entry) => entry.role === 'system')
    const systemTextParts: string[] = []
    systemTextParts.push(MASTER_AGENT_PROMPT)
    const skillsPromptSection = buildSkillSystemSection()
    if (skillsPromptSection) {
      systemTextParts.push(skillsPromptSection)
    }
    if (body.mode === 'vibefishing') {
      systemTextParts.push(VIBEFISHING_SUBAGENT_GUIDE)
    }
    if (artifactCommand) {
      systemTextParts.push('You are generating content for a text file. Output only the file content with no extra explanations.')
    }
    const activeSkillId = skillCommand?.skillId ?? autoSkill?.id
    if (activeSkillId) {
      const skill = skillCommand ? getSkillByName(skillCommand.skillId) : autoSkill
      if (!skill) {
        return c.json({ error: 'Skill not found', skillId: activeSkillId }, 404)
      }
      if (!skill.enabled) {
        return c.json({ error: 'Skill is disabled', skillId: activeSkillId }, 403)
      }
      systemTextParts.push(skill.content)
    }
    if (systemMessages.length > 0) {
      systemTextParts.push(systemMessages[systemMessages.length - 1]?.content ?? '')
    }
    if (thread.summary) {
      systemTextParts.push(`Conversation summary:\n${thread.summary}`)
    }
    const systemText = systemTextParts.length > 0 ? systemTextParts.join('\n\n') : undefined
    const nonSystemMessages = thread.messages.filter((entry) => entry.role !== 'system')
    const contextMaxMessages = parseContextMaxMessages()
    const contextSlice = nonSystemMessages.slice(-contextMaxMessages)
    const contextBlock = buildContextBlock(contextSlice)
    const { isPro, thinkingEnabled } = resolveModeFlags(body.mode)
    const ultraEnabled = body.mode === 'ultra'
    const multiAgentEnabled = Boolean(body.multiAgent) || Boolean(multiAgentCommand) || ultraEnabled
    const openAiThinkingExtras = thinkingEnabled ? getThinkingRequestExtras(model) : undefined
    const threadData = ensureThreadData(thread.id)
    const mcpToolset = await maybeLoadMcpToolset(model, threadData, thread.id)

    if (multiAgentEnabled) {
      const start = Date.now()
      const plannerPrompt = PLANNER_PROMPT
      const researcherPrompt = RESEARCHER_PROMPT
      const analystPrompt = ANALYST_PROMPT
      const riskPrompt = RISK_PROMPT
      const criticPrompt = CRITIC_PROMPT
      const reporterPrompt = REPORTER_PROMPT
      const plannerInput = `User Request:\n${message}\n\nContext:\n${contextBlock}`
      const planner = await runAgentStep(
        model,
        plannerPrompt,
        plannerInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'planner', threadId: thread.id },
        onUsage
      )
      console.info('multi-agent planner done', { threadId: thread.id, durationMs: Date.now() - start })
      const researcherInput = `Plan:\n${planner.content}\n\nUser Request:\n${message}\n\nContext:\n${contextBlock}`
      const researcher = await runAgentStep(
        model,
        researcherPrompt,
        researcherInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'researcher', threadId: thread.id },
        onUsage
      )
      console.info('multi-agent researcher done', { threadId: thread.id, durationMs: Date.now() - start })
      let analystOutput = ''
      let riskOutput = ''
      let criticOutput = ''
      let analystTools: string[] = []
      let riskTools: string[] = []
      let criticTools: string[] = []
      if (ultraEnabled) {
        const analystInput = `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nUser Request:\n${message}`
        const riskInput = `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nUser Request:\n${message}`
        const [analyst, risk] = await Promise.all([
          runAgentStep(
            model,
            analystPrompt,
            analystInput,
            c.req.raw.signal,
            systemText,
            openAiThinkingExtras,
            { agentName: 'analyst', threadId: thread.id },
            onUsage
          ),
          runAgentStep(
            model,
            riskPrompt,
            riskInput,
            c.req.raw.signal,
            systemText,
            openAiThinkingExtras,
            { agentName: 'risk', threadId: thread.id },
            onUsage
          )
        ])
        analystOutput = analyst.content
        riskOutput = risk.content
        analystTools = analyst.tools ?? []
        riskTools = risk.tools ?? []
        console.info('multi-agent analyst done', { threadId: thread.id, durationMs: Date.now() - start })
        console.info('multi-agent risk done', { threadId: thread.id, durationMs: Date.now() - start })
        const criticInput = `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nAnalysis:\n${analystOutput}\n\nRisks:\n${riskOutput}\n\nUser Request:\n${message}`
        const critic = await runAgentStep(
          model,
          criticPrompt,
          criticInput,
          c.req.raw.signal,
          systemText,
          openAiThinkingExtras,
          { agentName: 'critic', threadId: thread.id },
          onUsage
        )
        criticOutput = critic.content
        criticTools = critic.tools ?? []
        console.info('multi-agent critic done', { threadId: thread.id, durationMs: Date.now() - start })
      }
      const reporterInput = ultraEnabled
        ? `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nAnalysis:\n${analystOutput}\n\nRisks:\n${riskOutput}\n\nCritique:\n${criticOutput}\n\nUser Request:\n${message}`
        : `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nUser Request:\n${message}`
      const reporter = await runAgentStep(
        model,
        reporterPrompt,
        reporterInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'reporter', threadId: thread.id },
        onUsage
      )
      console.info('multi-agent reporter done', {
        threadId: thread.id,
        durationMs: Date.now() - start,
        output: reporter.content
      })
      const tools = Array.from(
        new Set([
          ...(planner.tools ?? []),
          ...(researcher.tools ?? []),
          ...(reporter.tools ?? []),
          ...(analystTools ?? []),
          ...(riskTools ?? []),
          ...(criticTools ?? [])
        ])
      )
      const thinkingSummary = parseThinkingSummaryEnabled()
        ? await generateThinkingSummary(model, message, reporter.content, onUsage).catch(() => null)
        : null
      const artifacts = artifactCommand
        ? [saveTextArtifact(thread.id, artifactCommand.fileName, reporter.content)]
        : []
      const updated = appendMessage(thread.id, {
        id: randomUUID(),
        role: 'assistant',
        content: reporter.content,
        meta: {
          thinking: thinkingSummary,
          skills: activeSkillId ? [activeSkillId] : [],
          tools,
          agents: ultraEnabled
            ? [
                { name: 'planner', output: planner.content },
                { name: 'researcher', output: researcher.content },
                { name: 'analyst', output: analystOutput },
                { name: 'risk', output: riskOutput },
                { name: 'critic', output: criticOutput }
              ]
            : [
                { name: 'planner', output: planner.content },
                { name: 'researcher', output: researcher.content }
              ],
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          tokenUsage: tokenUsage.totalTokens > 0 ? tokenUsage : undefined
        },
        createdAt: Date.now()
      })
      const latestMeta = updated?.messages?.[updated.messages.length - 1]?.meta ?? null
      return c.json({
        response: reporter.content,
        modelId: model.id,
        threadId: thread.id,
        messages: updated?.messages ?? [],
        meta: latestMeta
      })
    }

    if (isPro) {
      const start = Date.now()
      const plannerPrompt = PLANNER_PROMPT
      const researcherPrompt = RESEARCHER_PROMPT
      const reporterPrompt = REPORTER_PROMPT
      const plannerInput = `User Request:\n${message}\n\nContext:\n${contextBlock}`
      const planner = await runAgentStep(
        model,
        plannerPrompt,
        plannerInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'planner', threadId: thread.id },
        onUsage
      )
      console.info('pro planner done', { threadId: thread.id, durationMs: Date.now() - start })
      const researcherInput = `Plan:\n${planner.content}\n\nUser Request:\n${message}\n\nContext:\n${contextBlock}`
      const researcher = await runAgentStep(
        model,
        researcherPrompt,
        researcherInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'researcher', threadId: thread.id },
        onUsage
      )
      console.info('pro researcher done', { threadId: thread.id, durationMs: Date.now() - start })
      const reporterInput = `Plan:\n${planner.content}\n\nResearch:\n${researcher.content}\n\nUser Request:\n${message}`
      const reporter = await runAgentStep(
        model,
        reporterPrompt,
        reporterInput,
        c.req.raw.signal,
        systemText,
        openAiThinkingExtras,
        { agentName: 'reporter', threadId: thread.id },
        onUsage
      )
      console.info('pro reporter done', {
        threadId: thread.id,
        durationMs: Date.now() - start,
        output: reporter.content
      })
      const tools = Array.from(new Set([...(planner.tools ?? []), ...(researcher.tools ?? []), ...(reporter.tools ?? [])]))
      const thinkingSummary = parseThinkingSummaryEnabled()
        ? await generateThinkingSummary(model, message, reporter.content, onUsage).catch(() => null)
        : null
      const artifacts = artifactCommand
        ? [saveTextArtifact(thread.id, artifactCommand.fileName, reporter.content)]
        : []
      const updated = appendMessage(thread.id, {
        id: randomUUID(),
        role: 'assistant',
        content: reporter.content,
        meta: {
          thinking: thinkingSummary,
          skills: activeSkillId ? [activeSkillId] : [],
          tools,
          agents: [
            { name: 'planner', output: planner.content },
            { name: 'researcher', output: researcher.content }
          ],
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          tokenUsage: tokenUsage.totalTokens > 0 ? tokenUsage : undefined
        },
        createdAt: Date.now()
      })
      const latestMeta = updated?.messages?.[updated.messages.length - 1]?.meta ?? null
      return c.json({
        response: reporter.content,
        modelId: model.id,
        threadId: thread.id,
        messages: updated?.messages ?? [],
        meta: latestMeta
      })
    }

    if (model.protocol === 'openai' || model.protocol === 'openai_compatible') {
      let planForPrompt: string | null = null
      if (isPro) {
        const planResult = await maybeBuildPlan(model, message, contextBlock, systemText, thinkingEnabled, {
          threadId: thread.id
        }, c.req.raw.signal, onUsage)
        if (planResult) {
          planForPrompt = planResult.content
        }
      }
      const openAiMessages: OpenAiMessage[] = []
      let systemContent = systemText
      if (planForPrompt) {
        systemContent = systemContent
          ? `${systemContent}\n\nPlan:\n${planForPrompt}\n\nFollow the plan.`
          : `Plan:\n${planForPrompt}\n\nFollow the plan.`
      }
      if (systemContent) {
        openAiMessages.push({ role: 'system', content: systemContent })
      }
      openAiMessages.push(
        ...contextSlice.map((entry) => ({ role: entry.role as 'user' | 'assistant', content: entry.content }))
      )
      const toolContext: ToolExecutionContext = {
        model,
        systemText: systemContent,
        threadId: thread.id,
        openAiThinkingExtras,
        toolset: mcpToolset,
        onUsage,
        signal: c.req.raw.signal,
        subagentCallCount: 0,
        maxSubagentCalls: 3
      }
      const metaResponse = await callOpenAiWithMcp(openAiMessages, model, openAiThinkingExtras, mcpToolset, toolContext)
      const response = metaResponse.content
      const thinkingSummary = parseThinkingSummaryEnabled()
        ? await generateThinkingSummary(model, message, response, onUsage).catch(() => null)
        : null
      const artifacts = artifactCommand
        ? [saveTextArtifact(thread.id, artifactCommand.fileName, response)]
        : []
      const updated = appendMessage(thread.id, {
        id: randomUUID(),
        role: 'assistant',
        content: response,
        meta: {
          thinking: thinkingSummary,
          skills: activeSkillId ? [activeSkillId] : [],
          tools: metaResponse.tools,
          agents: planForPrompt ? [{ name: 'planner', output: planForPrompt }] : undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          tokenUsage: tokenUsage.totalTokens > 0 ? tokenUsage : undefined
        },
        createdAt: Date.now()
      })
      const latestMeta = updated?.messages?.[updated.messages.length - 1]?.meta ?? null
      return c.json({
        response,
        modelId: model.id,
        threadId: thread.id,
        messages: updated?.messages ?? [],
        meta: latestMeta
      })
    }

    if (model.protocol === 'anthropic') {
      let planOutput: string | null = null
      if (isPro) {
        const planResult = await maybeBuildPlan(model, message, contextBlock, systemText, thinkingEnabled, {
          threadId: thread.id
        }, c.req.raw.signal, onUsage)
        if (planResult) {
          planOutput = planResult.content
        }
      }
      const anthropicMessages = contextSlice.map((entry) => ({
        role: entry.role as 'user' | 'assistant',
        content: entry.content
      }))
      const combinedSystemText = planOutput
        ? systemText
          ? `${systemText}\n\nPlan:\n${planOutput}\n\nFollow the plan.`
          : `Plan:\n${planOutput}\n\nFollow the plan.`
        : systemText
      const toolContext: ToolExecutionContext = {
        model,
        systemText,
        threadId: thread.id,
        openAiThinkingExtras,
        toolset: mcpToolset,
        onUsage,
        signal: c.req.raw.signal
      }
      const withTools = await callAnthropicWithMcp(
        anthropicMessages,
        combinedSystemText,
        model,
        undefined,
        mcpToolset,
        toolContext
      )
      const response = withTools.content
      const thinkingSummary = parseThinkingSummaryEnabled()
        ? await generateThinkingSummary(model, message, response, onUsage).catch(() => null)
        : null
      const artifacts = artifactCommand
        ? [saveTextArtifact(thread.id, artifactCommand.fileName, response)]
        : []
      const updated = appendMessage(thread.id, {
        id: randomUUID(),
        role: 'assistant',
        content: response,
        meta: {
          thinking: thinkingSummary,
          skills: skillCommand ? [skillCommand.skillId] : [],
          tools: withTools.tools,
          agents: planOutput ? [{ name: 'planner', output: planOutput }] : undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          tokenUsage: tokenUsage.totalTokens > 0 ? tokenUsage : undefined
        },
        createdAt: Date.now()
      })
      const latestMeta = updated?.messages?.[updated.messages.length - 1]?.meta ?? null
      return c.json({
        response,
        modelId: model.id,
        threadId: thread.id,
        messages: updated?.messages ?? [],
        meta: latestMeta
      })
    }

    return c.json({ error: 'Unsupported model protocol', modelId: model.id }, 400)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    if (error instanceof Error && error.name === 'UpstreamTimeout') {
      console.error('chat upstream timeout')
      return c.json({ error: 'Upstream timeout' }, 504)
    }
    const messageText = error instanceof Error ? error.message : 'Unknown error'
    console.error('chat error', { message: messageText })
    return c.json({ error: messageText }, 500)
  }
})

export const __test__ = {
  resolveModeFlags,
  getThinkingRequestExtras
}
