import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Message } from '@/lib/types';
import { Bot, Check, ChevronDown, Copy, Lightbulb, Terminal, User, FileText, Image as ImageIcon, ListTodo, Pencil, Search, LayoutTemplate, Code, Wrench, Shield, AlertTriangle, Eye, EyeOff, Globe } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatMessageProps {
  message: Message;
  mode?: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing';
}

const truncateText = (value: string, maxChars = 320) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
};

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

const getToolSummary = (args: any) => {
  try {
    const a = typeof args === 'string' ? JSON.parse(args) : args;
    if (!a) return null;
    if (a.file_path) return a.file_path;
    if (a.query) return a.query;
    if (a.command) return a.command;
    if (a.url) return a.url;
    if (a.name) return a.name;
    if (a.pattern) return a.pattern;
    const values = Object.values(a).filter((v): v is string => typeof v === 'string' && v.length < 50);
    if (values.length > 0) return values[0];
    return null;
  } catch {
    return null;
  }
};

const toSingleLine = (value: string) => {
  return value.replace(/\s+/g, ' ').trim();
};

const isWebSearchTool = (name: string) => {
  const n = name.toLowerCase();
  return n.includes('web_search') || n.includes('websearch');
};

const parseWebSearchResult = (value: string) => {
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
};

const formatDuration = (durationMs?: number) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
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

const CodeBlock = ({ code, language }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timeout);
  }, [copied]);
  return (
    <div className="my-2 rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-950 dark:bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10">
        <div className="min-w-0">
          <span className="text-[10px] uppercase tracking-[0.24em] text-zinc-400">
            {language ? language : 'code'}
          </span>
        </div>
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
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed text-zinc-100">
        <code className="whitespace-pre">{code}</code>
      </pre>
    </div>
  );
};

const MarkdownContent = ({ children, className }: { children: string; className?: string }) => {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none break-words', className)}>
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
        {children}
      </ReactMarkdown>
    </div>
  );
};

