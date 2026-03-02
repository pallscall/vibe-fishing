import type { SubagentConfig } from './config'
import { BUILTIN_SUBAGENTS } from './builtins'

export const getSubagentConfig = (name: string): SubagentConfig | null => {
  return (
    (BUILTIN_SUBAGENTS as Record<string, (typeof BUILTIN_SUBAGENTS)[keyof typeof BUILTIN_SUBAGENTS]>)[name] ?? null
  )
}

export const listSubagents = (): SubagentConfig[] => {
  return Object.values(BUILTIN_SUBAGENTS) as SubagentConfig[]
}

export const getSubagentNames = (): string[] => {
  return Object.keys(BUILTIN_SUBAGENTS)
}

