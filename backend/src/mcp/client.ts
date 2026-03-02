import { spawn } from 'node:child_process'
import { McpServerConfig } from './config'

const parseJsonLines = (chunk: string, buffer: { value: string }) => {
  buffer.value += chunk
  const lines = buffer.value.split('\n')
  buffer.value = lines.pop() ?? ''
  return lines.map((line) => line.trim()).filter((line) => line.length > 0)
}

const runHttpRequest = async (server: McpServerConfig, payload: Record<string, unknown>) => {
  if (!server.url) {
    throw new Error('MCP http server missing url')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(server.headers ?? {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`MCP http error: ${res.status} ${errorText}`)
    }
    return (await res.json()) as Record<string, unknown>
  } finally {
    clearTimeout(timeout)
  }
}

const sanitizeStderr = (input: string) => {
  return input
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/SERVICE_ACCOUNT_SECRET_KEY\s*[:=]\s*["']?[^"'\s]+/g, 'SERVICE_ACCOUNT_SECRET_KEY=[REDACTED]')
}

const shouldLogMcpTimings = () => {
  return false
}

const trimLogText = (input: string, maxChars = 800) => {
  const trimmed = input.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}…`
}

const runStdioRequest = async (server: McpServerConfig, payload: Record<string, unknown>) => {
  if (!server.command) {
    throw new Error('MCP stdio server missing command')
  }
  const args = server.args ?? []
  const env = { ...process.env, ...(server.env ?? {}) }
  const child = spawn(server.command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const buffer = { value: '' }
  let stderrOutput = ''
  const method = typeof payload.method === 'string' ? payload.method : ''
  const startedAt = Date.now()
  let firstStderrAt: number | null = null
  let firstStdoutAt: number | null = null
  let availableToolsAt: number | null = null

  const maybeLogTimings = (outcome: 'ok' | 'error', extra?: { error?: string; stderr?: string }) => {
    if (!shouldLogMcpTimings()) return
    const now = Date.now()
    const data = {
      outcome,
      method,
      totalMs: now - startedAt,
      toFirstStderrMs: firstStderrAt ? firstStderrAt - startedAt : null,
      toFirstStdoutMs: firstStdoutAt ? firstStdoutAt - startedAt : null,
      toAvailableToolsMs: availableToolsAt ? availableToolsAt - startedAt : null,
      error: extra?.error,
      stderr: extra?.stderr
    }
    console.info('mcp stdio timing', data)
  }

  const waitForResponse = (id: number) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const resolveFromBuffer = () => {
        const trimmed = buffer.value.trim()
        if (!trimmed) return false
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed?.id === id) {
            cleanup()
            resolve(parsed)
            return true
          }
        } catch {
        }
        return false
      }
      const resolveFromStderr = () => {
        if (method !== 'tools/list') return false
        const match = stderrOutput.match(/Available tools:\s*([^\n]+)/)
        if (!match) return false
        const tools = match[1]
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ name }))
        cleanup()
        maybeLogTimings('ok')
        resolve({ result: { tools } })
        return true
      }
      const timeout = setTimeout(() => {
        cleanup()
        if (resolveFromBuffer() || resolveFromStderr()) return
        const safeStderr = sanitizeStderr(stderrOutput)
        const suffix = safeStderr ? ` | stderr: ${safeStderr.trim()}` : ''
        maybeLogTimings('error', { error: 'timeout', stderr: trimLogText(safeStderr) })
        reject(new Error(`MCP stdio server timeout${suffix}`))
      }, 30000)
      const onData = (data: Buffer) => {
        if (!firstStdoutAt) firstStdoutAt = Date.now()
        const lines = parseJsonLines(data.toString('utf-8'), buffer)
        lines.forEach((line) => {
          try {
            const parsed = JSON.parse(line)
            if (parsed?.id === id) {
              cleanup()
              maybeLogTimings('ok')
              resolve(parsed)
            }
          } catch {
          }
        })
      }
      const onStderr = (data: Buffer) => {
        if (!firstStderrAt) firstStderrAt = Date.now()
        stderrOutput += data.toString('utf-8')
        if (!availableToolsAt && method === 'tools/list') {
          if (/Available tools:\s*/.test(stderrOutput)) {
            availableToolsAt = Date.now()
          }
        }
      }
      const onError = (error: Error) => {
        cleanup()
        if (resolveFromBuffer() || resolveFromStderr()) return
        const safeStderr = sanitizeStderr(stderrOutput)
        const suffix = safeStderr ? ` | stderr: ${safeStderr.trim()}` : ''
        maybeLogTimings('error', { error: error.message, stderr: trimLogText(safeStderr) })
        reject(new Error(`${error.message}${suffix}`))
      }
      const onExit = () => {
        cleanup()
        if (resolveFromBuffer() || resolveFromStderr()) return
        const safeStderr = sanitizeStderr(stderrOutput)
        const suffix = safeStderr ? ` | stderr: ${safeStderr.trim()}` : ''
        maybeLogTimings('error', { error: 'exited', stderr: trimLogText(safeStderr) })
        reject(new Error(`MCP stdio server exited${suffix}`))
      }
      const cleanup = () => {
        clearTimeout(timeout)
        child.stdout?.off('data', onData)
        child.stderr?.off('data', onStderr)
        child.off('error', onError)
        child.off('exit', onExit)
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onStderr)
      child.on('error', onError)
      child.on('exit', onExit)
    })

  try {
    const request = JSON.stringify(payload)
    child.stdin?.write(`${request}\n`)
    if (payload.id === undefined || payload.id === null) {
      maybeLogTimings('ok')
      return { result: { ok: true } }
    }
    const response = await waitForResponse(payload.id as number)
    return response
  } finally {
    try {
      child.kill()
    } catch {
    }
  }
}

const runMcpRequest = async (server: McpServerConfig, payload: Record<string, unknown>) => {
  if (server.type === 'http' || server.type === 'sse') {
    return runHttpRequest(server, payload)
  }
  return runStdioRequest(server, payload)
}

const initializeServer = async (server: McpServerConfig) => {
  const initResponse = await runMcpRequest(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {}
    }
  })
  await runMcpRequest(server, {
    jsonrpc: '2.0',
    method: 'initialized',
    params: {}
  })
  return initResponse
}

export const listMcpTools = async (server: McpServerConfig) => {
  await initializeServer(server)
  const response = await runMcpRequest(server, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  })
  const result = (response as any)?.result ?? response
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
}

export const callMcpTool = async (
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
) => {
  await initializeServer(server)
  const response = await runMcpRequest(server, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    }
  })
  return (response as any)?.result ?? response
}
