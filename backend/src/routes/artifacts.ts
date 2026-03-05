import { Hono } from 'hono'
import archiver from 'archiver'
import { SandboxClient } from '@agent-infra/sandbox'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { listArtifacts, readArtifact } from '../store/artifacts'
import { getThread, updateThreadSandbox } from '../store/threads'
import { createSandboxForThread, isSandboxLifecycleEnabled } from '../sandbox/lifecycle'

export const artifactsRoute = new Hono()

const resolveStorageDir = () => {
  const configured = process.env.THREAD_STORE_PATH
  if (configured && configured.trim().length > 0) {
    const raw = configured.trim()
    const storePath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
    return path.dirname(storePath)
  }
  const direct = path.resolve(process.cwd(), 'storage')
  if (fs.existsSync(direct)) return direct
  const nested = path.resolve(process.cwd(), 'backend', 'storage')
  if (fs.existsSync(nested)) return nested
  return direct
}

const sanitizePathSegment = (segment: string) => {
  return segment.replace(/[^\w.\-]+/g, '_')
}

const sanitizeRelativePath = (raw: string) => {
  const normalized = raw.replaceAll('\\', '/').trim()
  if (!normalized) return ''
  const stripped = normalized.replace(/^\/+/, '')
  const parts = stripped
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '.' && p !== '..')
    .map((p) => sanitizePathSegment(p))
    .filter((p) => p.length > 0)
  return parts.join('/')
}

const normalizeRelativePath = (raw: string) => {
  const normalized = raw.replaceAll('\\', '/').trim()
  if (!normalized) return ''
  const stripped = normalized.replace(/^\/+/, '')
  const parts = stripped
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '.' && p !== '..')
  return parts.join('/')
}

const isProbablyTextContent = (content: Uint8Array) => {
  const max = Math.min(content.length, 4096)
  if (max === 0) return true
  let suspicious = 0
  for (let i = 0; i < max; i += 1) {
    const b = content[i]!
    if (b === 0) return false
    const isPrintableAscii = b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)
    if (!isPrintableAscii && b < 128) suspicious += 1
  }
  return suspicious / max <= 0.2
}

const resolveArtifactMimeType = (name: string, content: Uint8Array) => {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8'
  if (ext === '.md' || ext === '.markdown') return 'text/markdown; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.txt' || ext === '.log' || ext === '.csv') return 'text/plain; charset=utf-8'
  if (ext === '.xml') return 'application/xml; charset=utf-8'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  return isProbablyTextContent(content) ? 'text/plain; charset=utf-8' : 'application/octet-stream'
}

const parseSandboxApiUrl = () => {
  const raw = process.env.SANDBOX_API_URL ?? process.env.SANDBOX_API_ENVIRONMENT
  if (!raw || raw.trim().length === 0) return null
  return raw.trim()
}

const parseSandboxHeaders = () => {
  const raw = process.env.SANDBOX_API_HEADERS
  if (!raw || raw.trim().length === 0) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const entries = Object.entries(parsed as Record<string, unknown>)
    const headers: Record<string, string> = {}
    for (const [key, value] of entries) {
      if (typeof value === 'string') headers[key] = value
    }
    return Object.keys(headers).length > 0 ? headers : undefined
  } catch {
    return undefined
  }
}

