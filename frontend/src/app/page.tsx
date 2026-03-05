'use client'

import { useCallback, useEffect, useState } from 'react'
import { StatusPanel } from '@/components/StatusPanel'
import { SettingsPanel } from '@/components/SettingsPanel'
import { Chat } from '@/components/chat/Chat'
import { Plus, MessageSquare, Menu, Settings, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThreadSummary } from '@/lib/types'

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export default function Home() {
  const [chatKey, setChatKey] = useState(0)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadsError, setThreadsError] = useState('')

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/threads`)
      if (!res.ok) {
        throw new Error('Failed to load threads')
      }
      const data = await res.json()
      const list: ThreadSummary[] = data.threads ?? []
      setThreads(list)
      if (!activeThreadId && list[0]) {
        setActiveThreadId(list[0].id)
      }
      setThreadsError('')
    } catch (error) {
      setThreadsError('Thread list unavailable')
    }
  }, [activeThreadId])

  const createThread = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/threads`, { method: 'POST' })
    if (!res.ok) {
      throw new Error('Failed to create thread')
    }
    const thread: ThreadSummary = await res.json()
    setThreads((prev) => [thread, ...prev])
    setActiveThreadId(thread.id)
    return thread.id
  }, [])

  useEffect(() => {
    let active = true
    loadThreads().then(async () => {
      if (!active) return
      if (!activeThreadId) {
        try {
          await createThread()
        } catch (error) {
          if (!active) return
          setThreadsError('Thread list unavailable')
        }
      }
    })
    return () => {
      active = false
    }
  }, [activeThreadId, createThread, loadThreads])

  const handleNewChat = async () => {
    try {
      setSettingsOpen(false)
      await createThread()
      setChatKey((prev) => prev + 1)
    } catch (error) {
      setThreadsError('Failed to create new chat')
    }
  }

  const handleSelectThread = (threadId: string) => {
    setSettingsOpen(false)
    setActiveThreadId(threadId)
    setChatKey((prev) => prev + 1)
  }

  const handleDeleteThread = async (threadId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/threads/${threadId}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('Failed to delete thread')
      }
      setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
      if (activeThreadId === threadId) {
        const remaining = threads.filter((thread) => thread.id !== threadId)
        if (remaining[0]) {
          setActiveThreadId(remaining[0].id)
        } else {
          try {
            await createThread()
          } catch (error) {
            setActiveThreadId(null)
          }
        }
        setChatKey((prev) => prev + 1)
      }
    } catch (error) {
      setThreadsError('Failed to delete chat')
    }
  }

  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <main className="flex h-screen w-full bg-[#f7f8fb] dark:bg-[#0b0b0f] overflow-hidden text-zinc-900 dark:text-zinc-100">
      <aside className="hidden md:flex w-[280px] h-full flex-col border-r border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-xl">
        <div className="p-5 flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-500/20">
            <span className="text-white font-bold text-lg">V</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">Vibe Fishing</span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-400">Workspace</span>
          </div>
        </div>

        <div className="px-4">
          <Button onClick={handleNewChat} className="w-full justify-start gap-2 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 rounded-xl h-10">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New Chat</span>
          </Button>
        </div>

        <div className="mt-6 px-2 flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Recent</div>
          {threadsError && (
            <div className="px-3 py-2 text-[11px] text-rose-500">{threadsError}</div>
          )}
          <div className="space-y-1">
            {threads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => handleSelectThread(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleSelectThread(thread.id)
                  }
                }}
                role="button"
                tabIndex={0}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${activeThreadId === thread.id ? 'bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'}`}
              >
                <MessageSquare className="w-3.5 h-3.5 opacity-60" />
                <span className="truncate">{thread.title}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleDeleteThread(thread.id)
                  }}
                  className="ml-auto h-7 w-7 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-white/60 dark:hover:bg-zinc-900/60 flex items-center justify-center transition-colors"
                  aria-label="Delete chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-white/60 dark:bg-zinc-900/50">
          <StatusPanel />
        </div>

        <div className="relative p-4 border-t border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-600 dark:text-zinc-300">
              U
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">User</span>
              <span className="text-[10px] text-zinc-500">Pro Plan</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="h-8 w-8 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full relative">
        <header className="md:hidden h-14 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between px-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">V</span>
            </div>
            <span className="font-semibold text-sm">Vibe Fishing</span>
          </div>
          <Button variant="ghost" size="icon">
            <Menu className="w-5 h-5" />
          </Button>
        </header>

        <div className="flex-1 overflow-hidden">
          <div className="h-full w-full bg-white/70 dark:bg-zinc-900/70 overflow-hidden relative">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 right-0 w-[420px] h-[420px] bg-gradient-to-br from-emerald-400/15 to-cyan-400/10 blur-3xl" />
              <div className="absolute bottom-0 left-0 w-[380px] h-[380px] bg-gradient-to-tr from-indigo-400/10 to-fuchsia-400/10 blur-3xl" />
            </div>
            {settingsOpen ? (
              <SettingsPanel />
            ) : (
              <Chat key={chatKey} threadId={activeThreadId} />
            )}
          </div>
        </div>

        <div className="absolute bottom-2 right-3 z-50">
          <a
            href="https://vibefishing.tech"
            target="_blank"
            className="text-[10px] font-medium text-zinc-400 hover:text-emerald-500 transition-colors"
          >
            Created By VibeFishing
          </a>
        </div>
      </div>
    </main>
  )
}
