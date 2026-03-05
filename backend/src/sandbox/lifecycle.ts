import { providers } from '@agent-infra/sandbox'
import type { ThreadSandboxState } from '../store/threads'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'

// Per-thread sandbox lifecycle management is intentionally controlled by env vars.
// This keeps local development (static SANDBOX_API_URL/SANDBOX_UI_URL) as the default,
// while allowing production to opt into "create sandbox on thread creation, destroy on thread deletion".

const parseSandboxLifecycleEnabled = () => {
  const raw = process.env.SANDBOX_PER_THREAD_LIFECYCLE
  if (raw === undefined) return false
  return raw.toLowerCase() === 'true'
}

const parseSandboxProvider = () => {
  const raw = process.env.SANDBOX_PROVIDER
  const normalized = raw ? raw.trim().toLowerCase() : ''
  return normalized.length > 0 ? normalized : null
}

const parseSandboxFunctionId = () => {
  const raw = process.env.SANDBOX_FUNCTION_ID
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

const parseSandboxLocalBaseUrl = () => {
  const raw = process.env.SANDBOX_LOCAL_BASE_URL ?? process.env.SANDBOX_UI_URL ?? process.env.SANDBOX_API_URL
  if (!raw || raw.trim().length === 0) return null
  return raw.trim()
}

const parseDockerImage = () => {
  const raw = process.env.SANDBOX_DOCKER_IMAGE
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

const parseDockerContainerPort = () => {
  const raw = process.env.SANDBOX_DOCKER_CONTAINER_PORT
  const parsed = raw ? Number.parseInt(raw, 10) : 8080
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return 8080
  return parsed
}

const parseDockerHost = () => {
  const raw = process.env.SANDBOX_DOCKER_HOST
  return raw && raw.trim().length > 0 ? raw.trim() : '127.0.0.1'
}

const parseDockerMountData = () => {
  const raw = process.env.SANDBOX_DOCKER_MOUNT_DATA
  if (raw === undefined) return true
  return raw.toLowerCase() === 'true'
}

const parseDockerNamePrefix = () => {
  const raw = process.env.SANDBOX_DOCKER_NAME_PREFIX
  return raw && raw.trim().length > 0 ? raw.trim() : 'vf-sb'
}

const parseDockerExtraArgs = () => {
  const raw = process.env.SANDBOX_DOCKER_EXTRA_ARGS
  if (!raw || raw.trim().length === 0) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v) => typeof v === 'string' && v.trim().length > 0) as string[]
  } catch {
    return []
  }
}

const parseVolcengineCredentials = () => {
  const accessKey =
    process.env.VOLCENGINE_ACCESS_KEY ??
    process.env.VOLC_ACCESSKEY ??
    process.env.VOLC_ACCESS_KEY ??
    process.env.VOLC_ACCESS_KEY_ID
  const secretKey =
    process.env.VOLCENGINE_SECRET_KEY ??
    process.env.VOLC_SECRETKEY ??
    process.env.VOLC_SECRET_KEY ??
    process.env.VOLC_SECRET_ACCESS_KEY
  if (!accessKey || !secretKey) return null
  const trimmedAccessKey = accessKey.trim()
  const trimmedSecretKey = secretKey.trim()
  if (!trimmedAccessKey || !trimmedSecretKey) return null
  return { accessKey: trimmedAccessKey, secretKey: trimmedSecretKey }
}

const parseVolcengineRegion = () => {
  const raw = process.env.VOLCENGINE_REGION
  return raw && raw.trim().length > 0 ? raw.trim() : 'cn-beijing'
}

const parseSandboxTimeoutMinutes = () => {
  const raw = process.env.SANDBOX_TIMEOUT_MINUTES
  const parsed = raw ? Number.parseInt(raw, 10) : 60
  if (!Number.isFinite(parsed) || parsed <= 0) return 60
  return parsed
}

const extractSandboxId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const candidates = [
    obj.SandboxId,
    obj.SandboxID,
    obj.Id,
    obj.ID,
    (obj.Result && typeof obj.Result === 'object' ? (obj.Result as any).SandboxId : undefined),
    (obj.Result && typeof obj.Result === 'object' ? (obj.Result as any).SandboxID : undefined),
    (obj.Result && typeof obj.Result === 'object' ? (obj.Result as any).Id : undefined),
    (obj.Result && typeof obj.Result === 'object' ? (obj.Result as any).ID : undefined)
  ]
  for (const entry of candidates) {
    if (typeof entry === 'string' && entry.trim().length > 0) return entry.trim()
  }
  return null
}

const extractDomains = (value: unknown): Array<{ domain: string; type?: string }> => {
  if (!value || typeof value !== 'object') return []
  const obj = value as any
  const domains = obj?.Result?.domains
  if (!Array.isArray(domains)) return []
  return domains
    .map((d: any) => ({
      domain: typeof d?.domain === 'string' ? d.domain : '',
      type: typeof d?.type === 'string' ? d.type : undefined
    }))
    .filter((d: any) => d.domain && d.domain.length > 0)
}