const parseSandboxTimeoutSeconds = () => {
  const raw = process.env.SANDBOX_API_TIMEOUT_SECONDS
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

const parseSandboxPerThread = () => {
  const raw = process.env.SANDBOX_PER_THREAD
  if (raw === undefined) return false
  return raw.toLowerCase() === 'true'
}

const ensureThreadSandbox = async (threadId: string) => {
  const thread = getThread(threadId)
  if (!thread) return null
  if (thread.sandbox) return thread.sandbox
  if (!isSandboxLifecycleEnabled()) return null
  try {
    const sandbox = await createSandboxForThread(threadId)
    updateThreadSandbox(threadId, sandbox)
  } catch {
  }
  return getThread(threadId)?.sandbox ?? null
}

const getSandboxClient = (() => {
  const cache = new Map<string, SandboxClient>()
  return (environment: string | null) => {
    if (!environment) return null
    const normalized = environment.trim()
    if (!normalized) return null
    const existing = cache.get(normalized)
    if (existing) return existing
    const next = new SandboxClient({
      environment: normalized,
      timeoutInSeconds: parseSandboxTimeoutSeconds(),
      headers: parseSandboxHeaders()
    })
    cache.set(normalized, next)
    return next
  }
})()

const unwrapSandboxResponse = (response: any) => {
  const payload = response?.data ?? response
  if (payload?.ok === false && payload?.error) {
    const content = payload.error?.content ?? payload.error
    const message =
      typeof content?.errorMessage === 'string'
        ? content.errorMessage
        : typeof content?.message === 'string'
          ? content.message
          : 'Sandbox API error'
    throw new Error(message)
  }
  const data = payload?.body ?? payload?.data ?? payload
  if (data?.success === false && typeof data?.message === 'string') {
    throw new Error(data.message)
  }
  return data
}

const resolveSandboxDataRoot = (threadId: string) => {
  const sandboxPrefix = '/tmp/user-data'
  const threadSandbox = getThread(threadId)?.sandbox ?? null
  const sandboxPerThread = parseSandboxPerThread()
  const sandboxEnvironment = threadSandbox?.apiUrl ?? parseSandboxApiUrl()
  const sandboxClient = getSandboxClient(sandboxEnvironment)
  const sandboxDataRoot = threadSandbox
    ? sandboxPrefix
    : sandboxPerThread
      ? path.posix.join(sandboxPrefix, threadId)
      : sandboxPrefix
  return { threadSandbox, sandboxClient, sandboxDataRoot }
}

const resolveLocalThreadDataRoot = (threadId: string) => {
  return path.join(resolveStorageDir(), 'threads', threadId, 'user-data')
}

const listLocalThreadDataArtifacts = (threadId: string) => {
  const root = resolveLocalThreadDataRoot(threadId)
  if (!fs.existsSync(root)) return []
  const results: Array<{ name: string; size: number; url: string }> = []
  const queue: Array<{ dir: string; prefix: string }> = [{ dir: root, prefix: '' }]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const entries = fs.readdirSync(current.dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current.dir, entry.name)
      const rel = current.prefix ? `${current.prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        queue.push({ dir: full, prefix: rel })
        continue
      }
      if (!entry.isFile()) continue
      const safeRel = normalizeRelativePath(rel)
      if (!safeRel) continue
      const size = fs.statSync(full).size
      results.push({ name: safeRel, size, url: `/artifacts/${threadId}/${encodeURIComponent(safeRel)}` })
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}

const readLocalThreadDataFile = (threadId: string, fileName: string) => {
  const root = resolveLocalThreadDataRoot(threadId)
  if (!fs.existsSync(root)) return null
  const rawRel = normalizeRelativePath(fileName)
  if (!rawRel) return null
  const decodedRel = (() => {
    try {
      return decodeURIComponent(rawRel)
    } catch {
      return rawRel
    }
  })()
  const candidates = Array.from(new Set([rawRel, decodedRel])).filter((v) => v.trim().length > 0)
  for (const safeRel of candidates) {
    const target = path.join(root, ...safeRel.split('/'))
    const resolvedRoot = path.resolve(root) + path.sep
    const resolvedTarget = path.resolve(target)
    if (!resolvedTarget.startsWith(resolvedRoot)) continue
    if (!fs.existsSync(resolvedTarget)) continue
    if (!fs.statSync(resolvedTarget).isFile()) continue
    const content = fs.readFileSync(resolvedTarget)
    const size = fs.statSync(resolvedTarget).size
    return { name: safeRel, content, size }
  }

  const want = rawRel
  const queue: Array<{ dir: string; prefix: string }> = [{ dir: root, prefix: '' }]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const entries = fs.readdirSync(current.dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current.dir, entry.name)
      const rel = current.prefix ? `${current.prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        queue.push({ dir: full, prefix: rel })
        continue
      }
      if (!entry.isFile()) continue
      const candidateRel = normalizeRelativePath(rel)
      if (!candidateRel) continue
      if (encodeURIComponent(candidateRel) !== want) continue
      const resolvedRoot = path.resolve(root) + path.sep
      const resolvedTarget = path.resolve(full)
      if (!resolvedTarget.startsWith(resolvedRoot)) continue
      const content = fs.readFileSync(full)
      const size = fs.statSync(full).size
      return { name: candidateRel, content, size }
    }
  }
  return null
}

