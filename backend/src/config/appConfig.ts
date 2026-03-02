import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  protocol: z.enum(['openai', 'openai_compatible', 'anthropic']),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  apiKey: z.string().optional(),
  supportsThinking: z.boolean().optional(),
  whenThinkingEnabled: z.record(z.any()).optional()
})

const ChatConfigSchema = z.object({
  requestTimeoutMs: z.number().int().positive().optional(),
  streamIdleTimeoutMs: z.number().int().positive().optional(),
  contextMaxMessages: z.number().int().positive().optional(),
  summaryEnabled: z.boolean().optional(),
  summaryTriggerMessages: z.number().int().positive().optional(),
  summaryKeepMessages: z.number().int().positive().optional(),
  thinkingSummaryEnabled: z.boolean().optional(),
  autoSkillEnabled: z.boolean().optional(),
  mcpEnabled: z.boolean().optional()
})

const AppConfigSchema = z.object({
  env: z.record(z.string()).optional(),
  chat: ChatConfigSchema.optional(),
  models: z.array(ModelConfigSchema)
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type AppModelConfig = z.infer<typeof ModelConfigSchema>

const resolveConfigPath = () => {
  const configured = process.env.VIBE_FISHING_CONFIG_PATH
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), 'config.yaml')
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

const applyConfigEnv = (env: Record<string, string>) => {
  Object.entries(env).forEach(([key, value]) => {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  })
}

let cachedConfig: AppConfig | null = null

export const loadAppConfig = (): AppConfig | null => {
  if (cachedConfig) return cachedConfig
  const configPath = resolveConfigPath()
  if (!fs.existsSync(configPath)) return null
  const raw = fs.readFileSync(configPath, 'utf-8')
  const yaml = require('yaml') as { parse: (input: string) => unknown }
  const parsed = yaml.parse(raw) as unknown
  const resolved = resolveEnvValues(parsed)
  const config = AppConfigSchema.parse(resolved)
  if (config.env) {
    applyConfigEnv(config.env)
  }
  cachedConfig = config
  return config
}
