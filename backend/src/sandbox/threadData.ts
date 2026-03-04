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

const shouldAvoidLocalUserData = () => {
  const lifecycle = process.env.SANDBOX_PER_THREAD_LIFECYCLE
  if (lifecycle && lifecycle.toLowerCase() === 'true') return true
  const apiUrl = process.env.SANDBOX_API_URL ?? process.env.SANDBOX_API_ENVIRONMENT
  return Boolean(apiUrl && apiUrl.trim().length > 0)
}

export const ensureThreadData = (threadId: string): ThreadData => {
  const rootPath = path.resolve(process.cwd(), 'storage', 'threads', threadId, 'user-data')
  const workspacePath = path.join(rootPath, 'workspace')
  const uploadsPath = path.join(rootPath, 'uploads')
  const outputsPath = path.join(rootPath, 'outputs')
  if (!shouldAvoidLocalUserData()) {
    ensureDir(workspacePath)
    ensureDir(uploadsPath)
    ensureDir(outputsPath)
  }
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
