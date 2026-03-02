import { Hono } from 'hono'

export const memoryRoute = new Hono()

memoryRoute.get('/', (c) => {
  return c.json({
    memories: []
  })
})
