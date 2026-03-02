import { Hono } from 'hono'
import archiver from 'archiver'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { listArtifacts, readArtifact } from '../store/artifacts'

export const artifactsRoute = new Hono()

artifactsRoute.get('/:threadId', (c) => {
  const threadId = c.req.param('threadId')
  return c.json({
    threadId,
    artifacts: listArtifacts(threadId)
  })
})

artifactsRoute.get('/:threadId/download', (c) => {
  const threadId = c.req.param('threadId')
  const artifactsDir = path.resolve(process.cwd(), 'storage', 'artifacts', threadId)
  if (!fs.existsSync(artifactsDir)) {
    return c.json({ error: 'Artifacts not found' }, 404)
  }
  const archive = archiver('zip', { zlib: { level: 9 } })
  const stream = new PassThrough()
  archive.on('error', (error: Error) => {
    stream.destroy(error)
  })
  archive.pipe(stream)
  archive.directory(artifactsDir, false)
  archive.finalize()
  const filename = `artifacts-${threadId}.zip`
  const webStream = Readable.toWeb(stream) as ReadableStream
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  })
})

artifactsRoute.get('/:threadId/:fileName', (c) => {
  const threadId = c.req.param('threadId')
  const fileName = decodeURIComponent(c.req.param('fileName'))
  const artifact = readArtifact(threadId, fileName)
  if (!artifact) {
    return c.json({ error: 'Artifact not found' }, 404)
  }
  const ext = path.extname(artifact.name).toLowerCase()
  const mimeType =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.htm'
        ? 'text/html; charset=utf-8'
        : ext === '.md' || ext === '.markdown'
        ? 'text/markdown; charset=utf-8'
        : ext === '.json'
          ? 'application/json; charset=utf-8'
          : ext === '.txt' || ext === '.log' || ext === '.csv'
            ? 'text/plain; charset=utf-8'
            : ext === '.xml'
              ? 'application/xml; charset=utf-8'
              : ext === '.png'
                ? 'image/png'
                : ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : ext === '.gif'
                    ? 'image/gif'
                    : ext === '.webp'
                      ? 'image/webp'
                      : ext === '.svg'
                        ? 'image/svg+xml'
                        : ext === '.pdf'
                          ? 'application/pdf'
                          : ext === '.mp4'
                            ? 'video/mp4'
                            : ext === '.webm'
                              ? 'video/webm'
                              : 'application/octet-stream'
  const download = c.req.query('download') === 'true'
  const contentDisposition = download
    ? `attachment; filename="${artifact.name}"`
    : `inline; filename="${artifact.name}"`
  return new Response(artifact.content, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(artifact.size),
      'Content-Disposition': contentDisposition
    }
  })
})
