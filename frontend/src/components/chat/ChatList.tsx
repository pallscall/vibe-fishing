import React, { useEffect, useMemo, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { Message } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface ChatListProps {
  messages: Message[];
  isLoading?: boolean;
  streamingMessage?: Message | null;
  isSidePanelOpen?: boolean;
  mode?: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing';
}

const truncateText = (value: string, maxChars = 320) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
};

export function ChatList({ messages, isLoading, streamingMessage, isSidePanelOpen, mode }: ChatListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const isStreamingActive = useMemo(() => {
    return Boolean(isLoading || streamingMessage);
  }, [isLoading, streamingMessage]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: isStreamingActive ? 'auto' : 'smooth' });
  }, [messages, isStreamingActive, streamingMessage]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 120;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= threshold;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto px-4 md:px-0 py-8 scroll-smooth pb-32"
    >
      <style jsx global>{`
        @keyframes vf_spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes vf_sweep {
          0% {
            transform: translateX(-60%);
            opacity: 0;
          }
          15% {
            opacity: 0.6;
          }
          85% {
            opacity: 0.6;
          }
          100% {
            transform: translateX(160%);
            opacity: 0;
          }
        }
        @keyframes vf_float {
          0% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(-10px, -14px, 0);
          }
          100% {
            transform: translate3d(0, 0, 0);
          }
        }
        .vf-noise {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");
          background-size: 220px 220px;
        }
      `}</style>
      <div className={cn('mx-auto space-y-8', isSidePanelOpen ? 'max-w-6xl' : 'max-w-5xl')}>
        {messages.length === 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center text-center space-y-6 py-20 opacity-80"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full" />
              <div className="relative w-20 h-20 bg-gradient-to-tr from-emerald-400 to-cyan-500 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-500/20 rotate-3">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-zinc-400">
                How can I help you today?
              </h3>
              <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                I am Vibe Fishing, your AI assistant. I can help you write code, analyze data, or just brainstorm ideas.
              </p>
            </div>
          </motion.div>
        )}
        
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} mode={mode} />
          ))}
        </AnimatePresence>
        
        {(isLoading || streamingMessage) && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start items-start gap-4 pl-2"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-sm shrink-0">
              <Sparkles className="w-4 h-4 text-white animate-pulse" />
            </div>
            <div className="flex flex-col gap-3 px-4 py-3 bg-white dark:bg-zinc-800 rounded-2xl rounded-tl-none border border-zinc-200 dark:border-zinc-700 shadow-sm items-start min-h-[40px] w-full">
              {(() => {
                const skills = streamingMessage?.meta?.skills ?? [];
                if (skills.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center rounded-full border border-emerald-200/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                      >
                        Skill · {skill}
                      </span>
                    ))}
                  </div>
                );
              })()}
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {streamingMessage?.meta?.reasoningActive ? 'Thinking...' : 'Responding...'}
                </span>
              </div>

              {(() => {
                const trace = streamingMessage?.meta?.trace ?? [];
                if (trace.length > 0) {
                  return (
                    <div className="space-y-2 w-full">
                      {trace.map((item, idx) => {
                        if (item.type === 'agent') {
                          const running = item.status === 'running';
                          const phaseLabel = item.phase === 'thinking' ? 'Thinking' : 'Output';
                          return (
                            <details
                              key={`${item.type}-${item.agentName}-${item.phase}-${idx}`}
                              className="w-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                            >
                              <summary
                                className={cn(
                                  'cursor-pointer select-none -mx-2 px-2 py-1 rounded-lg',
                                  running ? 'relative overflow-hidden' : ''
                                )}
                              >
                                {running && (
                                  <span className="pointer-events-none absolute inset-0">
                                    <span
                                      className="absolute -inset-12 opacity-55 blur-2xl"
                                      style={{
                                        background:
                                          'conic-gradient(from 180deg at 50% 50%, rgba(16,185,129,.45), rgba(34,211,238,.38), rgba(59,130,246,.22), rgba(16,185,129,.45))',
                                        animation: 'vf_spin 10s linear infinite'
                                      }}
                                    />
                                    <span
                                      className="absolute -inset-8 opacity-30"
                                      style={{
                                        background:
                                          'radial-gradient(70% 55% at 18% 12%, rgba(34,211,238,.35), transparent 60%), radial-gradient(60% 55% at 85% 22%, rgba(16,185,129,.35), transparent 62%), radial-gradient(65% 55% at 40% 95%, rgba(59,130,246,.18), transparent 60%)',
                                        animation: 'vf_float 6.5s ease-in-out infinite'
                                      }}
                                    />
                                    <span className="absolute inset-0 vf-noise opacity-[0.10] mix-blend-overlay" />
                                    <span
                                      className="absolute inset-y-0 -left-1/2 w-1/2 opacity-40"
                                      style={{
                                        background:
                                          'linear-gradient(90deg, transparent, rgba(255,255,255,.70), rgba(34,211,238,.25), transparent)',
                                        animation: 'vf_sweep 2.2s ease-in-out infinite'
                                      }}
                                    />
                                  </span>
                                )}
                                <div className={cn('flex items-center justify-between gap-3', running ? 'relative z-10' : '')}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="inline-flex items-center rounded-full border border-emerald-200/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                      Agent
                                    </span>
                                    <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">
                                      {item.agentName} · {phaseLabel}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-zinc-400 shrink-0">
                                    {item.status}
                                    {typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : ''}
                                  </span>
                                </div>
                              </summary>
                              {item.content && (
                                <div className={cn('mt-2 whitespace-pre-wrap break-words leading-relaxed', item.phase === 'thinking' ? 'text-[11px] text-zinc-500' : '')}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                                </div>
                              )}
                            </details>
                          );
                        }
                        const running = item.status === 'running';
                        const label = item.toolName && item.serverName ? `${item.serverName} / ${item.toolName}` : item.name;
                        const argsText = item.args ? (() => { try { return JSON.stringify(item.args, null, 2); } catch { return ''; } })() : '';
                        const resultText = item.error ? item.error : item.result ?? '';
                        const argsPreview = argsText ? truncateText(argsText, 240) : '';
                        const resultPreview = resultText ? truncateText(resultText, 320) : '';
                        return (
                          <details
                            key={`${item.type}-${item.callId ?? item.name}-${idx}`}
                            className="w-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                          >
                            <summary
                              className={cn(
                                'cursor-pointer select-none -mx-2 px-2 py-1 rounded-lg',
                                running ? 'relative overflow-hidden' : ''
                              )}
                            >
                              {running && (
                                <span className="pointer-events-none absolute inset-0">
                                  <span
                                    className="absolute -inset-12 opacity-55 blur-2xl"
                                    style={{
                                      background:
                                        'conic-gradient(from 180deg at 50% 50%, rgba(16,185,129,.35), rgba(34,211,238,.38), rgba(59,130,246,.18), rgba(16,185,129,.35))',
                                      animation: 'vf_spin 10s linear infinite'
                                    }}
                                  />
                                  <span className="absolute inset-0 vf-noise opacity-[0.10] mix-blend-overlay" />
                                  <span
                                    className="absolute inset-y-0 -left-1/2 w-1/2 opacity-40"
                                    style={{
                                      background:
                                        'linear-gradient(90deg, transparent, rgba(255,255,255,.70), rgba(34,211,238,.25), transparent)',
                                      animation: 'vf_sweep 2.2s ease-in-out infinite'
                                    }}
                                  />
                                </span>
                              )}
                              <div className={cn('flex items-center justify-between gap-3', running ? 'relative z-10' : '')}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center rounded-full border border-indigo-200/70 dark:border-indigo-700/60 bg-indigo-50/80 dark:bg-indigo-900/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                                    Tool
                                  </span>
                                  <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">{label}</span>
                                </div>
                                <span className="text-[10px] text-zinc-400 shrink-0">
                                  {item.status}
                                  {typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : ''}
                                </span>
                              </div>
                            </summary>
                            {(argsText || resultText) && (
                              <div className="mt-2 space-y-2">
                                {argsText && (
                                  <div>
                                    <div className="text-[10px] text-zinc-400 mb-1">Args</div>
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
                                    <div className={`text-[10px] mb-1 ${item.error ? 'text-rose-400' : 'text-zinc-400'}`}>
                                      {item.error ? 'Error' : 'Result'}
                                    </div>
                                    <div className={`whitespace-pre-wrap break-all ${item.error ? 'text-rose-500' : ''}`}>{resultPreview}</div>
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
                          </details>
                        );
                      })}
                    </div>
                  );
                }

                const sections = streamingMessage?.meta?.sections ?? [];
                const fallback: Array<'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'tools' | 'agents'> = [];
                if (streamingMessage?.meta?.plan || streamingMessage?.meta?.planActive) fallback.push('plan');
                if (streamingMessage?.meta?.research || streamingMessage?.meta?.researchActive) fallback.push('research');
                if (streamingMessage?.meta?.analysis) fallback.push('analysis');
                if (streamingMessage?.meta?.risk) fallback.push('risk');
                if (streamingMessage?.meta?.critic) fallback.push('critic');
                if ((streamingMessage?.meta?.agentTimeline ?? []).length > 0) fallback.push('agents');
                if ((streamingMessage?.meta as any)?.toolTimeline?.length) fallback.push('tools');
                const order = sections.length > 0 ? sections : fallback;
                return order.map((section) => {
                  if (section === 'plan') {
                    return (
                      <details
                        key="stream-plan"
                        open={streamingMessage?.meta?.planActive ?? false}
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Plan
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {streamingMessage?.meta?.plan ?? ''}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </details>
                    );
                  }
                  if (section === 'research') {
                    return (
                      <details
                        key="stream-research"
                        open={streamingMessage?.meta?.researchActive ?? false}
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Research
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {streamingMessage?.meta?.research ?? ''}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </details>
                    );
                  }
                  if (section === 'analysis') {
                    return (
                      <details
                        key="stream-analysis"
                        open={Boolean((streamingMessage?.meta as any)?.analysisActive)}
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Analysis
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {streamingMessage?.meta?.analysis}
                          </div>
                        </div>
                      </details>
                    );
                  }

                  if (section === 'risk') {
                    return (
                      <details
                        key="stream-risk"
                        open={Boolean((streamingMessage?.meta as any)?.riskActive)}
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Risk
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {streamingMessage?.meta?.risk}
                          </div>
                        </div>
                      </details>
                    );
                  }

                  if (section === 'critic') {
                    return (
                      <details
                        key="stream-critic"
                        open={Boolean((streamingMessage?.meta as any)?.criticActive)}
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Critic
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {streamingMessage?.meta?.critic}
                          </div>
                        </div>
                      </details>
                    );
                  }
                  if (section === 'agents') {
                    const agentTimeline = streamingMessage?.meta?.agentTimeline ?? [];
                    if (agentTimeline.length === 0) return null;
                    return (
                      <details
                        key="stream-agents"
                        open
                        className="group w-full rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 bg-white/70 dark:bg-zinc-900/60 shadow-sm"
                      >
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                              <Lightbulb className="h-4 w-4" />
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                              Agents
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                          <div className="space-y-2">
                            {agentTimeline.map((agent) => (
                              <div
                                key={`${agent.name}-${agent.durationMs ?? ''}`}
                                className="rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-zinc-800 dark:text-zinc-100">{agent.name}</div>
                                  <div className="text-[10px] text-zinc-400">
                                    {agent.status}
                                    {typeof agent.durationMs === 'number' ? ` · ${agent.durationMs}ms` : ''}
                                  </div>
                                </div>
                                {agent.thinking && (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer select-none text-[11px] text-zinc-400">思考</summary>
                                    <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-words text-[11px] text-zinc-500">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {agent.thinking}
                                      </ReactMarkdown>
                                    </div>
                                  </details>
                                )}
                                {agent.output && (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer select-none text-[11px] text-zinc-400">输出</summary>
                                    <div className="mt-2 whitespace-pre-wrap leading-relaxed">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {agent.output}
                                      </ReactMarkdown>
                                    </div>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  }
                  if (section === 'tools') {
                    const tools = (streamingMessage?.meta as any)?.toolTimeline as
                      | Array<{
                          callId?: string;
                          name: string;
                          serverName?: string;
                          toolName?: string;
                          status: 'running' | 'done' | 'error';
                          durationMs?: number;
                          args?: Record<string, unknown>;
                          result?: string;
                          error?: string;
                        }>
                      | undefined;
                    if (!tools || tools.length === 0) return null;
                    return (
                      <div key="stream-tools" className="space-y-2">
                        {tools.map((tool, idx) => {
                          const running = tool.status === 'running';
                          const label =
                            tool.toolName && tool.serverName ? `${tool.serverName} / ${tool.toolName}` : tool.name;
                          const argsText = tool.args
                            ? (() => {
                                try {
                                  return JSON.stringify(tool.args, null, 2);
                                } catch {
                                  return '';
                                }
                              })()
                            : '';
                          const resultText = tool.error ? tool.error : tool.result ?? '';
                          const argsPreview = argsText ? truncateText(argsText, 240) : '';
                          const resultPreview = resultText ? truncateText(resultText, 320) : '';
                          return (
                            <details
                              key={tool.callId ?? `${tool.name}-${idx}`}
                              className="w-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                            >
                              <summary
                                className={cn(
                                  'cursor-pointer select-none -mx-2 px-2 py-1 rounded-lg',
                                  running ? 'relative overflow-hidden' : ''
                                )}
                              >
                                {running && (
                                  <span className="pointer-events-none absolute inset-0">
                                    <span
                                      className="absolute -inset-12 opacity-55 blur-2xl"
                                      style={{
                                        background:
                                          'conic-gradient(from 180deg at 50% 50%, rgba(16,185,129,.35), rgba(34,211,238,.38), rgba(59,130,246,.18), rgba(16,185,129,.35))',
                                        animation: 'vf_spin 10s linear infinite'
                                      }}
                                    />
                                    <span className="absolute inset-0 vf-noise opacity-[0.10] mix-blend-overlay" />
                                    <span
                                      className="absolute inset-y-0 -left-1/2 w-1/2 opacity-40"
                                      style={{
                                        background:
                                          'linear-gradient(90deg, transparent, rgba(255,255,255,.70), rgba(34,211,238,.25), transparent)',
                                        animation: 'vf_sweep 2.2s ease-in-out infinite'
                                      }}
                                    />
                                  </span>
                                )}
                                <div className={cn('flex items-center justify-between gap-3', running ? 'relative z-10' : '')}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="inline-flex items-center rounded-full border border-indigo-200/70 dark:border-indigo-700/60 bg-indigo-50/80 dark:bg-indigo-900/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                                      Tool
                                    </span>
                                    <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">{label}</span>
                                  </div>
                                  <span className="text-[10px] text-zinc-400 shrink-0">
                                    {tool.status}
                                    {typeof tool.durationMs === 'number' ? ` · ${tool.durationMs}ms` : ''}
                                  </span>
                                </div>
                              </summary>
                              {(argsText || resultText) && (
                                <div className="mt-2 space-y-2">
                                  {argsText && (
                                    <div>
                                      <div className="text-[10px] text-zinc-400 mb-1">Args</div>
                                      <div className="whitespace-pre-wrap break-all">{argsPreview}</div>
                                      {argsText.length > argsPreview.length && (
                                        <details className="mt-1">
                                          <summary className="cursor-pointer select-none text-[11px] text-zinc-400">
                                            展开
                                          </summary>
                                          <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-all">
                                            {argsText}
                                          </div>
                                        </details>
                                      )}
                                    </div>
                                  )}
                                  {resultText && (
                                    <div>
                                      <div className={`text-[10px] mb-1 ${tool.error ? 'text-rose-400' : 'text-zinc-400'}`}>
                                        {tool.error ? 'Error' : 'Result'}
                                      </div>
                                      <div className={`whitespace-pre-wrap break-all ${tool.error ? 'text-rose-500' : ''}`}>
                                        {resultPreview}
                                      </div>
                                      {resultText.length > resultPreview.length && (
                                        <details className="mt-1">
                                          <summary className="cursor-pointer select-none text-[11px] text-zinc-400">
                                            展开
                                          </summary>
                                          <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-all">
                                            {resultText}
                                          </div>
                                        </details>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    );
                  }
                  return null;
                });
              })()}

              {(streamingMessage?.meta?.plan || streamingMessage?.meta?.research || streamingMessage?.meta?.thinking) && streamingMessage?.content && (
                <div className="h-4" />
              )}

              {streamingMessage?.content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({node, ...props}) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                      a: ({node, ...props}) => <a className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                      code: ({node, ...props}) => <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 font-mono text-xs" {...props} />,
                      pre: ({node, ...props}) => <pre className="bg-zinc-950 dark:bg-zinc-900 p-3 rounded-lg overflow-x-auto my-2 border border-zinc-800" {...props} />
                    }}
                  >
                    {streamingMessage.content}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}
