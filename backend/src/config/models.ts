import { loadAppConfig, type AppModelConfig } from './appConfig'

export type ModelConfig = AppModelConfig

const defaultConfigs: ModelConfig[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    protocol: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY'
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    protocol: 'anthropic',
    model: 'claude-3-5-sonnet',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY'
  }
]

export const getModelConfigs = (): ModelConfig[] => {
  const config = loadAppConfig()
  if (config?.models?.length) return config.models
  return defaultConfigs
}

export const findModelConfig = (id: string) => {
  return getModelConfigs().find((model) => model.id === id)
}
