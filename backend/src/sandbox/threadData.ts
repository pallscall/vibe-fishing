import fs from 'node:fs'
import path from 'node:path'

export type ThreadData = {
  rootPath: string
  workspacePath: string
  uploadsPath: string
  outputsPath: string
}

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export const ensureThreadData = (threadId: string): ThreadData => {
  const rootPath = path.resolve(process.cwd(), 'storage', 'threads', threadId, 'user-data')
  const workspacePath = path.join(rootPath, 'workspace')
  const uploadsPath = path.join(rootPath, 'uploads')
  const outputsPath = path.join(rootPath, 'outputs')
  ensureDir(workspacePath)
  ensureDir(uploadsPath)
  ensureDir(outputsPath)
  return { rootPath, workspacePath, uploadsPath, outputsPath }
}

export const deleteThreadData = (threadId: string) => {
  const rootPath = path.resolve(process.cwd(), 'storage', 'threads', threadId)
  if (!fs.existsSync(rootPath)) return
  fs.rmSync(rootPath, { recursive: true, force: true })
}

export const getSkillsContainerPath = () => {
  return process.env.SKILLS_CONTAINER_PATH ?? '/mnt/skills'
}