const listArtifactsFromThreadMeta = (threadId: string) => {
  const thread = getThread(threadId)
  if (!thread) return []
  const results: Array<{ name: string; size: number; url: string }> = []
  const seen = new Set<string>()
  const messages = Array.isArray(thread.messages) ? thread.messages : []
  for (const message of messages) {
    if (message?.role !== 'assistant') continue
    const meta = message?.meta as any
    const artifacts = Array.isArray(meta?.artifacts) ? meta.artifacts : []
    for (const entry of artifacts) {
      const nameRaw = typeof entry?.name === 'string' ? entry.name : ''
      const safeRel = normalizeRelativePath(nameRaw)
      if (!safeRel || seen.has(safeRel)) continue
      const size = typeof entry?.size === 'number' ? entry.size : 0
      results.push({ name: safeRel, size, url: `/artifacts/${threadId}/${encodeURIComponent(safeRel)}` })
      seen.add(safeRel)
    }
  }
  return results
}

artifactsRoute.get('/:threadId', async (c) => {
  const threadId = c.req.param('threadId')
  const localThreadData = listLocalThreadDataArtifacts(threadId)
  if (localThreadData.length > 0) {
    return c.json({ threadId, artifacts: localThreadData })
  }
  const local = listArtifacts(threadId)
  if (local.length > 0) {
    return c.json({ threadId, artifacts: local })
  }
  await ensureThreadSandbox(threadId)
  const { sandboxClient, sandboxDataRoot } = resolveSandboxDataRoot(threadId)
  if (sandboxClient) {
    try {
      const artifacts = await (async () => {
        const results: Array<{ name: string; size: number; url: string }> = []
        const seen = new Set<string>()
        const queue: string[] = [sandboxDataRoot]
        while (queue.length > 0) {
          const dir = queue.shift()
          if (!dir) continue
          const response = await sandboxClient.file.listPath({ path: dir })
          const payload = unwrapSandboxResponse(response)
          const files = Array.isArray(payload?.files)
            ? payload.files
            : Array.isArray(payload?.data?.files)
              ? payload.data.files
              : []
          for (const entry of files) {
            const name =
              typeof entry?.path === 'string' ? entry.path : typeof entry?.name === 'string' ? entry.name : ''
            if (!name) continue
            const full = name.startsWith('/') ? name : path.posix.join(dir, name)
            const relative = path.posix.relative(sandboxDataRoot, full)
            const safeRel = normalizeRelativePath(relative)
            if (!safeRel || seen.has(safeRel)) continue
            if (entry?.is_directory) {
              queue.push(full)
              continue
            }
            const size = typeof entry?.size === 'number' ? entry.size : 0
            results.push({ name: safeRel, size, url: `/artifacts/${threadId}/${encodeURIComponent(safeRel)}` })
            seen.add(safeRel)
          }
        }
        return results
      })()
      return c.json({ threadId, artifacts })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Artifacts error'
      return c.json({ error: message }, 500)
    }
  }

  const metaArtifacts = listArtifactsFromThreadMeta(threadId)
  if (metaArtifacts.length > 0) {
    return c.json({ threadId, artifacts: metaArtifacts })
  }

  return c.json({ threadId, artifacts: [] })
})

artifactsRoute.get('/:threadId/download', async (c) => {
  const threadId = c.req.param('threadId')
  const artifactsDir = path.resolve(process.cwd(), 'storage', 'artifacts', threadId)
  const hasLocal = fs.existsSync(artifactsDir)
  if (!hasLocal) {
    await ensureThreadSandbox(threadId)
  }
  const sandboxResolved = !hasLocal ? resolveSandboxDataRoot(threadId) : null

  if (hasLocal) {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const stream = new PassThrough()
    archive.on('error', (error: Error) => {
      stream.destroy(error)
    })
    archive.pipe(stream)
    archive.directory(artifactsDir, false)
    archive.finalize()
    const filename = `artifacts-${threadId}.zip`
    const webStream = Readable.toWeb(stream) as ReadableStream
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  }

  const sandboxClient = sandboxResolved?.sandboxClient ?? null
  const sandboxDataRoot = sandboxResolved?.sandboxDataRoot ?? '/tmp/user-data'
  if (!sandboxClient) return c.json({ error: 'Artifacts not found' }, 404)

  const collected: Array<{ name: string; data: Buffer }> = []

  try {
    const queue: string[] = [sandboxDataRoot]
    const files: Array<{ name: string; fullPath: string }> = []
    const seen = new Set<string>()
    while (queue.length > 0) {
      const dir = queue.shift()
      if (!dir) continue
      const response = await sandboxClient.file.listPath({ path: dir })
      const payload = unwrapSandboxResponse(response)
      const entries = Array.isArray(payload?.files)
        ? payload.files
        : Array.isArray(payload?.data?.files)
          ? payload.data.files
          : []
      for (const entry of entries) {
        const entryPath = typeof entry?.path === 'string' ? entry.path : null
        const entryName = typeof entry?.name === 'string' ? entry.name : null
        const fullPath = entryPath ?? (entryName ? path.posix.join(dir, entryName) : null)
        if (!fullPath) continue
        const rel = path.posix.relative(sandboxDataRoot, fullPath)
        const safeRel = normalizeRelativePath(rel)
        if (!safeRel || seen.has(safeRel)) continue
        if (entry?.is_directory) {
          queue.push(fullPath)
          continue
        }
        seen.add(safeRel)
        files.push({ name: safeRel, fullPath })
      }
    }

    for (const file of files) {
      const response = await sandboxClient.file.downloadFile({ path: file.fullPath })
      const payload = (response as any)?.data ?? response
      if (payload?.ok === false && payload?.error) {
        const content = payload.error?.content ?? payload.error
        const statusCode = typeof content?.statusCode === 'number' ? content.statusCode : null
        if (statusCode === 404) continue
        throw new Error(typeof content?.message === 'string' ? content.message : 'Sandbox API error')
      }
      const binary = payload?.body ?? payload?.data ?? payload
      const buf = Buffer.from(await binary.arrayBuffer())
      collected.push({ name: file.name, data: buf })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifacts error'
    return c.json({ error: message }, 500)
  }

  if (collected.length === 0) {
    return c.json({ error: 'Artifacts not found' }, 404)
  }

  const archive = archiver('zip', { zlib: { level: 9 } })
  const stream = new PassThrough()
  archive.on('error', (error: Error) => {
    stream.destroy(error)
  })
  archive.pipe(stream)
  collected.forEach((item) => {
    archive.append(item.data, { name: item.name })
  })
  archive.finalize()
  const filename = `artifacts-${threadId}.zip`
  const webStream = Readable.toWeb(stream) as ReadableStream
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  })
})