export function ChatMessage({ message, mode }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [displayedContent, setDisplayedContent] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const shouldAnimate = useMemo(() => {
    if (isUser) return false;
    if (message.meta?.streamingFinal) return false;
    const age = Date.now() - message.createdAt;
    return age < 8000;
  }, [isUser, message.createdAt, message.meta?.streamingFinal]);
  const agents = message.meta?.agents ?? [];
  const plan = message.meta?.plan ?? agents.find((agent) => agent.name === 'planner')?.output;
  const research = message.meta?.research ?? agents.find((agent) => agent.name === 'researcher')?.output;
  const analysis = message.meta?.analysis ?? agents.find((agent) => agent.name === 'analyst')?.output;
  const risk = message.meta?.risk ?? agents.find((agent) => agent.name === 'risk')?.output;
  const critic = message.meta?.critic ?? agents.find((agent) => agent.name === 'critic')?.output;
  const toolTimeline = message.meta?.toolTimeline ?? [];
  const agentTimeline = message.meta?.agentTimeline ?? [];
  const trace = message.meta?.trace ?? [];
  const traceItems = toolTimeline.length > 0 ? trace.filter((item) => item.type !== 'tool') : trace;
  const skills = message.meta?.skills ?? [];
  const skillReads = message.meta?.skillReads ?? [];
  const tokenUsage = message.meta?.tokenUsage;
  const sections = message.meta?.sections ?? [];
  const hasSections =
    !isUser &&
    (Boolean(plan) ||
      Boolean(research) ||
      Boolean(analysis) ||
      Boolean(risk) ||
      Boolean(critic) ||
      toolTimeline.length > 0 ||
      agentTimeline.length > 0);
  const sectionOrder =
    sections.length > 0
      ? sections
      : ([
          'plan',
          'research',
          'analysis',
          'risk',
          'critic',
          'agents',
          'tools',
        ] as Array<'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'tools' | 'agents'>);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedContent(message.content);
      return;
    }
    let index = 0;
    setDisplayedContent('');
    const interval = setInterval(() => {
      index += 1;
      setDisplayedContent(message.content.slice(0, index));
      if (index >= message.content.length) {
        clearInterval(interval);
      }
    }, 16);
    return () => {
      clearInterval(interval);
    };
  }, [message.content, shouldAnimate]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full gap-4 mb-6 items-start",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm",
        isUser ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-gradient-to-br from-emerald-500 to-cyan-600 text-white"
      )}>
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      <div
        className={cn(
          "group relative max-w-[80%]",
          !isUser && hasSections ? "w-full" : ""
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-5 py-4 text-sm shadow-sm",
            isUser
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-tr-none"
              : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-tl-none"
          )}
        >
        {!isUser && (skills.length > 0 || skillReads.length > 0 || tokenUsage) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {skills.map((skill) => (
              <span
                key={`skill-${skill}`}
                className="inline-flex items-center rounded-full border border-emerald-200/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
              >
                Skill · {skill}
              </span>
            ))}
            {skillReads.map((skill) => (
              <span
                key={`read-${skill.name}`}
                className="inline-flex items-center rounded-full border border-sky-200/70 dark:border-sky-700/60 bg-sky-50/80 dark:bg-sky-900/20 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"
              >
                Skill Read · {skill.name}
              </span>
            ))}
            {tokenUsage && (
              <span className="inline-flex items-center rounded-full border border-zinc-200/70 dark:border-zinc-700/60 bg-zinc-50/80 dark:bg-zinc-900/30 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
                Tokens · {tokenUsage.promptTokens}/{tokenUsage.completionTokens}/{tokenUsage.totalTokens}
              </span>
            )}
          </div>
        )}
        {traceItems.length > 0 && (
          <div className="mt-4 mb-4">
            <details className="group">
              <summary className="list-none flex items-center gap-2 mb-3 cursor-pointer select-none outline-none">
                <div className="flex items-center gap-2 text-zinc-400 px-1 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  <span className="text-xs font-medium">Execution Process</span>
                  <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-500 dark:text-zinc-400">{traceItems.length}</span>
                </div>
              </summary>
              
              <div className="space-y-2 pl-1">
                {traceItems.map((item, idx) => {
                  const isAgent = item.type === 'agent';
                  
                  // Common props
                  const duration = formatDuration(item.durationMs);
                  let label = '';
                  let icon = null;
                  let summaryTag = null;
                  let content: React.ReactNode = null;

                  if (isAgent) {
                    const phaseLabel = item.phase === 'thinking' ? '思考' : '输出';
                    label = `${item.agentName} · ${phaseLabel}`;
                    icon = <Bot className="h-4 w-4" />;
                    if (item.content) {
                      content = (
                        <div className="pl-9 pr-4 pb-3">
                          <MarkdownContent
                            className={cn('text-[11px] text-zinc-500', item.phase === 'thinking' ? 'italic' : '')}
                          >
                            {item.content}
                          </MarkdownContent>
                        </div>
                      );
                    }
                  } else {
                    label = item.toolName && item.serverName ? `${item.serverName} / ${item.toolName}` : item.name;
                    icon = getToolIcon(item.name);
                    const summary = getToolSummary(item.args);
                    if (summary) {
                      summaryTag = (
                         <span className="hidden sm:inline-flex max-w-[150px] truncate rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 border border-zinc-200/50 dark:border-zinc-700/50">
                           {summary}
                         </span>
                      );
                    }

                    const argsText = item.args ? (() => { try { return JSON.stringify(item.args, null, 2); } catch { return ''; } })() : '';
                    const resultTextRaw = item.error ? item.error : item.result ?? '';
                    const resultText = prettifyJson(resultTextRaw);
                    const webSearchResult =
                      !item.error && isWebSearchTool(item.name) ? parseWebSearchResult(resultTextRaw) : null;
                    const hasWebSearchResults = (webSearchResult?.results?.length ?? 0) > 0;

                    if (argsText || resultText) {
                      content = (
                        <div className="pl-9 pr-4 pb-3 text-xs space-y-2">
                           {argsText && (
                             <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2.5 border border-zinc-100 dark:border-zinc-800">
                               <div className="text-[10px] text-zinc-400 mb-1 font-medium select-none">Args</div>
                               <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                                 {argsText}
                               </pre>
                             </div>
                           )}
                          {resultText && (
                            <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-2.5 border border-zinc-100 dark:border-zinc-800">
                              <div className={cn("text-[10px] mb-1 font-medium select-none", item.error ? "text-rose-400" : "text-zinc-400")}>
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
                                <pre className={cn("overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed", item.error ? "text-rose-500" : "text-zinc-600 dark:text-zinc-300")}>
                                  {resultText}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                  }

                  return (
                    <details
                      key={isAgent ? `${item.type}-${item.agentName}-${item.phase}-${idx}` : `${item.type}-${item.callId ?? item.name}-${idx}`}
                      className="group/item rounded-xl border transition-all duration-300 border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-950/40 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm"
                    >
                      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none">
                        <div className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0 transition-colors bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {icon}
                        </div>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-xs font-medium truncate text-zinc-700 dark:text-zinc-200">
                            {label}
                          </span>
                          {summaryTag}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {duration && <span className="text-[10px] text-zinc-400 font-mono">{duration}</span>}
                          <StatusBadge status={item.status} />
                          {content && (
                            <ChevronDown className="h-3.5 w-3.5 text-zinc-300 transition-transform group-open/item:rotate-180" />
                          )}
                        </div>
                      </summary>
                      {content}
                    </details>
                  );
                })}
              </div>
            </details>
          </div>
        )}

        {toolTimeline.length > 0 && (
          <details className="mt-3 group rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 overflow-hidden">
            <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors bg-zinc-50/50 dark:bg-zinc-900/50">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              <span>隐藏步骤</span>
              <span className="text-[10px] text-zinc-400 font-normal ml-auto">{toolTimeline.length} steps</span>
            </summary>
            <div className="p-1 space-y-0.5">
            {toolTimeline.map((tool, idx) => {
              const label = tool.toolName && tool.serverName ? `${tool.serverName} / ${tool.toolName}` : tool.name;
              const summary = getToolSummary(tool.args);
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
          </details>
        )}

        {hasSections &&
          sectionOrder.map((section, index) => {
            if (section === 'plan' && !plan) return null;
            if (section === 'research' && !research) return null;
            if (section === 'analysis' && !analysis) return null;
            if (section === 'risk' && !risk) return null;
            if (section === 'critic' && !critic) return null;
            if (section === 'tools') return null;
            if (section === 'agents' && (traceItems.length > 0 || agentTimeline.length === 0)) return null;
            const title =
              section === 'plan'
                  ? 'Plan'
                  : section === 'research'
                    ? 'Research'
                    : section === 'analysis'
                      ? 'Analysis'
                      : section === 'risk'
                        ? 'Risk'
                        : section === 'critic'
                          ? 'Critic'
                          : section === 'agents'
                            ? 'Agents'
                            : 'Tools';
            const baseClass =
              'bg-white/80 dark:bg-zinc-900/70';
            const marginClass = index === 0 ? 'mt-4' : 'mt-3';
            return (
              <details
                key={`section-${section}`}
                className={`group ${marginClass} rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 ${baseClass} shadow-sm`}
              >
                <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none text-xs text-zinc-600 dark:text-zinc-300">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200/70 dark:border-zinc-700/70 bg-white/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400">
                      <Lightbulb className="h-4 w-4" />
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                      {title}
                    </span>
                  </div>
                </summary>
                <div className="px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-300">
                  {section === 'plan' ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{plan}</div>
                  ) : section === 'research' ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{research}</div>
                  ) : section === 'analysis' ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{analysis}</div>
                  ) : section === 'risk' ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{risk}</div>
                  ) : section === 'critic' ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{critic}</div>
                  ) : section === 'agents' ? (
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
                              className="group mt-2"
                              open={agent.thinkingActive ? true : undefined}
                            >
                              <summary className="cursor-pointer select-none text-[11px] text-zinc-400 inline-flex items-center gap-1">
                                思考
                                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                              </summary>
                              <div className="mt-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/70 p-2 whitespace-pre-wrap break-words text-[11px] text-zinc-500">
                                <MarkdownContent className="text-[11px] text-zinc-500">{agent.thinking}</MarkdownContent>
                              </div>
                            </details>
                          )}
                          {agent.output && (
                            <details className="group mt-2">
                              <summary className="cursor-pointer select-none text-[11px] text-zinc-400 inline-flex items-center gap-1">
                                输出
                                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                              </summary>
                              <MarkdownContent className="mt-2">{agent.output}</MarkdownContent>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        {hasSections && displayedContent && (
          <div className="h-4" />
        )}
        <MarkdownContent>{displayedContent}</MarkdownContent>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "absolute -bottom-5 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-zinc-500 transition-opacity",
            "bg-white/90 dark:bg-zinc-900/80 shadow-sm ring-1 ring-zinc-200/60 dark:ring-zinc-700/60",
            "opacity-0 group-hover:opacity-100"
          )}
          aria-label="复制内容"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </motion.div>
  );
}
