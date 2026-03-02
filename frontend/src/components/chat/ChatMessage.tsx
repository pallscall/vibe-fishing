import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Message } from '@/lib/types';
import { Bot, Check, Copy, Lightbulb, User } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChatMessageProps {
  message: Message;
  mode?: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing';
}

const truncateText = (value: string, maxChars = 320) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
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
        {trace.length > 0 && (
          <div className="mt-3 space-y-2">
            {trace.map((item, idx) => {
              if (item.type === 'agent') {
                const phaseLabel = item.phase === 'thinking' ? 'thinking' : 'output';
                return (
                  <details
                    key={`${item.type}-${item.agentName}-${item.phase}-${idx}`}
                    className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                  >
                    <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center rounded-full border border-emerald-200/70 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                          Agent
                        </span>
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                          {item.agentName} · {phaseLabel}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400 shrink-0">
                        {item.status}
                        {typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : ''}
                      </span>
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
              const argsText = item.args ? (() => { try { return JSON.stringify(item.args, null, 2); } catch { return ''; } })() : '';
              const resultText = item.error ? item.error : item.result ?? '';
              const argsPreview = argsText ? truncateText(argsText, 240) : '';
              const resultPreview = resultText ? truncateText(resultText, 320) : '';
              return (
                <details
                  key={`${item.type}-${item.callId ?? item.name}-${idx}`}
                  className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                >
                  <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center rounded-full border border-indigo-200/70 dark:border-indigo-700/60 bg-indigo-50/80 dark:bg-indigo-900/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                        Tool
                      </span>
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{label}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {item.status}
                      {typeof item.durationMs === 'number' ? ` · ${item.durationMs}ms` : ''}
                    </span>
                  </summary>
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
                </details>
              );
            })}
          </div>
        )}

        {trace.length === 0 && toolTimeline.length > 0 && (
          <div className="mt-3 space-y-2">
            {toolTimeline.map((tool, idx) => {
              const label = tool.toolName && tool.serverName ? `${tool.serverName} / ${tool.toolName}` : tool.name;
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
                  className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/40 px-3 py-2"
                >
                  <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center rounded-full border border-indigo-200/70 dark:border-indigo-700/60 bg-indigo-50/80 dark:bg-indigo-900/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                        Tool
                      </span>
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{label}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {tool.status}
                      {typeof tool.durationMs === 'number' ? ` · ${tool.durationMs}ms` : ''}
                    </span>
                  </summary>
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
                          <div className={`text-[11px] mb-1 ${tool.error ? 'text-rose-400' : 'text-zinc-400'}`}>
                            {tool.error ? 'Error' : 'Result'}
                          </div>
                          <div className={`whitespace-pre-wrap break-all ${tool.error ? 'text-rose-500' : ''}`}>
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
                </details>
              );
            })}
          </div>
        )}

        {hasSections &&
          sectionOrder.map((section, index) => {
            if (section === 'plan' && !plan) return null;
            if (section === 'research' && !research) return null;
            if (section === 'analysis' && !analysis) return null;
            if (section === 'risk' && !risk) return null;
            if (section === 'critic' && !critic) return null;
            if (section === 'tools') return null;
            if (section === 'agents' && (trace.length > 0 || agentTimeline.length === 0)) return null;
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
                              <div className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {agent.output}
                                </ReactMarkdown>
                              </div>
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
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({node, ...props}) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                a: ({node, ...props}) => <a className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                code: ({node, ...props}) => (
                  <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 font-mono text-xs break-all" {...props} />
                ),
                pre: ({node, ...props}) => (
                  <pre
                    className="bg-zinc-950 dark:bg-zinc-900 p-3 rounded-lg overflow-x-hidden my-2 border border-zinc-800 whitespace-pre-wrap break-all"
                    {...props}
                  />
                )
              }}
            >
              {displayedContent}
            </ReactMarkdown>
          </div>
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
