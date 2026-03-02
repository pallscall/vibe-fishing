'use client'

import useSWR from 'swr'
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function StatusPanel() {
  const { data: health, error } = useSWR('http://localhost:8000/health', fetcher)
  const isConnected = !error && health;

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="rounded-2xl bg-white/80 dark:bg-zinc-900/70 border border-zinc-200/60 dark:border-zinc-800/60 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">System</span>
          <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-red-500")} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          {isConnected ? <Wifi className="w-4 h-4 text-emerald-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{isConnected ? 'Online' : 'Offline'}</span>
        </div>
      </div>

    </div>
  )
}
