/**
 * Wire types for the Tavily search API (`POST https://api.tavily.com/search`).
 * Types only — no runtime code. Tavily returns `results[]`; each entry carries
 * a URL, title, full-text `content`, optional `published_date`, and a score.
 *
 * @module @williamcodebox/omd-web-search-tavily/types
 */

/** Request body sent to Tavily's search endpoint. */
export interface TavilySearchRequest {
  api_key: string
  query: string
  /** Tavily's result-count control; the seam still enforces the bound on return. */
  max_results?: number
  /** Retrieval depth: `basic` is fast, `advanced` adds web-search context. */
  search_depth?: 'basic' | 'advanced'
  /** Whether Tavily generates a synthesized answer alongside the results. */
  include_answer?: boolean
}

/** One entry of Tavily's `results[]`. */
export interface TavilyResult {
  title: string
  url: string
  /** Full text of the page (may be long; the provider truncates to a snippet). */
  content: string
  /** Tavily's relevance score, 0..1. */
  score?: number
  published_date?: string | null
}

/** Tavily's search response envelope. */
export interface TavilySearchResponse {
  results?: TavilyResult[]
  /** Optional synthesized answer (when `include_answer` was requested). */
  answer?: string | null
}

/** Tavily's error response envelope (best-effort; fields vary by failure). */
export interface TavilyError {
  detail?: string
  message?: string
}
