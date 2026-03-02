import { BASH_SUBAGENT } from './bash'
import { GENERAL_PURPOSE_SUBAGENT } from './generalPurpose'

export const BUILTIN_SUBAGENTS = {
  'general-purpose': GENERAL_PURPOSE_SUBAGENT,
  bash: BASH_SUBAGENT
} as const

export const listSubagents = () => Object.values(BUILTIN_SUBAGENTS)
export const getSubagentConfig = (name: string) =>
  (BUILTIN_SUBAGENTS as Record<string, (typeof BUILTIN_SUBAGENTS)[keyof typeof BUILTIN_SUBAGENTS]>)[name] ?? null
