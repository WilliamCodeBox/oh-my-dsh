/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by the Tavily search
 * API (`POST /search`). The provider maps Tavily's full-text `content` fields
 * to normalized snippets (truncated for token economy), surfaces the optional
 * synthesized `answer` as result content, and normalizes failures to the web
 * seam's `WEB_PROVIDER_ERROR` / `WEB_ABORTED` error codes.
 *
 * @module @williamcodebox/omd-web-search-tavily/provider
 */

import { WebError } from '@williamcodebox/omd-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@williamcodebox/omd-web'
import type { TavilyError, TavilyResult, TavilySearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default retrieval depth: basic (fast) unless configured otherwise. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Default maximum characters of a page's full text kept as the snippet. */
export const TAVILY_DEFAULT_SNIPPET_LIMIT = 400

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface TavilySearchProviderOptions {
  /** Tavily API key (never empty when the provider is available). */
  apiKey: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL: string
  /** Retrieval depth sent as Tavily's `search_depth`. Defaults to `basic`. */
  searchDepth: 'basic' | 'advanced'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Whether Tavily should synthesize an `answer` beside the results. */
  includeAnswer: boolean
  /** Maximum characters of each result's full text kept as the snippet. */
  snippetLimit: number
}

/**
 * Map one Tavily result to a normalized source: full text truncated to the
 * configured snippet limit, with optional title and publication date.
 */
export function mapTavilyResult(result: TavilyResult, snippetLimit: number): WebSearchSource {
  const content = result.content ?? ''
  const snippet = content.length > snippetLimit ? `${content.slice(0, snippetLimit)}…` : content
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...result.published_date != null && result.published_date.length > 0
      ? { publishedAt: result.published_date }
      : {},
  }
}

/**
 * Map a Tavily response envelope to a normalized search result. The optional
 * synthesized answer becomes the result's `content`; every entry of
 * `results[]` is mapped through {@link mapTavilyResult}. Result entries with
 * no URL are dropped.
 *
 * @param response - the parsed `POST /search` response body.
 * @param snippetLimit - maximum characters of each full-text field kept.
 * @returns the normalized result.
 */
export function mapTavilyResponse(
  response: TavilySearchResponse,
  snippetLimit: number,
): WebSearchResult {
  const sources = (response.results ?? [])
    .map(result => mapTavilyResult(result, snippetLimit))
    .filter((source): source is WebSearchSource => source !== undefined && source.url.length > 0)
  const content = response.answer != null && response.answer.length > 0 ? response.answer : undefined
  // Tavily returns no pagination metadata, so the provider reports `truncated: false`;
  // the web service owns the final `maxResults` truncation.
  return { sources, ...content !== undefined ? { content } : {}, truncated: false }
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  constructor(private readonly options: TavilySearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.snippetLimit)
      && (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const maxResults = request.maxResults ?? this.options.numResults
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          query: request.query,
          search_depth: this.options.searchDepth,
          include_answer: this.options.includeAnswer,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = await response.json() as TavilyError
        const detail = parsed.detail ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as TavilySearchResponse
      return mapTavilyResponse(payload, this.options.snippetLimit)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Tavily (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
