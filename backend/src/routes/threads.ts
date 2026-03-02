import { Hono } from 'hono'
import { z } from 'zod'
import { appendMessage, createThread, deleteThread, getThread, listThreads } from '../store/threads'
import { deleteArtifacts } from '../store/artifacts'
import { deleteThreadData } from '../sandbox/threadData'
import { randomUUID } from 'node:crypto'

export const threadsRoute = new Hono()

threadsRoute.get('/', (c) => {
  try {
    const threads = listThreads().map((thread) => ({
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt
    }))
    return c.json({ threads })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('threads list error', { message })
    return c.json({ error: message }, 500)
  }
})

threadsRoute.post('/', (c) => {
  try {
    const thread = createThread()
    return c.json(thread)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('threads create error', { message })
    return c.json({ error: message }, 500)
  }
})

threadsRoute.get('/:threadId', (c) => {
  try {
    const threadId = c.req.param('threadId')
    const thread = getThread(threadId)
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404)
    }
    return c.json(thread)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('threads get error', { message })
    return c.json({ error: message }, 500)
  }
})

threadsRoute.delete('/:threadId', (c) => {
  try {
    const threadId = c.req.param('threadId')
    const deleted = deleteThread(threadId)
    if (!deleted) {
      return c.json({ error: 'Thread not found' }, 404)
    }
    deleteArtifacts(threadId)
    deleteThreadData(threadId)
    return c.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('threads delete error', { message })
    return c.json({ error: message }, 500)
  }
})

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1)
})

threadsRoute.post('/:threadId/messages', async (c) => {
  try {
    const threadId = c.req.param('threadId')
    const body = MessageSchema.parse(await c.req.json())
    const message = {
      id: randomUUID(),
      role: body.role,
      content: body.content,
      createdAt: Date.now()
    }
    const thread = appendMessage(threadId, message)
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404)
    }
    return c.json(thread)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('threads append message error', { message })
    return c.json({ error: message }, 500)
  }
})
