type TavilySearchDepth = 'basic' | 'advanced'

type WebSearchArgs = {
  query?: unknown
  max_results?: unknown
  search_depth?: unknown
  include_answer?: unknown
  include_raw_content?: unknown
  include_images?: unknown
  include_domains?: unknown
  exclude_domains?: unknown
}

const resolveTavilyApiKey = () => {
  const apiKey = process.env.TAVILY_API_KEY
  if (apiKey && apiKey.trim().length > 0) return apiKey
  throw new Error('Missing TAVILY_API_KEY')
}

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim())
  return items.length > 0 ? items : undefined
}

const normalizeSearchDepth = (value: unknown): TavilySearchDepth => {
  if (value === 'advanced') return 'advanced'
  return 'basic'
}

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  return fallback
}

const normalizeMaxResults = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 5
  const rounded = Math.floor(value)
  return Math.min(10, Math.max(1, rounded))
}

export const runTavilyWebSearch = async (rawArgs: WebSearchArgs, signal?: AbortSignal) => {
  const query = typeof rawArgs?.query === 'string' ? rawArgs.query.trim() : ''
  if (!query) {
    throw new Error('Invalid query')
  }
  const maxResults = normalizeMaxResults(rawArgs?.max_results)
  const searchDepth = normalizeSearchDepth(rawArgs?.search_depth)
  const includeAnswer = normalizeBoolean(rawArgs?.include_answer, false)
  const includeRawContent = normalizeBoolean(rawArgs?.include_raw_content, false)
  const includeImages = normalizeBoolean(rawArgs?.include_images, false)
  const includeDomains = normalizeStringArray(rawArgs?.include_domains)
  const excludeDomains = normalizeStringArray(rawArgs?.exclude_domains)

  const apiKey = resolveTavilyApiKey()
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
    body: JSON.stringify({
      query,
      max_results: maxResults,
      // search_depth: searchDepth,
      // include_answer: includeAnswer,
      // include_raw_content: includeRawContent,
      // include_images: includeImages,
      // include_domains: includeDomains,
      // exclude_domains: excludeDomains
    }),
    signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Tavily unauthorized (${res.status}). Please verify TAVILY_API_KEY is valid and loaded into the backend process. Raw response: ${text}`
      )
    }
    throw new Error(`Tavily error: ${res.status} ${text}`)
  }

  const data: any = await res.json()
  const results = Array.isArray(data?.results) ? data.results : []
  const mapped = results.map((item: any) => ({
    title: typeof item?.title === 'string' ? item.title : '',
    url: typeof item?.url === 'string' ? item.url : '',
    content: typeof item?.content === 'string' ? item.content : '',
    score: typeof item?.score === 'number' ? item.score : undefined,
    raw_content: includeRawContent && typeof item?.raw_content === 'string' ? item.raw_content : undefined
  }))
  const payload = {
    query,
    answer: includeAnswer && typeof data?.answer === 'string' ? data.answer : undefined,
    results: mapped
  }
  return JSON.stringify(payload, null, 2)
}
