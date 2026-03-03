import type { OpenAiToolDefinition } from '../../mcp/tools'

export const BUILTIN_TOOL_DEFINITIONS: OpenAiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using Tavily',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
          search_depth: { type: 'string', enum: ['basic', 'advanced'] },
          include_answer: { type: 'boolean' },
          include_raw_content: { type: 'boolean' },
          include_images: { type: 'boolean' },
          include_domains: { type: 'array', items: { type: 'string' } },
          exclude_domains: { type: 'array', items: { type: 'string' } }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'websearch',
      description: 'Search the web using Tavily',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
          search_depth: { type: 'string', enum: ['basic', 'advanced'] },
          include_answer: { type: 'boolean' },
          include_raw_content: { type: 'boolean' },
          include_images: { type: 'boolean' },
          include_domains: { type: 'array', items: { type: 'string' } },
          exclude_domains: { type: 'array', items: { type: 'string' } }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the skills or sandbox workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command inside the sandbox workspace',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write any generated file to the sandbox (always call this when the user expects a file)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'task',
      description: 'Delegate a task to a subagent and return its output',
      parameters: {
        type: 'object',
        properties: {
          subagent_type: { type: 'string' },
          task: { type: 'string' }
        },
        required: ['task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List directory contents in the sandbox workspace or skills',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  }
]
