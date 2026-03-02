import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { ensureThreadData } from '../sandbox/threadData'

const sanitizeFileName = (name: string) => {
  return name.replace(/[^\w.\-]+/g, '_')
}

export const uploadsRoute = new Hono()

uploadsRoute.post('/', async (c) => {
  const threadId = c.req.query('threadId')
  if (!threadId) {
    return c.json({ error: 'threadId is required' }, 400)
  }
  return handleUpload(c, threadId)
})

uploadsRoute.post('/:threadId', async (c) => {
  const threadId = c.req.param('threadId')
  if (!threadId) {
    return c.json({ error: 'threadId is required' }, 400)
  }
  return handleUpload(c, threadId)
})

uploadsRoute.get('/:threadId', (c) => {
  const threadId = c.req.param('threadId')
  if (!threadId) {
    return c.json({ error: 'threadId is required' }, 400)
  }
  const { uploadsPath } = ensureThreadData(threadId)
  if (!fs.existsSync(uploadsPath)) return c.json({ files: [] })
  const entries = fs.readdirSync(uploadsPath, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      path: path.join(uploadsPath, entry.name),
      virtual_path: `/mnt/user-data/uploads/${entry.name}`,
      url: `/uploads/${threadId}/${encodeURIComponent(entry.name)}`
    }))
  return c.json({ files })
})

uploadsRoute.get('/:threadId/:fileName', (c) => {
  const threadId = c.req.param('threadId')
  const fileName = sanitizeFileName(c.req.param('fileName') ?? '')
  if (!threadId || !fileName) {
    return c.json({ error: 'threadId and fileName are required' }, 400)
  }
  const { uploadsPath } = ensureThreadData(threadId)
  const filePath = path.join(uploadsPath, fileName)
  if (!fs.existsSync(filePath)) {
    return c.json({ error: 'File not found' }, 404)
  }
  const content = fs.readFileSync(filePath)
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(content.length)
    }
  })
})

const handleUpload = async (c: any, threadId: string) => {
  const form = await c.req.formData()
  const files = form.getAll('files')
  if (!files.length) {
    return c.json({ error: 'No files uploaded' }, 400)
  }
  const { uploadsPath } = ensureThreadData(threadId)
  const saved = []
  for (const item of files) {
    if (!(item instanceof File)) continue
    const safeName = sanitizeFileName(item.name || `upload-${Date.now()}`)
    const buffer = Buffer.from(await item.arrayBuffer())
    const filePath = path.join(uploadsPath, safeName)
    fs.writeFileSync(filePath, buffer)
    saved.push({
      name: safeName,
      size: buffer.length,
      path: filePath,
      virtual_path: `/mnt/user-data/uploads/${safeName}`,
      url: `/uploads/${threadId}/${encodeURIComponent(safeName)}`
    })
  }
  return c.json({ files: saved })
}
