import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { modelsRoute } from './routes/models'
import { mcpRoute } from './routes/mcp'
import { memoryRoute } from './routes/memory'
import { skillsRoute } from './routes/skills'
import { artifactsRoute } from './routes/artifacts'
import { uploadsRoute } from './routes/uploads'
import { chatRoute } from './routes/chat'
import { threadsRoute } from './routes/threads'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'vibe-fishing-backend-ts' })
})

app.route('/models', modelsRoute)
app.route('/mcp', mcpRoute)
app.route('/memory', memoryRoute)
app.route('/skills', skillsRoute)
app.route('/artifacts', artifactsRoute)
app.route('/uploads', uploadsRoute)
app.route('/chat', chatRoute)
app.route('/threads', threadsRoute)

const rawPort = process.env.PORT
const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : NaN
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8000
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})
