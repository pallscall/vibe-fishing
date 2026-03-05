'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatList } from './ChatList';
import { ChatInput } from './ChatInput';
import { ToolTimelinePanel } from './ToolTimelinePanel';
import { Message, ModelOption, ThreadState } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { Download, Eye, FileText, Folder, Globe, Loader2, Monitor, RefreshCcw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface ChatProps {
  threadId: string | null;
}

type ChatMode = 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing';
type ToolTimelineItem = {
  callId?: string;
  name: string;
  serverName?: string;
  toolName?: string;
  agentName?: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
};

type ArtifactItem = {
  name: string;
  size: number;
  url: string;
};

type FileNode =
  | { type: 'dir'; name: string; path: string; children: FileNode[] }
  | { type: 'file'; name: string; path: string; artifact: ArtifactItem };

const MODE_OPTIONS: Array<{ value: ChatMode; label: string; description: string }> = [
  { value: 'flash', label: 'Flash', description: '快速高效完成任务，但可能不够精准' },
  { value: 'thinking', label: 'Thinking', description: '先思考再行动，在速度与准确性之间取平衡' },
  { value: 'pro', label: 'Planner', description: '先规划再执行，获得更精准的结果，可能需要更多时间' },
  { value: 'ultra', label: 'Ultra', description: '继承自 Planner，可并行协作处理复杂任务，能力最强' },
  { value: 'vibefishing', label: 'Vibe Fishing', description: '规划 + 调研 + 执行协作，多代理协同模式' },
];

const MAX_INLINE_BYTES = 2 * 1024 * 1024;

export function Chat({ threadId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [mode, setMode] = useState<ChatMode>('flash');
  const [modelError, setModelError] = useState<string>('');
  const [threadError, setThreadError] = useState<string>('');
  const [sandboxUiUrl, setSandboxUiUrl] = useState<string>('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<'files' | 'sandbox'>('files');
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsError, setArtifactsError] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<string[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [viewerMode, setViewerMode] = useState<'preview' | 'source'>('preview');
  const [fileText, setFileText] = useState<string>('');
  const [fileBinary, setFileBinary] = useState(false);
  const [fileBase64, setFileBase64] = useState('');
  const [fileContentType, setFileContentType] = useState('');
  const [fileTruncated, setFileTruncated] = useState(false);
  const [fileTotalBytes, setFileTotalBytes] = useState<number | null>(null);
  const [fileTextLoading, setFileTextLoading] = useState(false);
  const [fileTextError, setFileTextError] = useState('');
  const [sourceCopied, setSourceCopied] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloadAvailable, setDownloadAvailable] = useState<boolean | null>(null);
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

  const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
  const apiUrl = (pathname: string) => {
    const trimmed = pathname.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `${API_BASE_URL}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  };

  const normalizeArtifactUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('/')) return apiUrl(trimmed);
    return apiUrl(`/${trimmed}`);
  };

  const getExtension = (name: string) => {
    const base = name.split('?')[0] ?? name;
    const idx = base.lastIndexOf('.');
    if (idx < 0) return '';
    return base.slice(idx + 1).toLowerCase();
  };

  const isTextLikeExtension = (ext: string) => {
    return (
      ext === 'md' ||
      ext === 'markdown' ||
      ext === 'txt' ||
      ext === 'log' ||
      ext === 'csv' ||
      ext === 'xml' ||
      ext === 'json' ||
      ext === 'html' ||
      ext === 'htm' ||
      ext === 'css' ||
      ext === 'js' ||
      ext === 'ts' ||
      ext === 'tsx' ||
      ext === 'jsx' ||
      ext === 'py' ||
      ext === 'go' ||
      ext === 'rs' ||
      ext === 'java' ||
      ext === 'yml' ||
      ext === 'yaml' ||
      ext === 'toml'
    );
  };

  const formatByteSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const isProbablyBinaryContent = (bytes: Uint8Array) => {
    const max = Math.min(bytes.length, 4096);
    if (max === 0) return false;
    let suspicious = 0;
    for (let i = 0; i < max; i += 1) {
      const b = bytes[i]!;
      if (b === 0) return true;
      const isPrintableAscii = b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126);
      if (!isPrintableAscii && b < 128) suspicious += 1;
    }
    return suspicious / max > 0.2;
  };

  const uint8ToBase64 = (bytes: Uint8Array) => {
    if (bytes.length === 0) return '';
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      const chars = new Array(chunk.length);
      for (let j = 0; j < chunk.length; j += 1) {
        chars[j] = String.fromCharCode(chunk[j]!);
      }
      binary += chars.join('');
    }
    return btoa(binary);
  };

  const readResponsePrefix = async (res: Response, limit: number) => {
    const body = res.body;
    if (!body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      const truncated = buf.length > limit;
      return { bytes: truncated ? buf.slice(0, limit) : buf, truncated };
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (received + value.length > limit) {
        const need = limit - received;
        if (need > 0) chunks.push(value.slice(0, need));
        received = limit;
        truncated = true;
        try {
          await reader.cancel();
        } catch {
        }
        break;
      }
      chunks.push(value);
      received += value.length;
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes: out, truncated };
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

  const buildFileTree = (items: ArtifactItem[]): FileNode[] => {
    const root: { children: FileNode[] } = { children: [] };

    const upsertDir = (children: FileNode[], name: string, path: string) => {
      const existing = children.find((node) => node.type === 'dir' && node.name === name) as
        | { type: 'dir'; name: string; path: string; children: FileNode[] }
        | undefined;
      if (existing) return existing;
      const created: FileNode = { type: 'dir', name, path, children: [] };
      children.push(created);
      children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return created as { type: 'dir'; name: string; path: string; children: FileNode[] };
    };

    for (const artifact of items) {
      const parts = artifact.name.split('/').filter(Boolean);
      if (parts.length === 0) continue;
      let currentChildren = root.children;
      let currentPath = '';
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!;
        const nextPath = currentPath ? `${currentPath}/${part}` : part;
        const isLeaf = i === parts.length - 1;
        if (isLeaf) {
          const existing = currentChildren.find((node) => node.type === 'file' && node.path === nextPath);
          if (existing) continue;
          currentChildren.push({ type: 'file', name: part, path: nextPath, artifact });
          currentChildren.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        } else {
          const dir = upsertDir(currentChildren, part, nextPath);
          currentChildren = dir.children;
          currentPath = nextPath;
        }
      }
    }

    return root.children;
  };

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
        const res = await fetch(apiUrl('/models'));
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
    let active = true;
    const url = threadId
      ? apiUrl(`/sandbox/info?threadId=${encodeURIComponent(threadId)}`)
      : apiUrl('/sandbox/info');
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const ui = typeof data?.uiUrl === 'string' ? data.uiUrl : '';
        setSandboxUiUrl(ui);
      })
      .catch(() => {
        if (!active) return;
        setSandboxUiUrl('');
      });
    return () => {
      active = false;
    };
  }, [threadId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedModelId) return;
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    if (mode === 'flash' && agentPanelOpen) {
      setAgentPanelOpen(false);
    }
  }, [mode, agentPanelOpen]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId]
  );
  const selectedMode = useMemo(
    () => MODE_OPTIONS.find((opt) => opt.value === mode),
    [mode]
  );
  const isFlash = mode === 'flash';
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

  const latestToolTimeline = useMemo(() => {
    if (selectedTimelineMessageId === 'streaming' && toolTimeline.length > 0) return toolTimeline;
    const source = timelineSourceMessage;
    if (!source) return [];
    return source.meta?.toolTimeline ?? [];
  }, [toolTimeline, selectedTimelineMessageId, timelineSourceMessage]);

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
  const hasAnyArtifacts = useMemo(
    () =>
      messages.some((message) => (message.meta?.artifacts?.length ?? 0) > 0) ||
      (streamingMessage?.meta?.artifacts?.length ?? 0) > 0,
    [messages, streamingMessage]
  );
  const canDownloadArtifacts = (downloadAvailable ?? hasAnyArtifacts) && Boolean(threadId);
  const sandboxPreviewUrl = useMemo(() => {
    const normalized = sandboxUiUrl.trim();
    if (!normalized) return '';
    const raw = normalized.startsWith('http') ? normalized : `http://${normalized}`;
    try {
      const url = new URL(raw);
      if (!url.searchParams.has('folder')) {
        url.searchParams.set('folder', '/tmp/user-data');
      }
      return url.toString();
    } catch {
      return raw;
    }
  }, [sandboxUiUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    setPreviewTab('files');
    setViewerMode('preview');
    setSourceCopied(false);
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen) return;
    if (!threadId) {
      setArtifacts([]);
      setArtifactsError('缺少 threadId，无法加载产物列表');
      return;
    }
    let active = true;
    const run = async () => {
      setArtifactsLoading(true);
      setArtifactsError('');
      try {
        const res = await fetch(apiUrl(`/artifacts/${encodeURIComponent(threadId)}`));
        if (!res.ok) throw new Error('Failed to load artifacts');
        const data = await res.json();
        if (!active) return;
        const list = Array.isArray(data?.artifacts) ? (data.artifacts as ArtifactItem[]) : [];
        const normalized = list
          .map((item) => ({
            name: typeof item?.name === 'string' ? item.name : '',
            size: typeof item?.size === 'number' ? item.size : 0,
            url: typeof item?.url === 'string' ? item.url : ''
          }))
          .filter((item) => item.name && item.url);
        setArtifacts(normalized);
      } catch {
        if (!active) return;
        setArtifacts([]);
        setArtifactsError('产物列表加载失败');
      } finally {
        if (!active) return;
        setArtifactsLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [previewOpen, threadId]);

  const fileTree = useMemo(() => buildFileTree(artifacts), [artifacts]);

  const selectedArtifact = useMemo(() => {
    if (!selectedFilePath) return null;
    return artifacts.find((a) => a.name === selectedFilePath) ?? null;
  }, [artifacts, selectedFilePath]);

  const selectedFileUrl = useMemo(() => {
    const url = selectedArtifact?.url ?? '';
    return url ? normalizeArtifactUrl(url) : '';
  }, [selectedArtifact]);

  const selectedExtension = useMemo(() => getExtension(selectedArtifact?.name ?? ''), [selectedArtifact]);

  useEffect(() => {
    if (!previewOpen) return;
    if (selectedFilePath && artifacts.some((a) => a.name === selectedFilePath)) return;
    if (artifacts.length === 0) {
      setSelectedFilePath('');
      return;
    }
    const preferred =
      artifacts.find((a) => a.name.toLowerCase() === 'index.html') ??
      artifacts.find((a) => a.name.toLowerCase() === 'readme.md') ??
      artifacts.find((a) => getExtension(a.name) === 'html') ??
      artifacts.find((a) => getExtension(a.name) === 'md') ??
      artifacts[0]!;
    setSelectedFilePath(preferred.name);
  }, [previewOpen, artifacts, selectedFilePath]);

  useEffect(() => {
    if (!previewOpen) return;
    if (!selectedFilePath) return;
    const parts = selectedFilePath.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    const prefixes: string[] = [];
    for (let i = 0; i < parts.length - 1; i += 1) {
      const prefix = prefixes.length === 0 ? parts[i]! : `${prefixes[prefixes.length - 1]!}/${parts[i]!}`;
      prefixes.push(prefix);
    }
    setExpandedDirs((prev) => {
      const set = new Set(prev);
      prefixes.forEach((p) => set.add(p));
      return Array.from(set);
    });
  }, [previewOpen, selectedFilePath]);

  useEffect(() => {
    if (!previewOpen) return;
    setExpandedDirs((prev) => {
      if (prev.length > 0) return prev;
      const roots = fileTree.filter((n) => n.type === 'dir').map((n) => n.path);
      return roots;
    });
  }, [previewOpen, fileTree]);

  useEffect(() => {
    if (!previewOpen) return;
    setFileText('');
    setFileBinary(false);
    setFileBase64('');
    setFileContentType('');
    setFileTruncated(false);
    setFileTotalBytes(null);
    setFileTextError('');
    setSourceCopied(false);
    if (!selectedArtifact) return;
    if (!selectedFileUrl) return;
    const ext = getExtension(selectedArtifact.name);
    const knownBinaryPreview =
      ext === 'png' ||
      ext === 'jpg' ||
      ext === 'jpeg' ||
      ext === 'gif' ||
      ext === 'webp' ||
      ext === 'svg' ||
      ext === 'pdf' ||
      ext === 'mp4' ||
      ext === 'webm';
    const shouldFetch =
      viewerMode === 'source' ||
      ext === 'md' ||
      ext === 'markdown' ||
      ext === 'json' ||
      isTextLikeExtension(ext) ||
      (!knownBinaryPreview && ext !== 'html' && ext !== 'htm');
    if (!shouldFetch) return;
    let active = true;
    const run = async () => {
      setFileTextLoading(true);
      try {
        const res = await fetch(selectedFileUrl);
        if (!res.ok) throw new Error('Failed to load file');
        const contentType = res.headers.get('Content-Type') ?? '';
        const contentLength = res.headers.get('Content-Length') ?? '';
        const parsedLength = Number.parseInt(contentLength, 10);
        const totalBytes = Number.isFinite(parsedLength) ? parsedLength : null;
        const prefix = await readResponsePrefix(res, MAX_INLINE_BYTES);
        if (!active) return;
        setFileContentType(contentType);
        setFileTotalBytes(totalBytes ?? prefix.bytes.length);
        const truncated = prefix.truncated || (totalBytes !== null ? totalBytes > prefix.bytes.length : false);
        const view = prefix.bytes;
        setFileTruncated(truncated);
        const binary = isProbablyBinaryContent(view);
        setFileBinary(binary);
        if (!binary) {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          setFileText(decoder.decode(view));
        } else {
          setFileBase64(uint8ToBase64(view));
        }
      } catch {
        if (!active) return;
        setFileText('');
        setFileBinary(false);
        setFileBase64('');
        setFileContentType('');
        setFileTruncated(false);
        setFileTotalBytes(null);
        setFileTextError('文件内容加载失败');
      } finally {
        if (!active) return;
        setFileTextLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [previewOpen, selectedArtifact, selectedFileUrl, viewerMode]);

  const toggleExpandedDir = (dirPath: string) => {
    setExpandedDirs((prev) => (prev.includes(dirPath) ? prev.filter((p) => p !== dirPath) : [...prev, dirPath]));
  };

  const renderFileTree = (nodes: FileNode[], depth: number): React.ReactNode => {
    return nodes.map((node) => {
      const indent = depth * 12;
      if (node.type === 'dir') {
        const open = expandedDirs.includes(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => toggleExpandedDir(node.path)}
              className={cn(
                'w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
                'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200'
              )}
              style={{ paddingLeft: 8 + indent }}
            >
              <span className={cn('transition-transform', open ? 'rotate-90' : '')}>›</span>
              <Folder className="h-3.5 w-3.5 text-zinc-400" />
              <span className="truncate">{node.name}</span>
            </button>
            {open ? <div>{renderFileTree(node.children, depth + 1)}</div> : null}
          </div>
        );
      }

      const active = node.path === selectedFilePath;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => {
            setSelectedFilePath(node.path);
            setViewerMode('preview');
          }}
          className={cn(
            'w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
            active
              ? 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-200'
          )}
          style={{ paddingLeft: 28 + indent }}
        >
          <FileText className="h-3.5 w-3.5 text-zinc-400" />
          <span className="truncate">{node.name}</span>
        </button>
      );
    });
  };

  const downloadArtifacts = () => {
    if (!threadId) return;
    if (downloadBusy) return;
    setDownloadBusy(true);
    setDownloadError('');
    const url = apiUrl(`/artifacts/${threadId}/download`);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      iframe.remove();
    }, 60_000);
    window.setTimeout(() => {
      setDownloadBusy(false);
    }, 600);
  };

  useEffect(() => {
    let active = true;
    if (!previewOpen || !threadId) {
      setDownloadAvailable(null);
      return () => {
        active = false;
      };
    }
    setDownloadAvailable(null);
    fetch(apiUrl(`/artifacts/${threadId}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const artifacts = Array.isArray((data as any)?.artifacts) ? (data as any).artifacts : [];
        setDownloadAvailable(artifacts.length > 0);
      })
      .catch(() => {
        if (!active) return;
        setDownloadAvailable(null);
      });
    return () => {
      active = false;
    };
  }, [previewOpen, threadId]);

  useEffect(() => {
    let active = true;
    const loadThread = async () => {
      if (!threadId) {
        setMessages([]);
        return;
      }
      try {
        const res = await fetch(apiUrl(`/threads/${threadId}`));
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
    let streamedArtifacts: Array<{ name: string; size: number; url: string }> = [];
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
          agentName?: string;
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
            artifacts: streamedArtifacts.length > 0 ? streamedArtifacts : undefined,
          },
        },
      ]);
      setStreamingMessage(null);
    };
    try {
      const response = await fetch(apiUrl('/chat/stream'), {
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
        if (event === 'artifact') {
          const artifacts = (data as any)?.artifacts;
          if (!Array.isArray(artifacts) || artifacts.length === 0) return;
          const normalized = artifacts
            .map((item: any) => ({
              name: typeof item?.name === 'string' ? item.name : '',
              size: typeof item?.size === 'number' ? item.size : 0,
              url: typeof item?.url === 'string' ? item.url : '',
            }))
            .filter((item) => item.name && item.url && item.size >= 0);
          if (normalized.length === 0) return;
          streamedArtifacts = [...streamedArtifacts, ...normalized].filter(
            (item, index, arr) => arr.findIndex((other) => other.url === item.url) === index
          );
          setStreamingMessage((prev) => {
            if (!prev || prev.id !== streamingId) return prev;
            const existing = prev.meta?.artifacts ?? [];
            const merged = [...existing, ...normalized].filter(
              (item, index, arr) => arr.findIndex((other) => other.url === item.url) === index
            );
            return {
              ...prev,
              meta: { ...(prev.meta ?? {}), artifacts: merged },
            };
          });
          return;
        }
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
          const agentName = (data as any)?.agentName;
          const args = (data as any)?.args;
          if (typeof name === 'string' && name.length > 0) {
            ensureSection('tools');
            const resolvedCallId = typeof callId === 'string' ? callId : undefined;
            let updatedTrace = false;
            trace = trace.map((item) => {
              if (item.type !== 'tool') return item;
              if (item.status !== 'running') return item;
              const match = resolvedCallId
                ? item.callId === resolvedCallId || (!item.callId && item.name === name)
                : item.name === name;
              if (!match) return item;
              updatedTrace = true;
              return {
                ...item,
                callId: resolvedCallId ?? item.callId,
                name,
                serverName: typeof serverName === 'string' ? serverName : item.serverName,
                toolName: typeof toolName === 'string' ? toolName : item.toolName,
                agentName: typeof agentName === 'string' ? agentName : (item as any).agentName,
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
                  agentName: typeof agentName === 'string' ? agentName : undefined,
                  status: 'running',
                  args: typeof args === 'object' ? (args as Record<string, unknown>) : undefined,
                },
              ];
            }
            setToolTimeline((prev) => {
              const matchIndex = (() => {
                if (typeof callId === 'string' && callId.length > 0) {
                  const byId = prev.findIndex((item) => item.callId === callId);
                  if (byId >= 0) return byId;
                  const byNameWithoutId = prev.findIndex((item) => !item.callId && item.status === 'running' && item.name === name);
                  if (byNameWithoutId >= 0) return byNameWithoutId;
                  return -1;
                }
                return prev.findIndex((item) => item.name === name);
              })();
              const nextItem: ToolTimelineItem = {
                callId: typeof callId === 'string' ? callId : undefined,
                name,
                serverName: typeof serverName === 'string' ? serverName : undefined,
                toolName: typeof toolName === 'string' ? toolName : undefined,
                agentName: typeof agentName === 'string' ? agentName : undefined,
                status: 'running',
                args: typeof args === 'object' ? (args as Record<string, unknown>) : undefined,
              };
              const next: ToolTimelineItem[] =
                matchIndex >= 0
                  ? prev.map((item, idx): ToolTimelineItem =>
                      idx !== matchIndex
                        ? item
                        : {
                            ...item,
                            ...nextItem,
                            callId: nextItem.callId ?? item.callId,
                            serverName: nextItem.serverName ?? item.serverName,
                            toolName: nextItem.toolName ?? item.toolName,
                            agentName: nextItem.agentName ?? item.agentName,
                            args:
                              typeof args === 'object'
                                ? ({ ...(item.args ?? {}), ...(args as Record<string, unknown>) } as Record<string, unknown>)
                                : item.args,
                          }
                    )
                  : [...prev, nextItem];
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
          const agentName = (data as any)?.agentName;
          if (typeof name === 'string' && name.length > 0) {
            ensureSection('tools');
            const matchId = typeof callId === 'string' && callId.length > 0 ? callId : undefined;
            const status: 'done' | 'error' = ok === false ? 'error' : 'done';
            let updated = false;
            trace = trace.map((item) => {
              if (item.type !== 'tool') return item;
              if (item.status !== 'running') return item;
              const match = matchId ? item.callId === matchId || (!item.callId && item.name === name) : item.name === name;
              if (!match) return item;
              updated = true;
              return {
                ...item,
                status,
                agentName: typeof agentName === 'string' ? agentName : (item as any).agentName,
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
                  agentName: typeof agentName === 'string' ? agentName : undefined,
                  status,
                  durationMs: typeof durationMs === 'number' ? durationMs : undefined,
                  result: typeof result === 'string' ? result : undefined,
                  error: typeof error === 'string' ? error : undefined,
                },
              ];
            }
            setToolTimeline((prev) => {
              const status: ToolTimelineItem['status'] = ok === false ? 'error' : 'done';
              const matchIndex = (() => {
                if (typeof callId === 'string' && callId.length > 0) {
                  const byId = prev.findIndex((item) => item.callId === callId);
                  if (byId >= 0) return byId;
                  const byNameWithoutId = prev.findIndex((item) => !item.callId && item.status === 'running' && item.name === name);
                  if (byNameWithoutId >= 0) return byNameWithoutId;
                  return -1;
                }
                return prev.findIndex((item) => item.name === name);
              })();
              const next: ToolTimelineItem[] =
                matchIndex >= 0
                  ? prev.map((item, idx): ToolTimelineItem =>
                      idx !== matchIndex
                        ? item
                        : {
                            ...item,
                            callId: typeof callId === 'string' ? callId : item.callId,
                            status,
                            durationMs: typeof durationMs === 'number' ? durationMs : item.durationMs,
                            result: typeof result === 'string' ? result : item.result,
                            error: typeof error === 'string' ? error : item.error,
                            agentName: typeof agentName === 'string' ? agentName : item.agentName,
                          }
                    )
                  : [
                      ...prev,
                      {
                        callId: typeof callId === 'string' ? callId : undefined,
                        name,
                        status,
                        agentName: typeof agentName === 'string' ? agentName : undefined,
                        durationMs: typeof durationMs === 'number' ? durationMs : undefined,
                        result: typeof result === 'string' ? result : undefined,
                        error: typeof error === 'string' ? error : undefined,
                      },
                    ];
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
          {!isFlash && (
            <button
              type="button"
              onClick={() => setAgentPanelOpen(true)}
              className="h-9 px-3 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium shadow-sm transition-colors bg-white/80 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800"
            >
              Timeline
            </button>
          )}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="h-9 px-3 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium shadow-sm transition-colors bg-white/80 dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800"
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
        {agentPanelOpen && !isFlash && (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              className="absolute inset-0 bg-black/20 dark:bg-black/40"
              onClick={() => setAgentPanelOpen(false)}
              aria-label="Close timeline panel"
            />
            <div className="absolute right-0 top-0 h-full w-full max-w-[520px] border-l border-zinc-200/70 dark:border-zinc-800/70 bg-white/95 dark:bg-zinc-950/90 backdrop-blur-xl shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Timeline</div>
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
            <div className="absolute right-0 top-0 h-full w-full max-w-[920px] border-l border-zinc-200/70 dark:border-zinc-800/70 bg-white/95 dark:bg-zinc-950/90 backdrop-blur-xl shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">预览</div>
                  <div className="flex items-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setPreviewTab('files')}
                      className={cn(
                        'h-7 px-2.5 rounded-md text-xs font-medium transition-colors',
                        previewTab === 'files'
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                      )}
                    >
                      Files
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('sandbox')}
                      className={cn(
                        'h-7 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1',
                        previewTab === 'sandbox'
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                      )}
                    >
                      <Monitor className="h-3.5 w-3.5" />
                      Sandbox
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`h-8 px-2 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-xs font-medium transition-colors flex items-center gap-1 ${
                      canDownloadArtifacts
                        ? 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        : 'text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                    }`}
                    aria-disabled={!canDownloadArtifacts}
                    onClick={(event) => {
                      event.preventDefault();
                      if (!canDownloadArtifacts || downloadBusy) return;
                      downloadArtifacts();
                    }}
                  >
                    {downloadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    下载产物
                  </button>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 text-zinc-500 dark:text-zinc-300 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => setPreviewOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {downloadError ? (
                <div className="px-4 py-2 border-b border-zinc-200/70 dark:border-zinc-800/70 text-[11px] text-rose-500">
                  {downloadError}
                </div>
              ) : null}
              {previewTab === 'sandbox' ? (
                sandboxPreviewUrl ? (
                  <div className="flex-1 min-h-0">
                    <iframe
                      className="w-full h-full bg-white dark:bg-zinc-950"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                      src={sandboxPreviewUrl}
                      title="Sandbox Preview"
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
                    <div>未配置 Sandbox UI</div>
                    <div className="text-[11px] text-zinc-400/80">请设置 SANDBOX_UI_URL 或 SANDBOX_API_URL</div>
                  </div>
                )
              ) : (
                <div className="flex-1 min-h-0 flex">
                  <div className="w-[280px] border-r border-zinc-200/70 dark:border-zinc-800/70 bg-white/60 dark:bg-zinc-950/30">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
                      <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">产物文件</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!previewOpen) return;
                          if (!threadId) return;
                          setArtifactsLoading(true);
                          setArtifactsError('');
                          fetch(apiUrl(`/artifacts/${encodeURIComponent(threadId)}`))
                            .then((res) => (res.ok ? res.json() : null))
                            .then((data) => {
                              const list = Array.isArray(data?.artifacts) ? (data.artifacts as ArtifactItem[]) : [];
                              const normalized = list
                                .map((item) => ({
                                  name: typeof item?.name === 'string' ? item.name : '',
                                  size: typeof item?.size === 'number' ? item.size : 0,
                                  url: typeof item?.url === 'string' ? item.url : ''
                                }))
                                .filter((item) => item.name && item.url);
                              setArtifacts(normalized);
                            })
                            .catch(() => {
                              setArtifacts([]);
                              setArtifactsError('产物列表加载失败');
                            })
                            .finally(() => {
                              setArtifactsLoading(false);
                            });
                        }}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-zinc-200/70 dark:border-zinc-800/70 text-zinc-500 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
                        aria-label="刷新"
                      >
                        <RefreshCcw className={cn('h-3.5 w-3.5', artifactsLoading ? 'animate-spin' : '')} />
                      </button>
                    </div>
                    {artifactsError ? (
                      <div className="px-3 py-2 text-[11px] text-rose-500">{artifactsError}</div>
                    ) : null}
                    <div className="p-2 overflow-auto h-full">
                      {artifactsLoading && artifacts.length === 0 ? (
                        <div className="px-2 py-6 text-center text-[11px] text-zinc-400">加载中…</div>
                      ) : artifacts.length === 0 ? (
                        <div className="px-2 py-6 text-center text-[11px] text-zinc-400">暂无产物</div>
                      ) : (
                        <div className="space-y-0.5">{renderFileTree(fileTree, 0)}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="px-4 py-2 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100 truncate">
                          {selectedArtifact?.name || '选择一个文件'}
                        </div>
                        {selectedArtifact?.url ? (
                          <div className="text-[10px] text-zinc-400 truncate">{normalizeArtifactUrl(selectedArtifact.url)}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/70 dark:bg-zinc-950/50 p-0.5">
                          <button
                            type="button"
                            onClick={() => setViewerMode('preview')}
                            className={cn(
                              'h-7 px-2.5 rounded-md text-xs font-medium transition-colors',
                              viewerMode === 'preview'
                                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                            )}
                            disabled={!selectedArtifact}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewerMode('source')}
                            className={cn(
                              'h-7 px-2.5 rounded-md text-xs font-medium transition-colors',
                              viewerMode === 'source'
                                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                            )}
                            disabled={!selectedArtifact}
                          >
                            Source
                          </button>
                        </div>
                        {selectedFileUrl ? (
                          <a
                            href={selectedFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 px-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors inline-flex items-center gap-1"
                          >
                            <Globe className="h-3.5 w-3.5" />
                            打开
                          </a>
                        ) : null}
                        {selectedArtifact?.url ? (
                          <a
                            href={`${normalizeArtifactUrl(selectedArtifact.url)}?download=true`}
                            className="h-7 px-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors inline-flex items-center gap-1"
                          >
                            <Download className="h-3.5 w-3.5" />
                            下载
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto p-4">
                      {!selectedArtifact ? (
                        <div className="h-full flex items-center justify-center text-xs text-zinc-400">请选择左侧文件</div>
                      ) : viewerMode === 'preview' ? (
                        selectedExtension === 'md' || selectedExtension === 'markdown' ? (
                          fileTextLoading ? (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">加载中…</div>
                          ) : fileTextError ? (
                            <div className="h-full flex items-center justify-center text-xs text-rose-500">{fileTextError}</div>
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileText}</ReactMarkdown>
                            </div>
                          )
                        ) : selectedExtension === 'html' || selectedExtension === 'htm' ? (
                          selectedFileUrl ? (
                            <div className="h-full min-h-[480px] rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden bg-white dark:bg-zinc-950">
                              <iframe
                                className="w-full h-full"
                                sandbox="allow-scripts allow-forms allow-popups allow-presentation"
                                src={selectedFileUrl}
                                title="HTML Preview"
                              />
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">缺少文件地址</div>
                          )
                        ) : selectedExtension === 'png' ||
                          selectedExtension === 'jpg' ||
                          selectedExtension === 'jpeg' ||
                          selectedExtension === 'gif' ||
                          selectedExtension === 'webp' ||
                          selectedExtension === 'svg' ? (
                          selectedFileUrl ? (
                            <div className="w-full">
                              <img
                                src={selectedFileUrl}
                                alt={selectedArtifact.name}
                                className="max-w-full rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-950"
                              />
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">缺少文件地址</div>
                          )
                        ) : selectedExtension === 'pdf' ? (
                          selectedFileUrl ? (
                            <div className="h-full min-h-[480px] rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 overflow-hidden bg-white dark:bg-zinc-950">
                              <iframe className="w-full h-full" src={selectedFileUrl} title="PDF Preview" />
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">缺少文件地址</div>
                          )
                        ) : selectedExtension === 'json' ? (
                          fileTextLoading ? (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">加载中…</div>
                          ) : fileTextError ? (
                            <div className="h-full flex items-center justify-center text-xs text-rose-500">{fileTextError}</div>
                          ) : (
                            <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono text-zinc-700 dark:text-zinc-200">
                              {prettifyJson(fileText)}
                            </pre>
                          )
                        ) : (
                          fileTextLoading ? (
                            <div className="h-full flex items-center justify-center text-xs text-zinc-400">加载中…</div>
                          ) : fileTextError ? (
                            <div className="h-full flex items-center justify-center text-xs text-rose-500">{fileTextError}</div>
                          ) : (
                            <div className="space-y-2">
                              {fileTruncated ? (
                                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  仅展示前 {formatByteSize(MAX_INLINE_BYTES)}
                                  {fileTotalBytes ? ` / 总计 ${formatByteSize(fileTotalBytes)}` : ''}
                                  {fileContentType ? ` · ${fileContentType}` : ''}
                                </div>
                              ) : fileContentType || fileTotalBytes ? (
                                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {fileTotalBytes ? formatByteSize(fileTotalBytes) : ''}
                                  {fileContentType ? `${fileTotalBytes ? ' · ' : ''}${fileContentType}` : ''}
                                </div>
                              ) : null}
                              <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono text-zinc-700 dark:text-zinc-200">
                                {fileBinary ? fileBase64 : fileText}
                              </pre>
                            </div>
                          )
                        )
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {fileBinary ? '二进制源码（base64）' : '文本源码'}
                              {fileTruncated ? `（仅展示前 ${formatByteSize(MAX_INLINE_BYTES)}）` : ''}
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const payload = fileBinary ? fileBase64 : fileText;
                                  await navigator.clipboard.writeText(payload);
                                  setSourceCopied(true);
                                  window.setTimeout(() => setSourceCopied(false), 1200);
                                } catch {
                                  setSourceCopied(false);
                                }
                              }}
                              className="h-7 px-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
                              disabled={fileTextLoading || !!fileTextError}
                            >
                              {sourceCopied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          {fileTextLoading ? (
                            <div className="h-[240px] flex items-center justify-center text-xs text-zinc-400">加载中…</div>
                          ) : fileTextError ? (
                            <div className="h-[240px] flex items-center justify-center text-xs text-rose-500">{fileTextError}</div>
                          ) : (
                            <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono text-zinc-700 dark:text-zinc-200">
                              {fileBinary ? fileBase64 : fileText}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
