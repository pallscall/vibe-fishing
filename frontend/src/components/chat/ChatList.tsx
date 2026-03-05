import React, { useEffect, useMemo, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { Message } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, ChevronDown, Lightbulb, Sparkles, Terminal, FileText, Image as ImageIcon, ListTodo, Pencil, Search, LayoutTemplate, Code, Wrench, Globe } from 'lucide-react';
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

const getToolIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes('read') || n.includes('file')) return <FileText className="h-3.5 w-3.5" />;
  if (n.includes('image') || n.includes('photo')) return <ImageIcon className="h-3.5 w-3.5" />;
  if (n.includes('todo') || n.includes('task')) return <ListTodo className="h-3.5 w-3.5" />;
  if (n.includes('search') || n.includes('find') || n.includes('query')) return <Search className="h-3.5 w-3.5" />;
  if (n.includes('skill')) return <LayoutTemplate className="h-3.5 w-3.5" />;
  if (n.includes('write') || n.includes('create') || n.includes('edit')) return <Pencil className="h-3.5 w-3.5" />;
  if (n.includes('code') || n.includes('snippet')) return <Code className="h-3.5 w-3.5" />;
  if (n.includes('web') || n.includes('fetch')) return <Globe className="h-3.5 w-3.5" />;
  if (n.includes('run') || n.includes('exec') || n.includes('command')) return <Terminal className="h-3.5 w-3.5" />;
  return <Wrench className="h-3.5 w-3.5" />;
};

const truncateInline = (value: string, maxChars = 64) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
};

const getHostname = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).hostname;
  } catch {
    return '';
  }
};

function isWebSearchTool(name: string) {
  const n = name.toLowerCase();
  return n.includes('web_search') || n.includes('websearch');
}

function parseWebSearchResult(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    const data = JSON.parse(trimmed) as {
      query?: unknown;
      answer?: unknown;
      results?: Array<{
        title?: unknown;
        url?: unknown;
        content?: unknown;
        score?: unknown;
      }>;
    };
    const results = Array.isArray(data?.results)
      ? data.results
          .map((item) => ({
            title: typeof item?.title === 'string' ? item.title : '',
            url: typeof item?.url === 'string' ? item.url : '',
            content: typeof item?.content === 'string' ? item.content : '',
            score: typeof item?.score === 'number' ? item.score : undefined
          }))
          .filter((item) => item.title || item.url || item.content)
      : [];
    if (results.length === 0 && typeof data?.answer !== 'string') return null;
    return {
      query: typeof data?.query === 'string' ? data.query : '',
      answer: typeof data?.answer === 'string' ? data.answer : '',
      results
    };
  } catch {
    return null;
  }
}

