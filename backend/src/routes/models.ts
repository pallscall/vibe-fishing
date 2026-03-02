import { Hono } from 'hono'
import { getModelConfigs } from '../config/models'

export const modelsRoute = new Hono()

modelsRoute.get('/', (c) => {
  try {
    const models = getModelConfigs().map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider ?? model.protocol,
      protocol: model.protocol
    }))
    return c.json({ models })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('models list error', { message })
    return c.json({ error: message }, 500)
  }
})
