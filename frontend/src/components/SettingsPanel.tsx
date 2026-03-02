'use client'

import { McpPanel } from '@/components/McpPanel'
import { cn } from '@/lib/utils'
import { Search, SlidersHorizontal, Wrench } from 'lucide-react'

const sections = [
  { id: 'all', label: 'All Settings', icon: SlidersHorizontal },
  { id: 'mcp', label: 'MCP', icon: Wrench }
]

export function SettingsPanel() {
  return (
    <div className="h-full w-full px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">配置</div>
          <div className="text-xs text-zinc-500">Settings</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-zinc-200/70 dark:border-zinc-800/70 px-3 text-[11px] text-zinc-500 hover:text-zinc-700"
          >
            Reload
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-emerald-600 px-3 text-[11px] font-semibold text-white"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 flex h-[calc(100%-56px)] gap-5">
        <div className="w-[240px] shrink-0 rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              placeholder="Search settings..."
              className="h-9 w-full rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-zinc-950/60 pl-9 pr-2 text-xs text-zinc-700 dark:text-zinc-200"
            />
          </div>
          <div className="mt-4 space-y-1">
            {sections.map((section) => {
              const active = section.id === 'mcp'
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    "w-full rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition-colors flex items-center gap-2",
                    active
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                      : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 min-w-0 rounded-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 p-4 overflow-auto">
          <div className="mb-3">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">MCP 配置</div>
            <div className="text-[11px] text-zinc-500">管理 MCP Servers 与能力接入</div>
          </div>
          <McpPanel />
        </div>
      </div>
    </div>
  )
}
