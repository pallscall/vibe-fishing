import { Hono } from 'hono'
import { z } from 'zod'
import { loadMcpConfig, saveMcpConfig, type McpServerConfig } from '../mcp/config'
import { listMcpTools } from '../mcp/client'

export const mcpRoute = new Hono()

const McpServerSchema = z.object({
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
  mcpServers: z.record(McpServerSchema)
})

mcpRoute.get('/config', (c) => {
  const config = loadMcpConfig()
  return c.json({ mcpServers: config.mcpServers ?? {} })
})

mcpRoute.put('/config', async (c) => {
  try {
    const body = McpConfigSchema.parse(await c.req.json())
    const entries = Object.entries(body.mcpServers ?? {})
    for (const [name, server] of entries) {
      if (server.enabled === false) continue
      try {
        await listMcpTools(server as McpServerConfig)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('mcp validate failed', { server: name, error: message })
        return c.json({ error: 'MCP server unreachable', server: name, details: message }, 400)
      }
    }
    saveMcpConfig(body)
    return c.json({ status: 'updated', mcpServers: body.mcpServers })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})
