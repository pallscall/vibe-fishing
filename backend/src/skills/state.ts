import fs from 'node:fs'
import path from 'node:path'

export type SkillsState = Record<string, { enabled: boolean }>

const resolveSkillsStatePath = () => {
  const configured = process.env.SKILLS_STATE_PATH
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), 'storage', 'skills_state.json')
}

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export const loadSkillsState = (): SkillsState => {
  const filePath = resolveSkillsStatePath()
  if (!fs.existsSync(filePath)) return {}
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as SkillsState
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

export const saveSkillsState = (state: SkillsState) => {
  const filePath = resolveSkillsStatePath()
  ensureDir(filePath)
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

export const setSkillEnabled = (skillId: string, enabled: boolean) => {
  const state = loadSkillsState()
  state[skillId] = { enabled }
  saveSkillsState(state)
  return state[skillId]
}

