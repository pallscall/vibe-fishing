import fs from 'node:fs'
import path from 'node:path'

export interface TextArtifact {
  name: string
  size: number
  url: string
}

const resolveArtifactsDir = () => {
  return path.resolve(process.cwd(), 'storage', 'artifacts')
}

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

const sanitizeFileName = (name: string) => {
  return name.replace(/[^\w.\-]+/g, '_')
}

export const saveTextArtifact = (threadId: string, fileName: string | undefined, content: string) => {
  const rawName = fileName && fileName.trim() ? fileName.trim() : `response-${Date.now()}`
  const sanitized = sanitizeFileName(rawName)
  const safeName = path.extname(sanitized) ? sanitized : `${sanitized}.md`
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  ensureDir(threadDir)
  const filePath = path.join(threadDir, safeName)
  fs.writeFileSync(filePath, content, 'utf-8')
  const size = fs.statSync(filePath).size
  return {
    name: safeName,
    size,
    url: `/artifacts/${threadId}/${encodeURIComponent(safeName)}`
  }
}

export const saveFileArtifact = (threadId: string, sourcePath: string) => {
  const baseName = path.basename(sourcePath)
  const safeName = sanitizeFileName(baseName)
  if (!safeName) {
    throw new Error('Invalid artifact file name')
  }
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  ensureDir(threadDir)
  const targetPath = path.join(threadDir, safeName)
  fs.copyFileSync(sourcePath, targetPath)
  const size = fs.statSync(targetPath).size
  return {
    name: safeName,
    size,
    url: `/artifacts/${threadId}/${encodeURIComponent(safeName)}`
  }
}

export const listArtifacts = (threadId: string): TextArtifact[] => {
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  if (!fs.existsSync(threadDir)) return []
  const entries = fs.readdirSync(threadDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(threadDir, entry.name)
      const size = fs.statSync(filePath).size
      return {
        name: entry.name,
        size,
        url: `/artifacts/${threadId}/${encodeURIComponent(entry.name)}`
      }
    })
}

export const readArtifact = (threadId: string, fileName: string) => {
  const safeName = sanitizeFileName(fileName)
  if (!safeName) return null
  const baseDir = resolveArtifactsDir()
  const filePath = path.join(baseDir, threadId, safeName)
  if (!fs.existsSync(filePath)) return null
  return {
    name: safeName,
    content: fs.readFileSync(filePath),
    size: fs.statSync(filePath).size
  }
}

export const deleteArtifacts = (threadId: string) => {
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  if (!fs.existsSync(threadDir)) return
  fs.rmSync(threadDir, { recursive: true, force: true })
}