const getToolSummary = (toolName: string, args: any, resultTextRaw?: string, hasError?: boolean) => {
  try {
    const parseIfJson = (value: unknown) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed) return value;
      if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return value;
      }
    };

    const pickFromObject = (obj: any): string | null => {
      if (!obj || typeof obj !== 'object') return null;
      if (typeof obj.file_path === 'string' && obj.file_path) return obj.file_path;
      if (typeof obj.path === 'string' && obj.path) return obj.path;
      if (typeof obj.query === 'string' && obj.query) return obj.query;
      if (typeof obj.query === 'string' && obj.query) return obj.query;
      if (typeof obj.command === 'string' && obj.command) return obj.command;
      if (typeof obj.url === 'string' && obj.url) return obj.url;
      if (typeof obj.name === 'string' && obj.name) return obj.name;
      if (typeof obj.pattern === 'string' && obj.pattern) return obj.pattern;
      if (Array.isArray(obj.files) && obj.files.length > 0) {
        const first = obj.files[0];
        const firstPath = typeof first?.path === 'string' ? first.path : typeof first?.file_path === 'string' ? first.file_path : '';
        if (firstPath) return obj.files.length > 1 ? `${firstPath} +${obj.files.length - 1}` : firstPath;
        return `files(${obj.files.length})`;
      }
      if (typeof obj.arguments === 'string' && obj.arguments.trim().length > 0) {
        const parsed = parseIfJson(obj.arguments);
        const nested = pickFromObject(parsed as any);
        if (nested) return nested;
        const raw = obj.arguments;
        const m =
          raw.match(/"file_path"\s*:\s*"([^"]+)"/) ??
          raw.match(/"path"\s*:\s*"([^"]+)"/) ??
          raw.match(/"url"\s*:\s*"([^"]+)"/) ??
          raw.match(/"command"\s*:\s*"([^"]+)"/) ??
          raw.match(/"query"\s*:\s*"([^"]+)"/);
        if (m && m[1]) return m[1];
      }
      const values = Object.values(obj).filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 80);
      if (values.length > 0) return values[0]!.trim();
      return null;
    };

    if (isWebSearchTool(toolName)) {
      const parsedArgs = parseIfJson(args);
      const queryFromArgs = (() => {
        const fromObject = (obj: unknown): string => {
          if (!obj || typeof obj !== 'object') return '';
          const record = obj as Record<string, unknown>;
          const direct =
            (typeof record.query === 'string' ? record.query : '') ||
            (typeof record.q === 'string' ? record.q : '') ||
            (typeof record.keyword === 'string' ? record.keyword : '') ||
            (typeof record.search === 'string' ? record.search : '') ||
            (typeof record.term === 'string' ? record.term : '');
          if (direct) return direct;
          if (typeof record.arguments === 'string' && record.arguments.trim().length > 0) {
            const parsed = parseIfJson(record.arguments);
            const nested = fromObject(parsed);
            if (nested) return nested;
            const raw = record.arguments;
            const m =
              raw.match(/"query"\s*:\s*"([^"]+)"/) ??
              raw.match(/"q"\s*:\s*"([^"]+)"/) ??
              raw.match(/"keyword"\s*:\s*"([^"]+)"/) ??
              raw.match(/"search"\s*:\s*"([^"]+)"/);
            if (m && m[1]) return m[1];
          }
          return '';
        };
        return fromObject(parsedArgs);
      })();

      const parsedResult = resultTextRaw ? parseWebSearchResult(resultTextRaw) : null;
      const query = queryFromArgs || parsedResult?.query || '';
      const resultsCount = parsedResult?.results?.length ?? 0;
      const topHost = parsedResult?.results?.[0]?.url ? getHostname(parsedResult.results[0].url) : '';
      const base = query ? truncateInline(query, 56) : 'websearch';
      const suffixParts = [
        resultsCount > 0 ? `${resultsCount} results` : '',
        topHost ? topHost : '',
        hasError ? 'error' : ''
      ].filter(Boolean);
      return suffixParts.length > 0 ? `${base} · ${suffixParts.join(' · ')}` : base;
    }

    const a = parseIfJson(args);
    const summary = pickFromObject(a as any);
    if (summary) return summary;
    return null;
  } catch {
    return null;
  }
};

const truncateText = (value: string, maxChars = 320) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
};

const CodeBlock = ({ code, language }: { code: string; language?: string }) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timeout);
  }, [copied]);
  return (
    <div className="my-2 rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-950 dark:bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10">
        <span className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">{language ? language : 'code'}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
          aria-label="复制代码"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-zinc-100">
        <code className="whitespace-pre">{code}</code>
      </pre>
    </div>
  );
};

const formatDuration = (durationMs?: number) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
};

const prettifyJson = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
};

