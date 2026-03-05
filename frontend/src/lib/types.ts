export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: {
    plan?: string | null;
    research?: string | null;
    analysis?: string | null;
    risk?: string | null;
    critic?: string | null;
    thinking?: string | null;
    sections?: Array<'plan' | 'research' | 'analysis' | 'risk' | 'critic' | 'thinking' | 'tools' | 'agents' | 'trace'>;
    skills?: string[];
    tools?: string[];
    skillReads?: Array<{
      name: string;
      path: string;
    }>;
    toolTimeline?: Array<{
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
    }>;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    agents?: Array<{
      name: string;
      output: string;
    }>;
    agentTimeline?: Array<{
      name: string;
      status: 'running' | 'done' | 'error';
      durationMs?: number;
      output?: string;
      thinking?: string;
      thinkingActive?: boolean;
    }>;
    trace?: Array<
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
        }
    >;
    streamingFinal?: boolean;
    reasoningActive?: boolean;
    planActive?: boolean;
    researchActive?: boolean;
    analysisActive?: boolean;
    riskActive?: boolean;
    criticActive?: boolean;
    toolsActive?: boolean;
    artifacts?: Array<{
      name: string;
      size: number;
      url: string;
    }>;
  };
  createdAt: number;
}

export interface ModelOption {
  id: string;
  name: string;
  provider?: string;
  protocol?: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadState {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
}
