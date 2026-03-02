import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const McpServerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  description: z.string().optional()
})

const McpConfigSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema).optional()
})

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpConfig = z.infer<typeof McpConfigSchema>

const resolveConfigPath = () => {
  const configured = process.env.MCP_CONFIG_PATH
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), 'mcp_config.json')
}

const resolveEnvString = (value: string) => {
  return value.replace(/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/g, (_, braceKey, plainKey) => {
    const key = braceKey ?? plainKey
    return process.env[key] ?? ''
  })
}

const resolveEnvValues = (input: unknown): unknown => {
  if (typeof input === 'string') {
    return resolveEnvString(input)
  }
  if (Array.isArray(input)) {
    return input.map((item) => resolveEnvValues(item))
  }
  if (input && typeof input === 'object') {
    const result: Record<string, unknown> = {}
    Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
      result[key] = resolveEnvValues(value)
    })
    return result
  }
  return input
}

export const loadMcpConfig = (): McpConfig => {
  const configPath = resolveConfigPath()
  if (!fs.existsSync(configPath)) {
    return { mcpServers: {} }
  }
  const raw = fs.readFileSync(configPath, 'utf-8')
  const parsed = JSON.parse(raw) as unknown
  const resolved = resolveEnvValues(parsed)
  const config = McpConfigSchema.parse(resolved)
  return { mcpServers: config.mcpServers ?? {} }
}

export const saveMcpConfig = (config: McpConfig) => {
  const configPath = resolveConfigPath()
  const payload = {
    mcpServers: config.mcpServers ?? {}
  }
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2))
}

export const getEnabledMcpServers = (config: McpConfig) => {
  const servers = config.mcpServers ?? {}
  return Object.entries(servers).filter(([, server]) => server.enabled !== false)
}