const StatusBadge = ({ status }: { status: 'running' | 'done' | 'error' }) => {
  const config = (() => {
    if (status === 'running') {
      return {
        label: '运行中',
        className:
          'border-amber-200/70 dark:border-amber-600/40 bg-amber-50/80 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
      };
    }
    if (status === 'error') {
      return {
        label: '失败',
        className:
          'border-rose-200/70 dark:border-rose-600/40 bg-rose-50/80 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
      };
    }
    return {
      label: '完成',
      className:
        'border-emerald-200/70 dark:border-emerald-600/40 bg-emerald-50/80 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
    };
  })();
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', config.className)}>
      {config.label}
    </span>
  );
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
                          const phaseLabel = item.phase === 'thinking' ? '思考' : '输出';
                          const duration = formatDuration(item.durationMs);
                          return (
                            <details
                              key={`${item.type}-${item.agentName}-${item.phase}-${idx}`}
                              className="group w-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
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
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                      <Bot className="h-3.5 w-3.5" />
                                      Agent
                                    </span>
                                    <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate">
                                      {item.agentName} · {phaseLabel}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <StatusBadge status={item.status} />
                                    {duration ? <span className="text-[10px] text-zinc-400">{duration}</span> : null}
                                    <ChevronDown className="h-3.5 w-3.5 text-zinc-400 transition-transform group-open:rotate-180" />
                                  </div>
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
                        const label = item.toolName && item.serverName ? `${item.serverName} / ${item.toolName}` : item.name;
                        const resultTextRaw = item.error ? item.error : item.result ?? '';
                        const summary = getToolSummary(item.name, item.args, resultTextRaw, Boolean(item.error));
                        const argsText = item.args ? (() => { try { return JSON.stringify(item.args, null, 2); } catch { return ''; } })() : '';
                        const resultText = prettifyJson(resultTextRaw);
                        const webSearchResult =
                          !item.error && isWebSearchTool(item.name) ? parseWebSearchResult(resultTextRaw) : null;
                        const hasWebSearchResults = (webSearchResult?.results?.length ?? 0) > 0;
                        const duration = formatDuration(item.durationMs);
                        return (
                          <details
                            key={`${item.type}-${item.callId ?? item.name}-${idx}`}
                            className="group/item"
                          >
                            <summary className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer select-none">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-zinc-400">
                                  {getToolIcon(item.name)}
                                </span>
                                <span className="text-xs text-zinc-700 dark:text-zinc-200 truncate font-medium">
                                  {label}
                                </span>
                                {summary && (
                                  <span className="inline-flex max-w-[200px] truncate rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    {summary}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {duration && <span className="text-[10px] text-zinc-400">{duration}</span>}
                                <StatusBadge status={item.status} />
                              </div>
                            </summary>
                            {(argsText || resultText) && (
                              <div className="pl-9 pr-2 pb-2 text-xs space-y-2">
                                {argsText && (
                                  <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2 border border-zinc-100 dark:border-zinc-800">
                                    <div className="text-[10px] text-zinc-400 mb-1 font-medium">Args</div>
                                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600 dark:text-zinc-300">
                                      {argsText}
                                    </pre>
                                  </div>
                                )}
                                {resultText && (
                                  <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2 border border-zinc-100 dark:border-zinc-800">
                                    <div className={cn("text-[10px] mb-1 font-medium", item.error ? "text-rose-400" : "text-zinc-400")}>
                                      {item.error ? 'Error' : 'Result'}
                                    </div>
                                    {hasWebSearchResults ? (
                                      <div className="space-y-2">
                                        {webSearchResult?.answer && (
                                          <div className="rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/50 px-2 py-1 text-[10px] text-zinc-600 dark:text-zinc-300">
                                            {webSearchResult.answer}
                                          </div>
                                        )}
                                        <div className="space-y-2">
                                          {webSearchResult?.results.map((result, resultIndex) => (
                                            <a
                                              key={`${result.url || result.title}-${resultIndex}`}
                                              href={result.url || '#'}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="block rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 py-1.5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900"
                                            >
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                                                  {result.title || result.url || '未命名结果'}
                                                </div>
                                                {typeof result.score === 'number' && (
                                                  <span className="text-[10px] text-zinc-400 shrink-0">
                                                    {Math.round(result.score * 100)}%
                                                  </span>
                                                )}
                                              </div>
                                              {result.url && (
                                                <div className="text-[10px] text-blue-600 dark:text-blue-400 truncate">
                                                  {result.url}
                                                </div>
                                              )}
                                              {result.content && (
                                                <div className="text-[10px] text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">
                                                  {truncateText(result.content, 220)}
                                                </div>
                                              )}
                                            </a>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <pre className={cn("overflow-x-auto whitespace-pre-wrap font-mono text-[10px]", item.error ? "text-rose-500" : "text-zinc-600 dark:text-zinc-300")}>
                                        {resultText}
                                      </pre>
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
                                  <details
                                    key={`${agent.name}-thinking-${agent.thinkingActive ? 'on' : 'off'}`}
                                    className="mt-2"
                                    open={agent.thinkingActive ? true : undefined}
                                  >
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
                          const resultTextRaw = tool.error ? tool.error : tool.result ?? '';
                          const summary = getToolSummary(tool.name, tool.args, resultTextRaw, Boolean(tool.error));
                          const resultText = prettifyJson(resultTextRaw);
                          const webSearchResult =
                            !tool.error && isWebSearchTool(tool.name) ? parseWebSearchResult(resultTextRaw) : null;
                          const hasWebSearchResults = (webSearchResult?.results?.length ?? 0) > 0;
                          const duration = formatDuration(tool.durationMs);
                          return (
                            <details
                              key={tool.callId ?? `${tool.name}-${idx}`}
                              className="group/item"
                            >
                              <summary className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer select-none">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="text-zinc-400">
                                    {getToolIcon(tool.name)}
                                  </span>
                                  <span className="text-xs text-zinc-700 dark:text-zinc-200 truncate font-medium">
                                    {label}
                                  </span>
                                  {summary && (
                                    <span className="inline-flex max-w-[200px] truncate rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                      {summary}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {duration && <span className="text-[10px] text-zinc-400">{duration}</span>}
                                  <StatusBadge status={tool.status} />
                                </div>
                              </summary>
                              {(argsText || resultText) && (
                                <div className="pl-9 pr-2 pb-2 text-xs space-y-2">
                                  {argsText && (
                                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2 border border-zinc-100 dark:border-zinc-800">
                                      <div className="text-[10px] text-zinc-400 mb-1 font-medium">Args</div>
                                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600 dark:text-zinc-300">
                                        {argsText}
                                      </pre>
                                    </div>
                                  )}
                                  {resultText && (
                                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2 border border-zinc-100 dark:border-zinc-800">
                                      <div className={cn("text-[10px] mb-1 font-medium", tool.error ? "text-rose-400" : "text-zinc-400")}>
                                        {tool.error ? 'Error' : 'Result'}
                                      </div>
                                      {hasWebSearchResults ? (
                                        <div className="space-y-2">
                                          {webSearchResult?.answer && (
                                            <div className="rounded-md border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/50 px-2 py-1 text-[10px] text-zinc-600 dark:text-zinc-300">
                                              {webSearchResult.answer}
                                            </div>
                                          )}
                                          <div className="space-y-2">
                                            {webSearchResult?.results.map((result, resultIndex) => (
                                              <a
                                                key={`${result.url || result.title}-${resultIndex}`}
                                                href={result.url || '#'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/60 px-2 py-1.5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900"
                                              >
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                                                    {result.title || result.url || '未命名结果'}
                                                  </div>
                                                  {typeof result.score === 'number' && (
                                                    <span className="text-[10px] text-zinc-400 shrink-0">
                                                      {Math.round(result.score * 100)}%
                                                    </span>
                                                  )}
                                                </div>
                                                {result.url && (
                                                  <div className="text-[10px] text-blue-600 dark:text-blue-400 truncate">
                                                    {result.url}
                                                  </div>
                                                )}
                                                {result.content && (
                                                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">
                                                    {truncateText(result.content, 220)}
                                                  </div>
                                                )}
                                              </a>
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <pre className={cn("overflow-x-auto whitespace-pre-wrap font-mono text-[10px]", tool.error ? "text-rose-500" : "text-zinc-600 dark:text-zinc-300")}>
                                          {resultText}
                                        </pre>
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
                      p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed" {...props} />,
                      a: ({ node, ...props }) => (
                        <a className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
                      ),
                      code: ({ node, className, children, ...props }: any) => {
                        const raw = String(children ?? '');
                        const match = /language-(\w+)/.exec(className ?? '');
                        const isInline = !match && !raw.includes('\n');
                        if (isInline) {
                          return (
                            <code
                              className="rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 font-mono text-[12px] text-zinc-800 dark:text-zinc-100 break-words"
                              {...props}
                            >
                              {raw}
                            </code>
                          );
                        }
                        return <CodeBlock code={raw.replace(/\n$/, '')} language={match?.[1]} />;
                      },
                      pre: ({ children }) => <>{children}</>
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
