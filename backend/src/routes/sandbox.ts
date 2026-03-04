import { Hono } from 'hono'
import { getThread, updateThreadSandbox } from '../store/threads'
import { createSandboxForThread, isSandboxLifecycleEnabled } from '../sandbox/lifecycle'

export const sandboxRoute = new Hono()

const toOrigin = (raw: string) => {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

sandboxRoute.get('/info', async (c) => {
  // If threadId is provided and the thread has a dedicated sandbox, prefer that sandbox's UI/API.
  const threadId = c.req.query('threadId')
  if (threadId) {
    const thread = getThread(threadId)
    if (thread) {
      if (!thread.sandbox && isSandboxLifecycleEnabled()) {
        try {
          const sandbox = await createSandboxForThread(threadId)
          updateThreadSandbox(threadId, sandbox)
        } catch {
        }
      }
      const refreshed = getThread(threadId)
      const sandbox = refreshed?.sandbox
      if (sandbox?.uiUrl && sandbox.apiUrl) {
        return c.json({
          enabled: true,
          apiUrl: sandbox.apiUrl,
          uiUrl: sandbox.uiUrl
        })
      }
    }
  }
  const apiUrlRaw = process.env.SANDBOX_API_URL ?? process.env.SANDBOX_API_ENVIRONMENT ?? ''
  const apiUrl = apiUrlRaw.trim().length > 0 ? apiUrlRaw.trim() : null
  const uiUrlRaw = process.env.SANDBOX_UI_URL ?? ''
  const uiUrl = uiUrlRaw.trim().length > 0 ? uiUrlRaw.trim() : apiUrl ? toOrigin(apiUrl) : null

  return c.json({
    enabled: Boolean(apiUrl),
    apiUrl,
    uiUrl
  })
})
