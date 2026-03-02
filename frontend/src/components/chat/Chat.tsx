'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatList } from './ChatList';
import { ChatInput } from './ChatInput';
import { AgentTimelinePanel } from './AgentTimelinePanel';
import { ToolTimelinePanel } from './ToolTimelinePanel';
import { Message, ModelOption, ThreadState } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { Download, Eye, X } from 'lucide-react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatProps {
  threadId: string | null;
}

type ChatMode = 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing';
type ToolTimelineItem = {
  callId?: string;
  name: string;
  serverName?: string;
  toolName?: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
};

const MODE_OPTIONS: Array<{ value: ChatMode; label: string; description: string }> = [
  { value: 'flash', label: 'Flash', description: '快速高效完成任务，但可能不够精准' },
  { value: 'thinking', label: 'Thinking', description: '先思考再行动，在速度与准确性之间取平衡' },
  { value: 'pro', label: 'Planner', description: '先规划再执行，获得更精准的结果，可能需要更多时间' },
  { value: 'ultra', label: 'Ultra', description: '继承自 Planner，可并行协作处理复杂任务，能力最强' },
  { value: 'vibefishing', label: 'Vibe Fishing', description: '规划 + 调研 + 执行协作，多代理协同模式' },
];

export function Chat({ threadId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [mode, setMode] = useState<ChatMode>('flash');
  const [modelError, setModelError] = useState<string>('');
  const [threadError, setThreadError] = useState<string>('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string>('');
  const [previewText, setPreviewText] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [agentTimeline, setAgentTimeline] = useState<
    Array<{
      name: string;
      status: 'running' | 'done' | 'error';
      durationMs?: number;
      output?: string;
      thinking?: string;
      thinkingActive?: boolean;
    }>
  >([]);
  const [toolTimeline, setToolTimeline] = useState<ToolTimelineItem[]>([]);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [selectedTimelineMessageId, setSelectedTimelineMessageId] = useState<string | null>(null);
  const [timelineAutoMode, setTimelineAutoMode] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortRequestedRef = useRef(false);
  const MODE_STORAGE_KEY = 'vibe_fishing_mode';
  const MODEL_STORAGE_KEY = 'vibe_fishing_model';

  const isAbortError = (error: unknown) => {
    return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'flash' || stored === 'thinking' || stored === 'pro' || stored === 'ultra' || stored === 'vibefishing') {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadModels = async () => {
      try {
        const res = await fetch('http://localhost:8000/models');
        if (!res.ok) {
          throw new Error('Failed to load models');
        }
        const data = await res.json();
        if (!active) return;
        const list: ModelOption[] = data.models ?? [];
        setModels(list);
        if (list.length > 0) {
          const stored = typeof window !== 'undefined' ? window.localStorage.getItem(MODEL_STORAGE_KEY) : null;
          setSelectedModelId((current) => {
            if (current && list.find((m) => m.id === current)) return current;
            if (stored && list.find((m) => m.id === stored)) return stored;
            return list[0].id;
          });
        }
        setModelError('');
      } catch (error) {
        if (!active) return;
        setModelError('Model list unavailable');
      }
    };
    loadModels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedModelId) return;
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId]
  );
  const selectedMode = useMemo(
    () => MODE_OPTIONS.find((opt) => opt.value === mode),
    [mode]
  );
  const assistantMessages = useMemo(() => {
    return messages.filter((message) => message.role === 'assistant');
  }, [messages]);

  useEffect(() => {
    if (!agentPanelOpen) return;
    if (!timelineAutoMode) return;
    if (streamingMessage) {
      if (selectedTimelineMessageId !== 'streaming') {
        setSelectedTimelineMessageId('streaming');
      }
      return;
    }
    if (!selectedTimelineMessageId || selectedTimelineMessageId === 'streaming') {
      const latest = assistantMessages[assistantMessages.length - 1];
      if (latest?.id && latest.id !== selectedTimelineMessageId) {
        setSelectedTimelineMessageId(latest.id);
      }
    }
  }, [agentPanelOpen, streamingMessage, assistantMessages, selectedTimelineMessageId, timelineAutoMode]);

  const timelineSourceMessage = useMemo(() => {
    if (selectedTimelineMessageId === 'streaming') {
      return streamingMessage ?? null;
    }
    if (!selectedTimelineMessageId) return null;
    return assistantMessages.find((message) => message.id === selectedTimelineMessageId) ?? null;
  }, [assistantMessages, selectedTimelineMessageId, streamingMessage]);

  const latestAgentTimeline = useMemo(() => {
    if (selectedTimelineMessageId === 'streaming' && agentTimeline.length > 0) return agentTimeline;
    const source = timelineSourceMessage;
    if (!source) return [];
    if (source.meta?.agentTimeline?.length) return source.meta.agentTimeline;
    if (source.meta?.agents?.length) {
      return source.meta.agents.map((agent) => ({
        name: agent.name,
        status: 'done' as const,
        output: agent.output,
      }));
    }
    return [];
  }, [agentTimeline, selectedTimelineMessageId, timelineSourceMessage]);

  const latestToolTimeline = useMemo(() => {
    if (selectedTimelineMessageId === 'streaming' && toolTimeline.length > 0) return toolTimeline;
    const source = timelineSourceMessage;
    if (!source) return [];
    return source.meta?.toolTimeline ?? [];
  }, [toolTimeline, selectedTimelineMessageId, timelineSourceMessage]);
  const previewArtifacts = useMemo(() => {
    const items: Array<{
      name: string;
      url: string;
      type: 'html' | 'markdown' | 'image' | 'video' | 'text' | 'pdf' | 'file';
    }> = [];
    for (const message of messages) {
      const artifacts = message.meta?.artifacts ?? [];
      for (const artifact of artifacts) {
        const name = artifact?.name;
        const url = artifact?.url;
        if (!name || !url) continue;
        const lower = name.toLowerCase();
        let type: 'html' | 'markdown' | 'image' | 'video' | 'text' | 'pdf' | 'file' = 'file';
        if (lower.endsWith('.html') || lower.endsWith('.htm')) {
          type = 'html';
        } else if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
          type = 'markdown';
        } else if (lower.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) {
          type = 'image';
        } else if (lower.match(/\.(mp4|webm|ogg)$/)) {
          type = 'video';
        } else if (lower.endsWith('.pdf')) {
          type = 'pdf';
        } else if (lower.match(/\.(txt|log|csv|json|xml)$/)) {
          type = 'text';
        }
        const fullUrl = url.startsWith('http') ? url : `http://localhost:8000${url}`;
        if (items.some((item) => item.url === fullUrl)) continue;
        items.push({ name, url: fullUrl, type });
      }
    }
    return items;
  }, [messages]);

  const timelineOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    if (streamingMessage) {
      options.push({ value: 'streaming', label: '当前回复（流式）' });
    }
    const assistantTurns = messages.filter((message) => message.role === 'assistant');
    assistantTurns.forEach((message, idx) => {
      const snippet = message.content.replace(/\s+/g, ' ').trim().slice(0, 24);
      const label = `第 ${idx + 1} 次回复 · ${snippet || '（无内容）'}`;
      options.push({ value: message.id, label });
    });
    return options;
  }, [messages, streamingMessage]);
  const hasPreviewArtifacts = previewArtifacts.length > 0;
  const hasAnyArtifacts = useMemo(
    () => messages.some((message) => (message.meta?.artifacts?.length ?? 0) > 0),
    [messages]
  );
  const selectedPreview = useMemo(
    () => previewArtifacts.find((item) => item.url === selectedPreviewUrl) ?? null,
    [previewArtifacts, selectedPreviewUrl]
  );

  useEffect(() => {
    if (!previewOpen) return;
    if (selectedPreviewUrl && previewArtifacts.some((item) => item.url === selectedPreviewUrl)) return;
    setSelectedPreviewUrl(previewArtifacts[0]?.url ?? '');
  }, [previewArtifacts, previewOpen, selectedPreviewUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    if (!selectedPreview) {
      setPreviewText('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    if (!(selectedPreview.type === 'markdown' || selectedPreview.type === 'text')) {
      setPreviewText('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let active = true;
    setPreviewLoading(true);
    setPreviewError('');
    fetch(selectedPreview.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!active) return;
        setPreviewText(text);
      })
      .catch((err) => {
        if (!active) return;
        setPreviewError(err instanceof Error ? err.message : 'Preview failed');
        setPreviewText('');
      })
      .finally(() => {
        if (!active) return;
        setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [previewOpen, selectedPreview]);

  useEffect(() => {
    let active = true;
    const loadThread = async () => {
      if (!threadId) {
        setMessages([]);
        return;
      }
      try {
        const res = await fetch(`http://localhost:8000/threads/${threadId}`);
        if (!res.ok) {
          throw new Error('Failed to load thread');
        }
        const data: ThreadState = await res.json();
        if (!active) return;
        setMessages(data.messages ?? []);
        setThreadError('');
      } catch (error) {
        if (!active) return;
        setThreadError('Thread unavailable');
      }
    };
    loadThread();
    return () => {
      active = false;
    };
  }, [threadId]);

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: Date.now(),
    };

    const streamingId = uuidv4();

    setMessages((prev) => [...prev, userMessage]);
    setStreamingMessage({
      id: streamingId,
      role: 'assistant',
      content: '',
      meta: { trace: [] },
      createdAt: Date.now(),
    });
    setIsLoading(true);
    setAgentTimeline([]);
    setToolTimeline([]);
    setAgentPanelOpen(true);
    abortRequestedRef.current = false;

    let streamedContent = '';
    let streamedReasoning = '';
    let reasoningActive = false;
    let streamedPlan = '';
    let streamedResearch = '';
    let streamedAnalysis = '';
    let streamedRisk = '';
    let streamedCritic = '';
    type TraceItem =
      | {
          type: 'agent';
          agentName: string;
          phase: 'thinking' | 'output';
          status: 'running' | 'done';
          content: string;
          durationMs?: number;
        }
      | {
          type: 'tool';
          callId?: string;
          name: string;
          serverName?: string;
          toolName?: string;
          status: 'running' | 'done' | 'error';
          durationMs?: number;
          args?: Record<string, unknown>;
          result?: string;
          error?: string;
        };
    let trace: TraceItem[] = [];
    let sectionOrder: Array<'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'thinking' | 'tools' | 'agents'> = [];
    const ensureSection = (section: 'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'thinking' | 'tools' | 'agents') => {
      if (!sectionOrder.includes(section)) {
        sectionOrder = [...sectionOrder, section];
      }
      setStreamingMessage((prev) => {
        if (!prev || prev.id !== streamingId) return prev;
        const current = prev.meta?.sections ?? [];
        if (current.includes(section)) {
          return prev;
        }
        return {
          ...prev,
          meta: {
            ...(prev.meta ?? {}),
            sections: [...current, section],
          },
        };
      });
    };
    let completed = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const finalizePartial = () => {
      const hasContent =
        streamedContent.trim().length > 0 ||
        streamedPlan.trim().length > 0 ||
        streamedResearch.trim().length > 0 ||
        streamedAnalysis.trim().length > 0 ||
        streamedRisk.trim().length > 0 ||
        streamedCritic.trim().length > 0 ||
        streamedReasoning.trim().length > 0;
      if (!hasContent) {
        setStreamingMessage(null);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: streamingId,
          role: 'assistant',
          content: streamedContent.trimEnd(),
          createdAt: Date.now(),
          meta: {
            streamingFinal: true,
            plan: streamedPlan || undefined,
            research: streamedResearch || undefined,
            analysis: streamedAnalysis || undefined,
            risk: streamedRisk || undefined,
            critic: streamedCritic || undefined,
            thinking: streamedReasoning || undefined,
            sections: sectionOrder.length > 0 ? sectionOrder : undefined,
            agentTimeline: agentTimeline.length > 0 ? agentTimeline : undefined,
            toolTimeline: toolTimeline.length > 0 ? toolTimeline : undefined,
            trace: trace.length > 0 ? trace : undefined,
          },
        },
      ]);
      setStreamingMessage(null);
    };
    try {
      const response = await fetch('http://localhost:8000/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          modelId: selectedModelId || undefined,
          threadId: threadId || undefined,
          mode,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      if (!response.body) {
        throw new Error('Streaming response missing body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';
      let dataLines: string[] = [];
      let isDone = false;

      const dispatch = (event: string, data: unknown) => {
        if (event === 'tool_call_delta') {
          const index = (data as any)?.index;
          const callId = (data as any)?.id;
          const name = (data as any)?.name;
          const argsPreview = (data as any)?.arguments;
          const resolvedName =
            typeof name === 'string' && name.length > 0
              ? name
              : typeof index === 'number'
                ? `tool_call[${index}]`
                : 'tool_call';
          const resolvedCallId = typeof callId === 'string' && callId.length > 0 ? callId : undefined;
          const parsedArgs =
            typeof argsPreview === 'string' && argsPreview.length > 0
              ? (() => {
                  try {
                    return JSON.parse(argsPreview) as Record<string, unknown>;
                  } catch {
                    return { arguments: argsPreview } as Record<string, unknown>;
                  }
                })()
              : undefined;

          ensureSection('tools');

          let updatedTrace = false;
          trace = trace.map((item) => {
            if (item.type !== 'tool') return item;
            if (item.status !== 'running') return item;
            if (resolvedCallId ? item.callId !== resolvedCallId : item.name !== resolvedName) return item;
            updatedTrace = true;
            return {
              ...item,
              callId: resolvedCallId ?? item.callId,
              name: resolvedName,
              args: parsedArgs ? { ...(item.args ?? {}), ...parsedArgs } : item.args,
            };
          });
          if (!updatedTrace) {
            trace = [
              ...trace,
              {
                type: 'tool',
                callId: resolvedCallId,
                name: resolvedName,
                status: 'running',
                args: parsedArgs,
              },
            ];
          }

          setToolTimeline((prev) => {
            const exists = resolvedCallId ? prev.some((item) => item.callId === resolvedCallId) : prev.some((item) => item.name === resolvedName);
            const next: ToolTimelineItem[] = exists
              ? prev.map((item): ToolTimelineItem =>
                  (resolvedCallId ? item.callId === resolvedCallId : item.name === resolvedName)
                    ? {
                        ...item,
                        callId: resolvedCallId ?? item.callId,
                        name: resolvedName,
                        status: 'running',
                        args: parsedArgs ? { ...(item.args ?? {}), ...parsedArgs } : item.args,
                      }
                    : item
                )
              : [
                  ...prev,
                  {
                    callId: resolvedCallId,
                    name: resolvedName,
                    status: 'running',
                    args: parsedArgs,
                  },
                ];

            setStreamingMessage((prevMessage) => {
              if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
              return {
                ...prevMessage,
                meta: { ...(prevMessage.meta ?? {}), toolTimeline: next, toolsActive: true },
              } as Message;
            });
            return next;
          });

          setStreamingMessage((prev) => {
            if (!prev || prev.id !== streamingId) return prev;
            return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
          });
          return;
        }

        if (event === 'tool_start') {
          const callId = (data as any)?.callId;
          const name = (data as any)?.name;
          const serverName = (data as any)?.serverName;
          const toolName = (data as any)?.toolName;
          const args = (data as any)?.args;
          if (typeof name === 'string' && name.length > 0) {
            ensureSection('tools');
            const resolvedCallId = typeof callId === 'string' ? callId : undefined;
            let updatedTrace = false;
            trace = trace.map((item) => {
              if (item.type !== 'tool') return item;
              if (item.status !== 'running') return item;
              if (resolvedCallId ? item.callId !== resolvedCallId : item.name !== name) return item;
              updatedTrace = true;
              return {
                ...item,
                callId: resolvedCallId ?? item.callId,
                name,
                serverName: typeof serverName === 'string' ? serverName : item.serverName,
                toolName: typeof toolName === 'string' ? toolName : item.toolName,
                args: typeof args === 'object' ? ({ ...(item.args ?? {}), ...(args as Record<string, unknown>) } as Record<string, unknown>) : item.args,
              };
            });
            if (!updatedTrace) {
              trace = [
                ...trace,
                {
                  type: 'tool',
                  callId: resolvedCallId,
                  name,
                  serverName: typeof serverName === 'string' ? serverName : undefined,
                  toolName: typeof toolName === 'string' ? toolName : undefined,
                  status: 'running',
                  args: typeof args === 'object' ? (args as Record<string, unknown>) : undefined,
                },
              ];
            }
            setToolTimeline((prev) => {
              const exists = typeof callId === 'string'
                ? prev.some((item) => item.callId === callId)
                : prev.some((item) => item.name === name);
              const next: ToolTimelineItem[] = exists
                ? prev.map((item): ToolTimelineItem =>
                    (typeof callId === 'string' ? item.callId === callId : item.name === name)
                      ? {
                          ...item,
                          callId: typeof callId === 'string' ? callId : item.callId,
                          status: 'running',
                          serverName: typeof serverName === 'string' ? serverName : item.serverName,
                          toolName: typeof toolName === 'string' ? toolName : item.toolName,
                          args:
                            typeof args === 'object'
                              ? ({ ...(item.args ?? {}), ...(args as Record<string, unknown>) } as Record<string, unknown>)
                              : item.args,
                        }
                      : item
                  )
                : [
                    ...prev,
                    {
                      callId: typeof callId === 'string' ? callId : undefined,
                      name,
                      serverName: typeof serverName === 'string' ? serverName : undefined,
                      toolName: typeof toolName === 'string' ? toolName : undefined,
                      status: 'running',
                      args: typeof args === 'object' ? (args as Record<string, unknown>) : undefined,
                    },
                  ];
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return {
                  ...prevMessage,
                  meta: { ...(prevMessage.meta ?? {}), toolTimeline: next, toolsActive: true },
                } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'tool_end') {
          const callId = (data as any)?.callId;
          const name = (data as any)?.name;
          const durationMs = (data as any)?.durationMs;
          const ok = (data as any)?.ok;
          const result = (data as any)?.result;
          const error = (data as any)?.error;
          if (typeof name === 'string' && name.length > 0) {
            ensureSection('tools');
            const matchId = typeof callId === 'string' && callId.length > 0 ? callId : undefined;
            const status: 'done' | 'error' = ok === false ? 'error' : 'done';
            let updated = false;
            trace = trace.map((item) => {
              if (item.type !== 'tool') return item;
              if (item.status !== 'running') return item;
              if (matchId ? item.callId !== matchId : item.name !== name) return item;
              updated = true;
              return {
                ...item,
                status,
                durationMs: typeof durationMs === 'number' ? durationMs : item.durationMs,
                result: typeof result === 'string' ? result : item.result,
                error: typeof error === 'string' ? error : item.error,
              };
            });
            if (!updated) {
              trace = [
                ...trace,
                {
                  type: 'tool',
                  callId: matchId,
                  name,
                  status,
                  durationMs: typeof durationMs === 'number' ? durationMs : undefined,
                  result: typeof result === 'string' ? result : undefined,
                  error: typeof error === 'string' ? error : undefined,
                },
              ];
            }
            setToolTimeline((prev) => {
              const status: ToolTimelineItem['status'] = ok === false ? 'error' : 'done';
              const next: ToolTimelineItem[] = prev.map((item): ToolTimelineItem =>
                (typeof callId === 'string' ? item.callId === callId : item.name === name)
                  ? {
                      ...item,
                      callId: typeof callId === 'string' ? callId : item.callId,
                      status,
                      durationMs: typeof durationMs === 'number' ? durationMs : item.durationMs,
                      result: typeof result === 'string' ? result : item.result,
                      error: typeof error === 'string' ? error : item.error,
                    }
                  : item
              );
              const hasRunning = next.some((item) => item.status === 'running');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return {
                  ...prevMessage,
                  meta: { ...(prevMessage.meta ?? {}), toolTimeline: next, toolsActive: hasRunning },
                } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'agent_start') {
          const name = (data as any)?.name;
          if (typeof name === 'string' && name.length > 0) {
            setAgentTimeline((prev) => {
              const existing = prev.find((item) => item.name === name);
              const next: typeof prev = existing
                ? prev.map((item) => (item.name === name ? { ...item, status: 'running' as const } : item))
                : [...prev, { name, status: 'running' as const }];
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
          }
          return;
        }

        if (event === 'agent_end') {
          const name = (data as any)?.name;
          const durationMs = (data as any)?.durationMs;
          if (typeof name === 'string' && name.length > 0) {
            trace = trace.map((item) => {
              if (item.type !== 'agent') return item;
              if (item.agentName !== name) return item;
              if (item.phase !== 'output') return item;
              if (item.status !== 'running') return item;
              return { ...item, status: 'done', durationMs: typeof durationMs === 'number' ? durationMs : item.durationMs };
            });
            setAgentTimeline((prev) => {
              const hasExisting = prev.some((item) => item.name === name);
              const next: typeof prev = hasExisting
                ? prev.map((item) =>
                    item.name === name
                      ? {
                          ...item,
                          status: 'done' as const,
                          durationMs: typeof durationMs === 'number' ? durationMs : item.durationMs,
                        }
                      : item
                  )
                : [
                    ...prev,
                    {
                      name,
                      status: 'done' as const,
                      durationMs: typeof durationMs === 'number' ? durationMs : undefined,
                    },
                  ];
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
            if (name === 'analyst' || name === 'risk' || name === 'critic') {
              setStreamingMessage((prev) => {
                if (!prev || prev.id !== streamingId) return prev;
                if (name === 'analyst') {
                  return { ...prev, meta: { ...(prev.meta ?? {}), analysisActive: false } };
                }
                if (name === 'risk') {
                  return { ...prev, meta: { ...(prev.meta ?? {}), riskActive: false } };
                }
                return { ...prev, meta: { ...(prev.meta ?? {}), criticActive: false } };
              });
            }
          }
          return;
        }

        if (event === 'agent_delta') {
          const name = (data as any)?.name;
          const delta = (data as any)?.delta;
          if (typeof name === 'string' && typeof delta === 'string' && delta.length > 0) {
            const last = trace.length > 0 ? trace[trace.length - 1] : null;
            if (last && last.type === 'agent' && last.agentName === name && last.phase === 'output' && last.status === 'running') {
              trace = trace.slice(0, -1).concat([{ ...last, content: `${last.content}${delta}` }]);
            } else {
              trace = [...trace, { type: 'agent', agentName: name, phase: 'output', status: 'running', content: delta }];
            }
            setAgentTimeline((prev) => {
              const exists = prev.some((item) => item.name === name);
              const next: typeof prev = !exists
                ? [...prev, { name, status: 'running' as const, output: delta }]
                : prev.map((item) =>
                    item.name === name
                      ? { ...item, status: item.status === 'done' ? item.status : 'running', output: `${item.output ?? ''}${delta}` }
                      : item
                  );
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
              if (name === 'analyst') {
              streamedAnalysis += delta;
              ensureSection('analysis');
              setStreamingMessage((prev) => {
                if (!prev || prev.id !== streamingId) return prev;
                  return {
                    ...prev,
                    meta: { ...(prev.meta ?? {}), analysis: streamedAnalysis, analysisActive: true },
                  };
              });
              return;
            }
              if (name === 'risk') {
              streamedRisk += delta;
              ensureSection('risk');
              setStreamingMessage((prev) => {
                if (!prev || prev.id !== streamingId) return prev;
                  return {
                    ...prev,
                    meta: { ...(prev.meta ?? {}), risk: streamedRisk, riskActive: true },
                  };
              });
              return;
            }
              if (name === 'critic') {
              streamedCritic += delta;
              ensureSection('critic');
              setStreamingMessage((prev) => {
                if (!prev || prev.id !== streamingId) return prev;
                  return {
                    ...prev,
                    meta: { ...(prev.meta ?? {}), critic: streamedCritic, criticActive: true },
                  };
              });
            }
          }
          return;
        }

        if (event === 'agent_thinking_start') {
          const name = (data as any)?.name;
          if (typeof name === 'string' && name.length > 0) {
            trace = [...trace, { type: 'agent', agentName: name, phase: 'thinking', status: 'running', content: '' }];
            setAgentTimeline((prev) => {
              const exists = prev.some((item) => item.name === name);
              const next: typeof prev = !exists
                ? [...prev, { name, status: 'running' as const, thinkingActive: true }]
                : prev.map((item) => (item.name === name ? { ...item, thinkingActive: true } : item));
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'agent_thinking_delta') {
          const name = (data as any)?.name;
          const delta = (data as any)?.delta;
          if (typeof name === 'string' && typeof delta === 'string' && delta.length > 0) {
            const last = trace.length > 0 ? trace[trace.length - 1] : null;
            if (last && last.type === 'agent' && last.agentName === name && last.phase === 'thinking' && last.status === 'running') {
              trace = trace.slice(0, -1).concat([{ ...last, content: `${last.content}${delta}` }]);
            } else {
              trace = [...trace, { type: 'agent', agentName: name, phase: 'thinking', status: 'running', content: delta }];
            }
            setAgentTimeline((prev) => {
              const exists = prev.some((item) => item.name === name);
              const next: typeof prev = !exists
                ? [...prev, { name, status: 'running' as const, thinking: delta, thinkingActive: true }]
                : prev.map((item) =>
                    item.name === name
                      ? { ...item, status: item.status === 'done' ? item.status : 'running', thinking: `${item.thinking ?? ''}${delta}`, thinkingActive: true }
                      : item
                  );
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'agent_thinking_end') {
          const name = (data as any)?.name;
          if (typeof name === 'string' && name.length > 0) {
            for (let index = trace.length - 1; index >= 0; index -= 1) {
              const item = trace[index];
              if (item.type !== 'agent') continue;
              if (item.agentName !== name) continue;
              if (item.phase !== 'thinking') continue;
              if (item.status !== 'running') continue;
              trace = trace.slice(0, index).concat([{ ...item, status: 'done' }], trace.slice(index + 1));
              break;
            }
            setAgentTimeline((prev) => {
              const next: typeof prev = prev.map((item) => (item.name === name ? { ...item, thinkingActive: false } : item));
              ensureSection('agents');
              setStreamingMessage((prevMessage) => {
                if (!prevMessage || prevMessage.id !== streamingId) return prevMessage;
                return { ...prevMessage, meta: { ...(prevMessage.meta ?? {}), agentTimeline: next } } as Message;
              });
              return next;
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'plan_start') {
          streamedPlan = '';
          ensureSection('plan');
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), planActive: true } } : prev));
          return;
        }

        if (event === 'plan_end') {
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), planActive: false } } : prev));
          return;
        }

        if (event === 'plan_delta') {
          const delta = (data as any)?.delta;
          if (typeof delta === 'string' && delta.length > 0) {
            streamedPlan += delta;
            ensureSection('plan');
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), plan: streamedPlan } };
            });
          }
          return;
        }

        if (event === 'research_start') {
          streamedResearch = '';
          ensureSection('research');
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), researchActive: true } } : prev));
          return;
        }

        if (event === 'research_end') {
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), researchActive: false } } : prev));
          return;
        }

        if (event === 'research_delta') {
          const delta = (data as any)?.delta;
          if (typeof delta === 'string' && delta.length > 0) {
            streamedResearch += delta;
            ensureSection('research');
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), research: streamedResearch } };
            });
          }
          return;
        }

        if (event === 'delta') {
          const delta = (data as any)?.delta;
          if (typeof delta === 'string' && delta.length > 0) {
            if (reasoningActive) {
              reasoningActive = false;
              setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), reasoningActive: false } } : prev));
            }
            streamedContent += delta;
          }
          return;
        }

        if (event === 'reasoning_start') {
          reasoningActive = true;
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), reasoningActive: true } } : prev));
          return;
        }

        if (event === 'reasoning_end') {
          reasoningActive = false;
          setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), reasoningActive: false } } : prev));
          return;
        }

        if (event === 'reasoning_delta') {
          const delta = (data as any)?.delta;
          if (typeof delta === 'string' && delta.length > 0) {
            if (!reasoningActive) {
              reasoningActive = true;
              setStreamingMessage((prev) => (prev ? { ...prev, meta: { ...(prev.meta ?? {}), reasoningActive: true } } : prev));
            }
            streamedReasoning += delta;
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), thinking: streamedReasoning } };
            });
          }
          return;
        }

        if (event === 'agent') {
          const name = (data as any)?.name;
          const output = (data as any)?.output;
          if (typeof name === 'string' && typeof output === 'string') {
            for (let index = trace.length - 1; index >= 0; index -= 1) {
              const item = trace[index];
              if (item.type !== 'agent') continue;
              if (item.agentName !== name) continue;
              if (item.phase !== 'output') continue;
              if (item.status !== 'running') continue;
              trace = trace.slice(0, index).concat([{ ...item, content: output, status: 'done' }], trace.slice(index + 1));
              break;
            }
            setAgentTimeline((prev) => {
              const exists = prev.some((item) => item.name === name);
              if (!exists) return [...prev, { name, status: 'done', output }];
              return prev.map((item) => (item.name === name ? { ...item, output } : item));
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              const agents = prev.meta?.agents ?? [];
              const nextAgents = [...agents.filter((a) => a.name !== name), { name, output }];
              let meta = { ...(prev.meta ?? {}), agents: nextAgents };
              if (name === 'analyst') {
                streamedAnalysis = output;
                ensureSection('analysis');
                meta = { ...meta, analysis: output };
              }
              if (name === 'risk') {
                streamedRisk = output;
                ensureSection('risk');
                meta = { ...meta, risk: output };
              }
              if (name === 'critic') {
                streamedCritic = output;
                ensureSection('critic');
                meta = { ...meta, critic: output };
              }
              return { ...prev, meta };
            });
            setStreamingMessage((prev) => {
              if (!prev || prev.id !== streamingId) return prev;
              return { ...prev, meta: { ...(prev.meta ?? {}), trace } };
            });
          }
          return;
        }

        if (event === 'done') {
          const messages = (data as any)?.messages;
          if (Array.isArray(messages)) {
            completed = true;
            const nextMessages = messages.map((msg: Message, index: number) => {
              if (index !== messages.length - 1) return msg;
              if (msg.role !== 'assistant') return msg;
              const agents = msg.meta?.agents ?? [];
              const analysis = msg.meta?.analysis ?? agents.find((a) => a.name === 'analyst')?.output;
              const risk = msg.meta?.risk ?? agents.find((a) => a.name === 'risk')?.output;
              const critic = msg.meta?.critic ?? agents.find((a) => a.name === 'critic')?.output;
              return {
                ...msg,
                meta: {
                  ...(msg.meta ?? {}),
                  streamingFinal: true,
                  plan: (msg.meta?.plan ?? streamedPlan) || undefined,
                  research: (msg.meta?.research ?? streamedResearch) || undefined,
                  analysis: analysis || streamedAnalysis || undefined,
                  risk: risk || streamedRisk || undefined,
                  critic: critic || streamedCritic || undefined,
                  thinking: (msg.meta?.thinking ?? streamedReasoning) || undefined,
                  sections: (msg.meta?.sections ?? sectionOrder) as Array<
                    'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'thinking' | 'tools' | 'agents'
                  >,
                  agentTimeline: msg.meta?.agentTimeline ?? (agentTimeline.length > 0 ? agentTimeline : undefined),
                  toolTimeline: msg.meta?.toolTimeline ?? (toolTimeline.length > 0 ? toolTimeline : undefined),
                  trace: msg.meta?.trace ?? (trace.length > 0 ? trace : undefined),
                },
              };
            });
            setStreamingMessage(null);
            setMessages(nextMessages);
          } else {
            completed = true;
            const meta = (data as any)?.meta;
            const agents = meta?.agents ?? [];
            const analysis = meta?.analysis ?? agents.find((a: any) => a.name === 'analyst')?.output;
            const risk = meta?.risk ?? agents.find((a: any) => a.name === 'risk')?.output;
            const critic = meta?.critic ?? agents.find((a: any) => a.name === 'critic')?.output;
            setMessages((prev) => [
              ...prev,
              {
                id: streamingId,
                role: 'assistant',
                content: streamedContent.trimEnd(),
                meta: {
                  ...(meta ?? {}),
                  streamingFinal: true,
                  plan: (meta?.plan ?? streamedPlan) || undefined,
                  research: (meta?.research ?? streamedResearch) || undefined,
                  analysis: analysis || streamedAnalysis || undefined,
                  risk: risk || streamedRisk || undefined,
                  critic: critic || streamedCritic || undefined,
                  thinking: (meta?.thinking ?? streamedReasoning) || undefined,
                  sections: (meta?.sections ?? sectionOrder) as Array<
                    'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'thinking' | 'tools' | 'agents'
                  >,
                  agentTimeline: meta?.agentTimeline ?? (agentTimeline.length > 0 ? agentTimeline : undefined),
                  toolTimeline: meta?.toolTimeline ?? (toolTimeline.length > 0 ? toolTimeline : undefined),
                  trace: meta?.trace ?? (trace.length > 0 ? trace : undefined),
                },
                createdAt: Date.now(),
              },
            ]);
          }
          isDone = true;
          setStreamingMessage(null);
          return;
        }

        if (event === 'error') {
          const error = (data as any)?.error;
          const text = typeof error === 'string' && error.length > 0 ? error : 'Sorry, something went wrong. Please try again.';
          setAgentTimeline((prev) => prev.map((item) => (item.status === 'running' ? { ...item, status: 'error' } : item)));
          setMessages((prev) => [
            ...prev,
            {
              id: streamingId,
              role: 'assistant',
              content: text,
              createdAt: Date.now(),
            },
          ]);
          isDone = true;
          setStreamingMessage(null);
        }
      };

      while (!isDone) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf('\n');
        while (idx !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf('\n');

          const trimmed = line.replace(/\r$/, '');
          if (trimmed.length === 0) {
            if (dataLines.length > 0) {
              const payload = dataLines.join('\n');
              dataLines = [];
              try {
                dispatch(currentEvent, JSON.parse(payload));
              } catch {
              }
            }
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim() || 'message';
            continue;
          }
          if (trimmed.startsWith('data:')) {
            dataLines.push(trimmed.slice(5).trim());
            continue;
          }
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        abortRequestedRef.current = true;
      } else {
        console.error('Error sending message:', error);
        setMessages((prev) => [
          ...prev,
          {
            id: streamingId,
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
            createdAt: Date.now(),
          },
        ]);
        setStreamingMessage(null);
      }
    } finally {
      if (abortRequestedRef.current && !completed) {
        finalizePartial();
      }
      setIsLoading(false);
      setStreamingMessage(null);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Vibe Chat</span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {selectedModel ? `${selectedModel.name}${selectedModel.provider ? ` · ${selectedModel.provider}` : ''}` : 'Select a model'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAgentPanelOpen(true)}
            className="h-9 px-3 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium shadow-sm transition-colors bg-white/80 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800"
          >
            Agent
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className={`h-9 px-3 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium shadow-sm transition-colors ${
              hasPreviewArtifacts
                ? 'bg-white/80 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800'
                : 'bg-zinc-100/60 dark:bg-zinc-900/40 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
            }`}
            disabled={!hasPreviewArtifacts}
          >
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              预览
            </span>
          </button>
        </div>
      </div>
      {threadError && (
        <div className="px-6 py-2 text-xs text-rose-500 bg-rose-50/80 dark:bg-rose-900/20 border-b border-rose-200/60 dark:border-rose-900/40">
          {threadError}
        </div>
      )}
      {modelError && (
        <div className="px-6 py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-900/20 border-b border-amber-200/60 dark:border-amber-900/40">
          {modelError}
        </div>
      )}
      <div className="flex-1 overflow-hidden relative">
        <ChatList
          messages={messages}
          isLoading={isLoading}
          streamingMessage={streamingMessage}
          isSidePanelOpen={agentPanelOpen || previewOpen}
          mode={mode}
        />
        <div className="absolute bottom-0 left-0 w-full p-4 md:p-6 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-black dark:via-black/90 pt-10 z-10">
          <div className={`mx-auto ${agentPanelOpen || previewOpen ? 'max-w-6xl' : 'max-w-5xl'}`}>
            <ChatInput
              onSend={handleSend}
              onStop={() => {
                abortRequestedRef.current = true;
                abortControllerRef.current?.abort();
              }}
              disabled={isLoading}
              modelOptions={models}
              selectedModelId={selectedModelId}
              onModelChange={(id) => setSelectedModelId(id)}
              mode={mode}
              modeOptions={MODE_OPTIONS}
              onModeChange={(nextMode: ChatMode) => setMode(nextMode)}
              selectedModeDescription={selectedMode?.description ?? ''}
              isModeDisabled={isLoading}
              isModelDisabled={models.length === 0}
            />
          </div>
        </div>
        {agentPanelOpen && (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              className="absolute inset-0 bg-black/20 dark:bg-black/40"
              onClick={() => setAgentPanelOpen(false)}
              aria-label="Close agent panel"
            />
            <div className="absolute right-0 top-0 h-full w-full max-w-[520px] border-l border-zinc-200/70 dark:border-zinc-800/70 bg-white/95 dark:bg-zinc-950/90 backdrop-blur-xl shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Agent</div>
                <button
                  type="button"
                  className="h-8 w-8 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-zinc-500 dark:text-zinc-300 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  onClick={() => setAgentPanelOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">选择回复查看轨迹</div>
                <select
                  value={selectedTimelineMessageId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === '') {
                      setTimelineAutoMode(true);
                      setSelectedTimelineMessageId(null);
                      return;
                    }
                    setTimelineAutoMode(false);
                    setSelectedTimelineMessageId(value);
                  }}
                  className="w-full h-9 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-200 px-2"
                >
                  <option value="">自动（最新）</option>
                  {timelineOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="space-y-4">
                  <AgentTimelinePanel items={latestAgentTimeline} />
                  <ToolTimelinePanel items={latestToolTimeline} />
                </div>
              </div>
            </div>
          </div>
        )}
        {previewOpen && (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              className="absolute inset-0 bg-black/20 dark:bg-black/40"
              onClick={() => setPreviewOpen(false)}
              aria-label="Close preview"
            />
            <div className="absolute right-0 top-0 h-full w-full max-w-[640px] border-l border-zinc-200/70 dark:border-zinc-800/70 bg-white/95 dark:bg-zinc-950/90 backdrop-blur-xl shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">预览</div>
                <div className="flex items-center gap-2">
                  <a
                    className={`h-8 px-2 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium transition-colors flex items-center gap-1 ${
                      hasAnyArtifacts
                        ? 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        : 'text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                    }`}
                    href={threadId ? `http://localhost:8000/artifacts/${threadId}/download` : undefined}
                    aria-disabled={!hasAnyArtifacts}
                    onClick={(event) => {
                      if (!hasAnyArtifacts) event.preventDefault();
                    }}
                  >
                    <Download className="h-4 w-4" />
                    下载产物
                  </a>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-zinc-500 dark:text-zinc-300 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => setPreviewOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {hasPreviewArtifacts ? (
                <>
                  <div className="px-4 py-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
                    <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">文件</div>
                    <div className="flex flex-col gap-1">
                      {previewArtifacts.map((item) => (
                        <button
                          key={item.url}
                          type="button"
                          onClick={() => setSelectedPreviewUrl(item.url)}
                          className={`rounded-lg px-2 py-1 text-xs text-left transition-colors ${
                            selectedPreviewUrl === item.url
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                              : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                          }`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0">
                    {!selectedPreview ? (
                      <div className="h-full flex items-center justify-center text-xs text-zinc-400">
                        未选择可预览文件
                      </div>
                    ) : selectedPreview.type === 'image' ? (
                      <div className="h-full w-full flex items-center justify-center bg-white dark:bg-zinc-950 p-4">
                        <div className="relative max-h-full max-w-full w-full h-full">
                          <Image
                            src={selectedPreview.url}
                            alt={selectedPreview.name}
                            fill
                            sizes="(max-width: 480px) 100vw, 480px"
                            className="object-contain rounded-lg"
                            unoptimized
                          />
                        </div>
                      </div>
                    ) : selectedPreview.type === 'video' ? (
                      <video className="w-full h-full bg-black" src={selectedPreview.url} controls />
                    ) : selectedPreview.type === 'pdf' ? (
                      <iframe
                        className="w-full h-full bg-white dark:bg-zinc-950"
                        src={selectedPreview.url}
                        title="Artifact Preview"
                      />
                    ) : selectedPreview.type === 'markdown' ? (
                      <div className="h-full overflow-auto bg-white dark:bg-zinc-950 p-4">
                        {previewLoading ? (
                          <div className="text-xs text-zinc-400">加载中…</div>
                        ) : previewError ? (
                          <div className="text-xs text-rose-500">预览失败：{previewError}</div>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewText}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    ) : selectedPreview.type === 'text' ? (
                      <div className="h-full overflow-auto bg-white dark:bg-zinc-950 p-4">
                        {previewLoading ? (
                          <div className="text-xs text-zinc-400">加载中…</div>
                        ) : previewError ? (
                          <div className="text-xs text-rose-500">预览失败：{previewError}</div>
                        ) : (
                          <pre className="whitespace-pre-wrap break-words text-xs text-zinc-800 dark:text-zinc-200">
                            {previewText}
                          </pre>
                        )}
                      </div>
                    ) : selectedPreview.type === 'html' ? (
                      <iframe
                        className="w-full h-full bg-white dark:bg-zinc-950"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        src={selectedPreview.url}
                        title="Artifact Preview"
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
                        <div>暂不支持该格式预览</div>
                        <a
                          className="text-emerald-600 dark:text-emerald-400 hover:underline"
                          href={selectedPreview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          在新窗口打开
                        </a>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-400">
                  暂无可预览文件
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
