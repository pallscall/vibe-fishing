export type SubagentConfig = {
  name: string
  description: string
  systemPrompt: string
  tools?: string[] | null
  disallowedTools?: string[] | null
  maxTurns?: number
  timeoutMs?: number
}

