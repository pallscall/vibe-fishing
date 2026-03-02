'use client'

import { cn } from '@/lib/utils'

type TimelineItem = {
  name: string
  status: 'running' | 'done' | 'error'
  durationMs?: number
  output?: string
  thinking?: string
  thinkingActive?: boolean
}

const formatDuration = (durationMs?: number) => {
  if (!durationMs && durationMs !== 0) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

const labelMap: Record<string, string> = {
  'master agent': 'Master Agent',
  planner: 'Planner',
  researcher: 'Researcher',
  analyst: 'Analyst',
  risk: 'Risk',
  critic: 'Critic',
  reporter: 'Reporter',
  'general-purpose': 'General Purpose',
  bash: 'Bash'
}

const descriptionMap: Record<string, string> = {
  'master agent': '主 agent 统筹任务与输出',
  planner: '规划任务路径与关键步骤',
  researcher: '补充事实、假设与风险',
  analyst: '提炼关键洞察与影响',
  risk: '识别风险与边界条件',
  critic: '审视问题与改进建议',
  reporter: '汇总最终回答',
  'general-purpose': '通用子代理，处理复杂子任务',
  bash: '命令执行子代理'
}

export function AgentTimelinePanel({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-4 text-xs text-zinc-500">
        暂无 agent 轨迹
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Agent Timeline</div>
        <div className="text-[11px] text-zinc-400">Live</div>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const [baseName, scene] = item.name.split(':', 2)
          const label = labelMap[baseName] ?? baseName
          const description = descriptionMap[baseName]
          return (
          <div key={`${item.name}-${item.durationMs ?? ''}`} className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                <span>{label}</span>
                {scene ? <span className="ml-2 text-[10px] text-zinc-400">{scene}</span> : null}
              </div>
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
            {description && (
              <div className="mt-1 text-[11px] text-zinc-400">{description}</div>
            )}
            {item.output && (
              <details className="mt-2 text-xs text-zinc-500">
                <summary className="cursor-pointer select-none text-[11px] text-zinc-400">查看输出</summary>
                <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap">
                  {item.output}
                </div>
              </details>
            )}
            {item.thinking && (
              <details className="mt-2 text-xs text-zinc-500">
                <summary className="cursor-pointer select-none text-[11px] text-zinc-400">
                  查看思考{item.thinkingActive ? '（生成中）' : ''}
                </summary>
                <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-all">
                  {item.thinking}
                </div>
              </details>
            )}
          </div>
        )})}
      </div>
    </div>
  )
}