const pickSandboxBaseUrl = (domains: Array<{ domain: string; type?: string }>) => {
  const publicDomain =
    domains.find((d) => (d.type ?? '').toLowerCase() === 'public') ??
    domains.find((d) => (d.type ?? '').toLowerCase() === 'outer') ??
    domains.find((d) => d.domain.startsWith('https://') || d.domain.startsWith('http://')) ??
    null
  return publicDomain?.domain ?? null
}

const getVolcengineProvider = (() => {
  let cached: providers.VolcengineProvider | null | undefined
  return () => {
    if (cached !== undefined) return cached
    const credentials = parseVolcengineCredentials()
    if (!credentials) {
      cached = null
      return cached
    }
    cached = new providers.VolcengineProvider({
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
      region: parseVolcengineRegion()
    })
    return cached
  }
})()

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

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

const getFreePort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

const runDocker = (args: string[]) => {
  const result = spawnSync('docker', args, { encoding: 'utf-8' })
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim()
    const stdout = (result.stdout ?? '').toString().trim()
    const details = stderr || stdout || 'docker command failed'
    throw new Error(details)
  }
  return (result.stdout ?? '').toString().trim()
}

export const isSandboxLifecycleEnabled = () => {
  if (!parseSandboxLifecycleEnabled()) return false
  return parseSandboxProvider() !== null
}

export const createSandboxForThread = async (threadId: string): Promise<ThreadSandboxState> => {
  const provider = parseSandboxProvider()
  if (!parseSandboxLifecycleEnabled() || !provider) {
    throw new Error('Sandbox lifecycle is disabled')
  }
  if (provider === 'local') {
    const baseUrl = parseSandboxLocalBaseUrl()
    if (!baseUrl) {
      throw new Error('SANDBOX_LOCAL_BASE_URL (or SANDBOX_API_URL) is required for local sandbox lifecycle')
    }
    const sandboxId = threadId
    const url = new URL(baseUrl)
    url.searchParams.set('faasInstanceName', sandboxId)
    const instanceUrl = url.toString()
    return {
      provider: 'local',
      sandboxId,
      apiUrl: instanceUrl,
      uiUrl: instanceUrl,
      createdAt: Date.now()
    }
  }
  if (provider === 'docker') {
    const image = parseDockerImage()
    if (!image) {
      throw new Error('SANDBOX_DOCKER_IMAGE is required for docker sandbox lifecycle')
    }
    const host = parseDockerHost()
    const containerPort = parseDockerContainerPort()
    const extraArgs = parseDockerExtraArgs()
    const name = `${parseDockerNamePrefix()}-${threadId}`
    const hostPort = await getFreePort()
    const args = ['run', '-d', '--rm', '--name', name, '-p', `${hostPort}:${containerPort}`]
    if (parseDockerMountData()) {
      const baseDir = path.join(resolveStorageDir(), 'threads', threadId, 'user-data')
      ensureDir(baseDir)
      args.push('-v', `${baseDir}:/tmp/user-data`)
    }
    args.push(...extraArgs, image)
    runDocker(args)
    const baseUrl = `http://${host}:${hostPort}`
    return {
      provider: 'docker',
      sandboxId: name,
      apiUrl: baseUrl,
      uiUrl: baseUrl,
      createdAt: Date.now()
    }
  }

  if (provider !== 'volcengine') {
    throw new Error(`Unsupported sandbox provider: ${provider}`)
  }
  const functionId = parseSandboxFunctionId()
  if (!functionId) {
    throw new Error('SANDBOX_FUNCTION_ID is required for sandbox lifecycle')
  }
  const volc = getVolcengineProvider()
  if (!volc) {
    throw new Error('Volcengine credentials missing')
  }
  const timeoutMinutes = parseSandboxTimeoutMinutes()
  const createResult = await volc.createSandbox(functionId, timeoutMinutes, {
    metadata: { threadId }
  })
  const sandboxId = extractSandboxId(createResult)
  if (!sandboxId) {
    throw new Error(`Failed to create sandbox: ${JSON.stringify(createResult)}`)
  }
  const sandboxInfo = await volc.getSandbox(functionId, sandboxId)
  const baseUrl = pickSandboxBaseUrl(extractDomains(sandboxInfo))
  if (!baseUrl) {
    throw new Error(`Sandbox created but no domain available: ${JSON.stringify(sandboxInfo)}`)
  }
  return {
    provider: 'volcengine',
    functionId,
    sandboxId,
    apiUrl: baseUrl,
    uiUrl: baseUrl,
    createdAt: Date.now()
  }
}

export const destroySandboxForThread = async (sandbox: ThreadSandboxState) => {
  if (!parseSandboxLifecycleEnabled()) return
  if (sandbox.provider === 'local') return
  if (sandbox.provider === 'docker') {
    try {
      runDocker(['rm', '-f', sandbox.sandboxId])
    } catch {
    }
    return
  }
  if (sandbox.provider !== 'volcengine') return
  const volc = getVolcengineProvider()
  if (!volc) return
  try {
    if (typeof sandbox.functionId === 'string' && sandbox.functionId.trim().length > 0) {
      await volc.deleteSandbox(sandbox.functionId, sandbox.sandboxId)
    }
  } catch {
  }
}
