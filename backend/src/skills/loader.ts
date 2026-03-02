import fs from 'node:fs'
import path from 'node:path'

import { loadSkillsState } from './state'

export interface SkillDefinition {
  id: string
  name: string
  description?: string
  license?: string
  category: 'public' | 'custom'
  filePath: string
  content: string
  enabled: boolean
}

export const resolveSkillsPath = () => {
  const configured = process.env.SKILLS_PATH
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  }
  return path.resolve(process.cwd(), '..', 'skills')
}

const parseFrontmatter = (raw: string) => {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const frontmatter = raw.slice(3, end).trim()
  const body = raw.slice(end + 3).trim()
  const meta: Record<string, string> = {}
  frontmatter.split('\n').forEach((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) return
    meta[match[1]] = match[2].trim()
  })
  return { meta, body }
}

const readSkillFile = (filePath: string) => {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { meta } = parseFrontmatter(raw)
  return {
    name: meta.name ?? path.basename(path.dirname(filePath)),
    description: meta.description,
    license: meta.license,
    content: raw
  }
}

export const loadSkills = () => {
  const skillsPath = resolveSkillsPath()
  const results: SkillDefinition[] = []
  const state = loadSkillsState()
  if (!fs.existsSync(skillsPath)) return results
  const scanCategory = (categoryPath: string) => {
    const entries = fs.readdirSync(categoryPath, { withFileTypes: true })
    entries.forEach((entry) => {
      if (!entry.isDirectory()) return
      const skillDir = path.join(categoryPath, entry.name)
      const skillFile = path.join(skillDir, 'SKILL.md')
      if (!fs.existsSync(skillFile)) return
      const parsed = readSkillFile(skillFile)
      const enabled = state[parsed.name]?.enabled ?? true
      results.push({
        id: parsed.name,
        name: parsed.name,
        description: parsed.description,
        license: parsed.license,
        category: 'public',
        filePath: skillFile,
        content: parsed.content,
        enabled
      })
    })
  }
  scanCategory(skillsPath)
  const sorted = results.sort((a, b) => a.name.localeCompare(b.name))
  console.info('skills_loaded', {
    skillsPath,
    total: sorted.length,
    enabled: sorted.filter((skill) => skill.enabled).length
  })
  return sorted
}

export const getSkillByName = (name: string) => {
  const skills = loadSkills()
  return skills.find((skill) => skill.name === name || skill.id === name) ?? null
}
