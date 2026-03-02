'use client'

import useSWR from 'swr'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type McpServer = {
  enabled?: boolean
  type?: string
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  description?: string
  env?: Record<string, string>
}

type McpConfigResponse = {
  mcpServers: Record<string, McpServer>
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

type McpServerDraft = {
  name: string
  description: string
  json: string
}

const toDraft = (name: string, server?: McpServer): McpServerDraft => ({
  name,
  description: server?.description ?? '',
  json: JSON.stringify(server ?? {}, null, 2)
})

const parseJson = (value: string) => {
  if (!value.trim()) return { ok: true, data: {} }
  try {
    return { ok: true, data: JSON.parse(value) as unknown }
  } catch (error) {
    return { ok: false, data: {}, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

const extractServerConfig = (name: string, parsed: unknown) => {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: true, data: parsed as McpServer }
  }
  const record = parsed as Record<string, unknown>
  const maybeServers = record.mcpServers
  if (!maybeServers || typeof maybeServers !== 'object') {
    return { ok: true, data: parsed as McpServer }
  }
  const servers = maybeServers as Record<string, unknown>
  if (name && servers[name]) {
    return { ok: true, data: servers[name] as McpServer }
  }
  const entries = Object.entries(servers)
  if (entries.length === 1) {
    return { ok: true, data: entries[0][1] as McpServer }
  }
  return { ok: false, data: null as unknown as McpServer, error: 'JSON 中缺少对应名称的 mcpServers 配置' }
}

export function McpPanel() {
  const { data, error, mutate, isLoading } = useSWR<McpConfigResponse>(
    'http://localhost:8000/mcp/config',
    fetcher
  )
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, McpServerDraft>>({})
  const [showNew, setShowNew] = useState(false)
  const [newDraft, setNewDraft] = useState<McpServerDraft>(() => toDraft(''))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const servers = useMemo(() => data?.mcpServers ?? {}, [data])
  const serverEntries = useMemo(() => Object.entries(servers), [servers])

  const ensureDraft = (name: string) => {
    if (drafts[name]) return
    setDrafts((prev) => ({ ...prev, [name]: toDraft(name, servers[name]) }))
  }

  const updateServer = async (name: string, nextEnabled: boolean) => {
    const next = {
      ...(data?.mcpServers ?? {}),
      [name]: {
        ...(data?.mcpServers?.[name] ?? {}),
        enabled: nextEnabled
      }
    }
    setPending((prev) => ({ ...prev, [name]: true }))
    try {
      await fetch('http://localhost:8000/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next })
      })
      await mutate()
    } finally {
      setPending((prev) => ({ ...prev, [name]: false }))
    }
  }

  const saveDraft = async (draft: McpServerDraft) => {
    const jsonParsed = parseJson(draft.json)
    if (!jsonParsed.ok) {
      setErrors((prev) => ({
        ...prev,
        [draft.name]: jsonParsed.error ?? 'Invalid input'
      }))
      return
    }
    const extracted = extractServerConfig(draft.name, jsonParsed.data)
    if (!extracted.ok) {
      setErrors((prev) => ({
        ...prev,
        [draft.name]: extracted.error ?? 'Invalid input'
      }))
      return
    }
    setErrors((prev) => ({ ...prev, [draft.name]: '' }))
    const parsed = extracted.data
    const next = {
      ...(data?.mcpServers ?? {}),
      [draft.name]: {
        ...parsed,
        description: draft.description || parsed.description || undefined
      }
    }
    setPending((prev) => ({ ...prev, [draft.name]: true }))
    try {
      await fetch('http://localhost:8000/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next })
      })
      await mutate()
      setEditing((prev) => ({ ...prev, [draft.name]: false }))
    } finally {
      setPending((prev) => ({ ...prev, [draft.name]: false }))
    }
  }

  const saveNew = async () => {
    if (!newDraft.name.trim()) {
      setErrors((prev) => ({ ...prev, new: '请填写名称' }))
      return
    }
    const jsonParsed = parseJson(newDraft.json)
    if (!jsonParsed.ok) {
      setErrors((prev) => ({
        ...prev,
        new: jsonParsed.error ?? 'Invalid input'
      }))
      return
    }
    const extracted = extractServerConfig(newDraft.name, jsonParsed.data)
    if (!extracted.ok) {
      setErrors((prev) => ({
        ...prev,
        new: extracted.error ?? 'Invalid input'
      }))
      return
    }
    setErrors((prev) => ({ ...prev, new: '' }))
    const parsed = extracted.data
    const next = {
      ...(data?.mcpServers ?? {}),
      [newDraft.name]: {
        ...parsed,
        description: newDraft.description || parsed.description || undefined
      }
    }
    setPending((prev) => ({ ...prev, new: true }))
    try {
      await fetch('http://localhost:8000/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next })
      })
      await mutate()
      setShowNew(false)
      setNewDraft(toDraft(''))
    } finally {
      setPending((prev) => ({ ...prev, new: false }))
    }
  }

  const removeServer = async (name: string) => {
    const next = { ...(data?.mcpServers ?? {}) }
    delete next[name]
    setPending((prev) => ({ ...prev, [name]: true }))
    try {
      await fetch('http://localhost:8000/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next })
      })
      await mutate()
    } finally {
      setPending((prev) => ({ ...prev, [name]: false }))
    }
  }

  const hasServers = serverEntries.length > 0
  const statusText = error ? '连接失败' : isLoading ? '加载中' : '在线'

  return (
    <div className="rounded-2xl bg-white/80 dark:bg-zinc-900/70 border border-zinc-200/60 dark:border-zinc-800/60 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">MCP</span>
        <span className={cn("text-[10px] font-medium", error ? "text-red-500" : "text-emerald-500")}>
          {statusText}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-400">配置 MCP Servers</span>
        <button
          type="button"
          onClick={() => setShowNew((prev) => !prev)}
          className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          {showNew ? '取消新增' : '新增'}
        </button>
      </div>
      {showNew && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
          <div className="grid grid-cols-1 gap-2 text-[11px]">
            <input
              value={newDraft.name}
              onChange={(event) => setNewDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="名称（唯一）"
              className="h-8 rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 text-xs text-zinc-700 dark:text-zinc-200"
            />
            <input
              value={newDraft.description}
              onChange={(event) => setNewDraft((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="描述"
              className="h-8 rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 text-xs text-zinc-700 dark:text-zinc-200"
            />
            <textarea
              value={newDraft.json}
              onChange={(event) => setNewDraft((prev) => ({ ...prev, json: event.target.value }))}
              placeholder='MCP JSON，例如 {"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}'
              className="min-h-[140px] rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 py-2 text-xs text-zinc-700 dark:text-zinc-200 font-mono"
            />
            {errors.new && <div className="text-[11px] text-rose-500">{errors.new}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="h-7 rounded-full border border-zinc-200/70 dark:border-zinc-800/70 px-3 text-[11px] text-zinc-500"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveNew}
                disabled={pending.new}
                className="h-7 rounded-full bg-emerald-600 px-3 text-[11px] font-semibold text-white disabled:opacity-60"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {!hasServers && !showNew && (
        <div className="mt-3 text-xs text-zinc-400">暂无 MCP 配置</div>
      )}
      {hasServers && (
        <div className="mt-3 space-y-2">
          {serverEntries.map(([name, server]) => {
            const isEnabled = server.enabled !== false
            const isPending = pending[name]
            const isEditing = editing[name]
            return (
              <div
                key={name}
                className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                      {name}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {server.description ?? server.type ?? 'MCP server'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        ensureDraft(name)
                        setEditing((prev) => ({ ...prev, [name]: !isEditing }))
                      }}
                      className="h-7 px-2 rounded-full text-[10px] font-semibold border border-zinc-200/70 dark:border-zinc-800/70 text-zinc-500 hover:text-zinc-700"
                    >
                      {isEditing ? '收起' : '编辑'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeServer(name)}
                      disabled={isPending}
                      className="h-7 px-2 rounded-full text-[10px] font-semibold border border-rose-200/70 text-rose-500 hover:text-rose-600 dark:border-rose-500/30 dark:text-rose-400"
                    >
                      移除
                    </button>
                    <button
                      type="button"
                      onClick={() => updateServer(name, !isEnabled)}
                      disabled={isPending}
                      className={cn(
                        "h-7 px-2 rounded-full text-[10px] font-semibold transition-colors border",
                        isEnabled
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-200/80 dark:border-zinc-800/80",
                        isPending && "opacity-60 cursor-not-allowed"
                      )}
                    >
                      {isEnabled ? '已启用' : '已关闭'}
                    </button>
                  </div>
                </div>
                {isEditing && drafts[name] && (
                  <div className="mt-3 grid grid-cols-1 gap-2 text-[11px]">
                    <input
                      value={drafts[name].description}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [name]: { ...prev[name], description: event.target.value }
                        }))
                      }
                      placeholder="描述"
                      className="h-8 rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 text-xs text-zinc-700 dark:text-zinc-200"
                    />
                    <textarea
                      value={drafts[name].json}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [name]: { ...prev[name], json: event.target.value }
                        }))
                      }
                      placeholder='MCP JSON，例如 {"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}'
                      className="min-h-[140px] rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 py-2 text-xs text-zinc-700 dark:text-zinc-200 font-mono"
                    />
                    {errors[name] && <div className="text-[11px] text-rose-500">{errors[name]}</div>}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing((prev) => ({ ...prev, [name]: false }))}
                        className="h-7 rounded-full border border-zinc-200/70 dark:border-zinc-800/70 px-3 text-[11px] text-zinc-500"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => saveDraft(drafts[name])}
                        disabled={isPending}
                        className="h-7 rounded-full bg-emerald-600 px-3 text-[11px] font-semibold text-white disabled:opacity-60"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
