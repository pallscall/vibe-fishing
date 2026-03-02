import { Hono } from 'hono'
import { z } from 'zod'
import { getSkillByName, loadSkills } from '../skills/loader'
import { setSkillEnabled } from '../skills/state'

export const skillsRoute = new Hono()

skillsRoute.get('/', (c) => {
  try {
    const skills = loadSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      license: skill.license,
      category: skill.category,
      enabled: skill.enabled
    }))
    return c.json({ skills })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('skills list error', { message })
    return c.json({ error: message }, 500)
  }
})

const SkillInvokeSchema = z.object({
  skillId: z.string().min(1)
})

skillsRoute.post('/invoke', async (c) => {
  try {
    const body = SkillInvokeSchema.parse(await c.req.json())
    const skill = getSkillByName(body.skillId)
    if (!skill) {
      return c.json({ error: 'Skill not found', skillId: body.skillId }, 404)
    }
    return c.json({
      id: skill.id,
      name: skill.name,
      content: skill.content
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('skills invoke error', { message })
    return c.json({ error: message }, 500)
  }
})

const SkillStateSchema = z.object({
  enabled: z.boolean()
})

skillsRoute.put('/:skillId', async (c) => {
  try {
    const skillId = c.req.param('skillId')
    const body = SkillStateSchema.parse(await c.req.json())
    const skill = getSkillByName(skillId)
    if (!skill) {
      return c.json({ error: 'Skill not found', skillId }, 404)
    }
    setSkillEnabled(skillId, body.enabled)
    return c.json({
      id: skill.id,
      name: skill.name,
      enabled: body.enabled
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.errors }, 400)
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('skills update error', { message })
    return c.json({ error: message }, 500)
  }
})
