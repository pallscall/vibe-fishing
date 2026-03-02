import { callMcpTool, listMcpTools } from './client'
import { getEnabledMcpServers, loadMcpConfig, McpServerConfig } from './config'

export type McpToolDefinition = {
  name: string
  description?: string
  parameters: Record<string, unknown>
  serverName: string
  toolName: string
}

export type OpenAiToolDefinition = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export const loadMcpToolset = async () => {
  const config = loadMcpConfig()
  const servers = getEnabledMcpServers(config)
  const tools: OpenAiToolDefinition[] = []
  const toolMap = new Map<string, { serverName: string; toolName: string; server: McpServerConfig }>()
  for (const [serverName, server] of servers) {
    const list = await listMcpTools(server)
    list.forEach((tool) => {
      const fullName = `${serverName}__${tool.name}`
      const parameters = (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
      tools.push({
        type: 'function',
        function: {
          name: fullName,
          description: tool.description ?? `${serverName}: ${tool.name}`,
          parameters
        }
      })
      toolMap.set(fullName, { serverName, toolName: tool.name, server })
    })
  }
  return { tools, toolMap }
}

export const executeMcpTool = async (
  toolMap: Map<string, { serverName: string; toolName: string; server: McpServerConfig }>,
  toolName: string,
  args: Record<string, unknown>
) => {
  const entry = toolMap.get(toolName)
  if (!entry) {
    throw new Error(`MCP tool not found: ${toolName}`)
  }
  return callMcpTool(entry.server, entry.toolName, args)
}
