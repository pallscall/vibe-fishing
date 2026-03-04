import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  meta?: {
    thinking?: string | null
    skills?: string[]
    tools?: string[]
    tokenUsage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
    agents?: Array<{
      name: string
      output: string
    }>
    agentTimeline?: Array<{
      name: string
      status: 'running' | 'done' | 'error'
      durationMs?: number
      output?: string
      thinking?: string
      thinkingActive?: boolean
    }>
    toolTimeline?: Array<{
      callId?: string
      name: string
      serverName?: string
      toolName?: string
      status: 'running' | 'done' | 'error'
      durationMs?: number
      args?: Record<string, unknown>
      result?: string
      error?: string
    }>
    trace?: Array<
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
    >
    skillReads?: Array<{
      name: string
      path: string
    }>
    artifacts?: Array<{
      name: string
      size: number
      url: string
    }>
  }
  createdAt: number
}

export interface ThreadSandboxState {
  provider: 'volcengine' | 'local' | 'docker'
  functionId?: string
  sandboxId: string
  apiUrl: string
  uiUrl: string
  createdAt: number
}

export interface ThreadState {
  id: string
  title: string
  messages: ThreadMessage[]
  summary: string | null
  sandbox?: ThreadSandboxState | null
  createdAt: number
  updatedAt: number
}

const threads = new Map<string, ThreadState>()

const resolveStorePath = () => {
  const configured = process.env.THREAD_STORE_PATH
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), 'storage', 'threads.json')
}

const storePath = resolveStorePath()

const resolveThreadTtlDays = () => {
  const raw = process.env.CHAT_THREAD_TTL_DAYS
  const parsed = raw ? Number.parseFloat(raw) : 7
  if (!Number.isFinite(parsed) || parsed <= 0) return 7
  return parsed
}

const resolveThreadTtlMs = () => {
  return resolveThreadTtlDays() * 24 * 60 * 60 * 1000
}

const ensureStoreDir = () => {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const loadThreads = () => {
  if (!fs.existsSync(storePath)) return
  try {
    const raw = fs.readFileSync(storePath, 'utf-8')
    const data = JSON.parse(raw) as Array<Partial<ThreadState>>
    data.forEach((thread) => {
      if (!thread.id || !thread.title || !Array.isArray(thread.messages) || !thread.createdAt || !thread.updatedAt) {
        return
      }
      threads.set(thread.id, {
        id: thread.id,
        title: thread.title,
        messages: thread.messages as ThreadMessage[],
        summary: typeof thread.summary === 'string' ? thread.summary : null,
        sandbox:
          thread.sandbox && typeof thread.sandbox === 'object'
            ? (thread.sandbox as ThreadSandboxState)
            : null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt
      })
    })
  } catch (error) {
    return
  }
}

const persistThreads = () => {
  ensureStoreDir()
  const data = Array.from(threads.values())
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8')
}

export const purgeExpiredThreads = () => {
  const ttlMs = resolveThreadTtlMs()
  const now = Date.now()
  let removed = false
  threads.forEach((thread, id) => {
    if (now - thread.updatedAt > ttlMs) {
      threads.delete(id)
      removed = true
    }
  })
  if (removed) {
    persistThreads()
  }
  return removed
}

loadThreads()
purgeExpiredThreads()

setInterval(() => {
  purgeExpiredThreads()
}, 60 * 60 * 1000)

const formatTitle = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) return 'Untitled'
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed
}

export const listThreads = () => {
  purgeExpiredThreads()
  return Array.from(threads.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export const getThread = (id: string) => {
  purgeExpiredThreads()
  return threads.get(id) ?? null
}

export const createThread = () => {
  purgeExpiredThreads()
  return createThreadWithId(randomUUID(), null)
}

export const createThreadWithId = (id: string, sandbox: ThreadSandboxState | null) => {
  purgeExpiredThreads()
  const now = Date.now()
  const thread: ThreadState = {
    id,
    title: 'Untitled',
    messages: [],
    summary: null,
    sandbox,
    createdAt: now,
    updatedAt: now
  }
  threads.set(thread.id, thread)
  persistThreads()
  return thread
}

export const updateThreadSandbox = (threadId: string, sandbox: ThreadSandboxState | null) => {
  purgeExpiredThreads()
  const thread = threads.get(threadId)
  if (!thread) return null
  thread.sandbox = sandbox
  thread.updatedAt = Date.now()
  persistThreads()
  return thread
}

export const appendMessage = (threadId: string, message: ThreadMessage) => {
  purgeExpiredThreads()
  const thread = threads.get(threadId)
  if (!thread) return null
  thread.messages.push(message)
  if (thread.title === 'Untitled' && message.role === 'user') {
    thread.title = formatTitle(message.content)
  }
  thread.updatedAt = Date.now()
  persistThreads()
  return thread
}

export const updateThreadSummary = (
  threadId: string,
  summary: string | null,
  messages: ThreadMessage[]
) => {
  purgeExpiredThreads()
  const thread = threads.get(threadId)
  if (!thread) return null
  thread.summary = summary
  thread.messages = messages
  thread.updatedAt = Date.now()
  persistThreads()
  return thread
}

export const deleteThread = (threadId: string) => {
  const deleted = threads.delete(threadId)
  if (deleted) {
    persistThreads()
  }
  return deleted
}