artifactsRoute.get('/:threadId/:fileName{.+}', async (c) => {
  const threadId = c.req.param('threadId')
  const rawParam = c.req.param('fileName') ?? ''
  const decodedParam = (() => {
    try {
      return decodeURIComponent(rawParam)
    } catch {
      return rawParam
    }
  })()
  const candidates = Array.from(new Set([decodedParam, rawParam])).filter((v) => v.trim().length > 0)

  let resolvedArtifact: { name: string; content: Uint8Array; size: number } | null = null

  for (const fileName of candidates) {
    const local = readArtifact(threadId, fileName)
    if (local) {
      resolvedArtifact = { name: local.name, content: new Uint8Array(local.content), size: local.size }
      break
    }

    const fromLocalThreadData = readLocalThreadDataFile(threadId, fileName)
    if (fromLocalThreadData) {
      resolvedArtifact = { ...fromLocalThreadData, content: new Uint8Array(fromLocalThreadData.content) }
      break
    }

    const fromSandbox = await (async () => {
      await ensureThreadSandbox(threadId)
      const { sandboxClient, sandboxDataRoot } = resolveSandboxDataRoot(threadId)
      if (!sandboxClient) return null
      const safeRel = normalizeRelativePath(fileName)
      if (!safeRel) return null
      const fullPath = path.posix.join(sandboxDataRoot, ...safeRel.split('/'))
      const response = await sandboxClient.file.downloadFile({ path: fullPath })
      const payload = (response as any)?.data ?? response
      if (payload?.ok === false && payload?.error) {
        return null
      }
      const binary = payload?.body ?? payload?.data ?? payload
      const buf = Buffer.from(await binary.arrayBuffer())
      return { name: safeRel, content: new Uint8Array(buf), size: buf.length }
    })()
    if (fromSandbox) {
      resolvedArtifact = fromSandbox
      break
    }
  }

  if (!resolvedArtifact) return c.json({ error: 'Artifact not found' }, 404)
  const mimeType = resolveArtifactMimeType(resolvedArtifact.name, resolvedArtifact.content)
  const download = c.req.query('download') === 'true'
  const downloadName = path.basename(resolvedArtifact.name)
  const asciiFileName = (() => {
    const replaced = downloadName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_').trim()
    return replaced.length > 0 ? replaced : 'download'
  })()
  const contentDisposition = (() => {
    const base = download ? 'attachment' : 'inline'
    if (/^[\x20-\x7E]+$/.test(downloadName) && !downloadName.includes('"') && !downloadName.includes('\\')) {
      return `${base}; filename="${downloadName}"`
    }
    return `${base}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
  })()
  const webStream = Readable.toWeb(Readable.from([resolvedArtifact.content])) as ReadableStream
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(resolvedArtifact.size),
      'Content-Disposition': contentDisposition
    }
  })
})
