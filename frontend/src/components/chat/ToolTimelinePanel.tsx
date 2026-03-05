'use client'

import { cn } from '@/lib/utils'

type ToolItem = {
  callId?: string
  name: string
  serverName?: string
  toolName?: string
  agentName?: string
  status: 'running' | 'done' | 'error'
  durationMs?: number
  args?: Record<string, unknown>
  result?: string
  error?: string
}

type ToolGroup = {
  key: string
  label: string
  status: ToolItem['status']
  durationMs?: number
  items: ToolItem[]
}

const formatDuration = (durationMs?: number) => {
  if (!durationMs && durationMs !== 0) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

const aggregateStatus = (items: Array<{ status: ToolItem['status'] }>) => {
  if (items.some((i) => i.status === 'running')) return 'running' as const
  if (items.some((i) => i.status === 'error')) return 'error' as const
  return 'done' as const
}

const sumDuration = (items: Array<{ durationMs?: number }>) => {
  let total = 0
  let has = false
  for (const item of items) {
    if (typeof item.durationMs === 'number') {
      total += item.durationMs
      has = true
    }
  }
  return has ? total : undefined
}

const stringifyArgs = (args?: Record<string, unknown>) => {
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return ''
  }
}

const truncateText = (value: string, maxChars = 280) => {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}

export function ToolTimelinePanel({ items }: { items: ToolItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-4 text-xs text-zinc-500">
        暂无工具调用
      </div>
    )
  }

  const tree = (() => {
    const agentOrder: string[] = []
    const byAgent = new Map<string, ToolItem[]>()
    for (const item of items) {
      const agentKey = (item.agentName ?? 'main').trim() || 'main'
      if (!byAgent.has(agentKey)) {
        byAgent.set(agentKey, [])
        agentOrder.push(agentKey)
      }
      byAgent.get(agentKey)!.push(item)
    }

    const agentGroups = agentOrder.map((agentKey) => {
      const agentItems = byAgent.get(agentKey) ?? []
      const componentOrder: string[] = []
      const byComponent = new Map<string, ToolItem[]>()
      for (const item of agentItems) {
        const componentKey = (
          item.toolName && item.serverName ? `${item.serverName} / ${item.toolName}` : item.toolName ?? item.name
        ).trim() || item.name
        if (!byComponent.has(componentKey)) {
          byComponent.set(componentKey, [])
          componentOrder.push(componentKey)
        }
        byComponent.get(componentKey)!.push(item)
      }

      const toolGroups: ToolGroup[] = componentOrder.map((componentKey) => {
        const grouped = byComponent.get(componentKey) ?? []
        const status = aggregateStatus(grouped)
        const durationMs = sumDuration(grouped)
        const label = componentKey
        return { key: `${agentKey}/${componentKey}`, label, status, durationMs, items: grouped }
      })

      const status = aggregateStatus(toolGroups)
      const durationMs = sumDuration(toolGroups)
      const label = agentKey === 'main' ? 'Main' : agentKey
      return { key: agentKey, label, status, durationMs, items: agentItems, toolGroups }
    })

    return agentGroups
  })()

  return (
    <div className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Timeline</div>
        <div className="text-[11px] text-zinc-400">Live</div>
      </div>
      <div className="space-y-2">
        {tree.map((server) => (
          <details
            key={server.key}
            open
            className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/60"
          >
            <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{server.label}</div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    server.status === 'running' && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    server.status === 'done' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    server.status === 'error' && "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  )}
                >
                  {server.status === 'running' ? '运行中' : server.status === 'done' ? '完成' : '失败'}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {server.toolGroups.length} components · {formatDuration(server.durationMs)}
                </span>
              </div>
            </summary>
            <div className="px-3 pb-3 space-y-2">
              {server.toolGroups.map((group) => (
                <details
                  key={group.key}
                  open={group.status === 'running'}
                  className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/60"
                >
                  <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none">
                    <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{group.label}</div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          group.status === 'running' && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                          group.status === 'done' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                          group.status === 'error' && "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {group.status === 'running' ? '运行中' : group.status === 'done' ? '完成' : '失败'}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {group.items.length} calls · {formatDuration(group.durationMs)}
                      </span>
                    </div>
                  </summary>
                  <div className="px-3 pb-3 space-y-2">
                    {group.items.map((item, idx) => {
                      const label = item.toolName && item.serverName ? `${item.serverName} / ${item.toolName}` : item.name
                      const argsText = stringifyArgs(item.args)
                      const resultText = item.error ? item.error : item.result ?? ''
                      const argsPreview = argsText ? truncateText(argsText, 240) : ''
                      const resultPreview = resultText ? truncateText(resultText, 320) : ''
                      return (
                        <div
                          key={item.callId ?? `${item.name}-${idx}`}
                          className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/60 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{label}</div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  item.status === 'running' && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                  item.status === 'done' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                  item.status === 'error' && "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                )}
                              >
                                {item.status === 'running' ? '运行中' : item.status === 'done' ? '完成' : '失败'}
                              </span>
                              <span className="text-[10px] text-zinc-400">{formatDuration(item.durationMs)}</span>
                            </div>
                          </div>
                          {(argsText || resultText) && (
                            <div className="mt-2 text-xs text-zinc-500 space-y-2">
                              {argsText && (
                                <div>
                                  <div className="text-[11px] text-zinc-400 mb-1">Args</div>
                                  <div className="whitespace-pre-wrap break-all">{argsPreview}</div>
                                  {argsText.length > argsPreview.length && (
                                    <details className="mt-1">
                                      <summary className="cursor-pointer select-none text-[11px] text-zinc-400">展开</summary>
                                      <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-all">
                                        {argsText}
                                      </div>
                                    </details>
                                  )}
                                </div>
                              )}
                              {resultText && (
                                <div>
                                  <div className={`text-[11px] mb-1 ${item.error ? 'text-rose-400' : 'text-zinc-400'}`}>
                                    {item.error ? 'Error' : 'Result'}
                                  </div>
                                  <div className={`whitespace-pre-wrap break-all ${item.error ? 'text-rose-500' : ''}`}>
                                    {resultPreview}
                                  </div>
                                  {resultText.length > resultPreview.length && (
                                    <details className="mt-1">
                                      <summary className="cursor-pointer select-none text-[11px] text-zinc-400">展开</summary>
                                      <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-all">
                                        {resultText}
                                      </div>
                                    </details>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
