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

const sanitizePathSegment = (segment: string) => {
  return segment.replace(/[^\w.\-]+/g, '_')
}

const sanitizeRelativePath = (raw: string) => {
  const normalized = raw.replaceAll('\\', '/').trim()
  if (!normalized) return ''
  const stripped = normalized.replace(/^\/+/, '')
  const parts = stripped
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '.' && p !== '..')
    .map((p) => sanitizePathSegment(p))
    .filter((p) => p.length > 0)
  return parts.join('/')
}

const resolveThreadPath = (threadId: string, relativePath: string) => {
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  const safeRel = sanitizeRelativePath(relativePath)
  if (!safeRel) {
    throw new Error('Invalid artifact path')
  }
  const target = path.join(threadDir, ...safeRel.split('/'))
  const resolvedThreadDir = path.resolve(threadDir) + path.sep
  const resolvedTarget = path.resolve(target)
  if (!resolvedTarget.startsWith(resolvedThreadDir)) {
    throw new Error('Invalid artifact path')
  }
  return { threadDir, safeRel, targetPath: target }
}

export const saveTextArtifact = (threadId: string, fileName: string | undefined, content: string) => {
  const rawName = fileName && fileName.trim() ? fileName.trim() : `response-${Date.now()}`
  const sanitized = sanitizeRelativePath(rawName)
  const safeName = path.extname(sanitized) ? sanitized : `${sanitized}.md`
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  ensureDir(path.join(threadDir, path.dirname(safeName)))
  const filePath = path.join(threadDir, ...safeName.split('/'))
  fs.writeFileSync(filePath, content, 'utf-8')
  const size = fs.statSync(filePath).size
  return {
    name: safeName,
    size,
    url: `/artifacts/${threadId}/${encodeURIComponent(safeName)}`
  }
}

export const saveFileArtifact = (threadId: string, sourcePath: string, artifactPath?: string) => {
  const fallbackName = path.basename(sourcePath)
  const desired = typeof artifactPath === 'string' && artifactPath.trim().length > 0 ? artifactPath : fallbackName
  const safeName = sanitizeRelativePath(desired)
  const { threadDir, safeRel, targetPath } = resolveThreadPath(threadId, safeName)
  ensureDir(path.join(threadDir, path.dirname(safeRel)))
  fs.copyFileSync(sourcePath, targetPath)
  const size = fs.statSync(targetPath).size
  return {
    name: safeRel,
    size,
    url: `/artifacts/${threadId}/${encodeURIComponent(safeRel)}`
  }
}

export const listArtifacts = (threadId: string): TextArtifact[] => {
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  if (!fs.existsSync(threadDir)) return []
  const results: TextArtifact[] = []
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(full, rel)
        continue
      }
      if (!entry.isFile()) continue
      const size = fs.statSync(full).size
      results.push({
        name: rel,
        size,
        url: `/artifacts/${threadId}/${encodeURIComponent(rel)}`
      })
    }
  }
  walk(threadDir, '')
  return results
}

export const readArtifact = (threadId: string, fileName: string) => {
  let resolved: { targetPath: string; safeRel: string }
  try {
    const out = resolveThreadPath(threadId, fileName)
    resolved = { targetPath: out.targetPath, safeRel: out.safeRel }
  } catch {
    return null
  }
  if (!fs.existsSync(resolved.targetPath)) return null
  return {
    name: resolved.safeRel,
    content: fs.readFileSync(resolved.targetPath),
    size: fs.statSync(resolved.targetPath).size
  }
}

export const deleteArtifacts = (threadId: string) => {
  const baseDir = resolveArtifactsDir()
  const threadDir = path.join(baseDir, threadId)
  if (!fs.existsSync(threadDir)) return
  fs.rmSync(threadDir, { recursive: true, force: true })
}
