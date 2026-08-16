/**
 * `@williamcodebox/omd-web-search-tavily`: registers a Tavily-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@williamcodebox/omd-llm-deepseek` registers an adapter into `ctx.llm`. The
 * key is owned by `@williamcodebox/omd-web`.
 *
 * @module @williamcodebox/omd-web-search-tavily
 */

import type { Context } from '@williamcodebox/cordis'
import { launchEnvironmentOf } from '@williamcodebox/omd-launch-environment'
import z from '@williamcodebox/schemastery'
import type {} from '@williamcodebox/omd-web'
import {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_DEFAULT_SNIPPET_LIMIT,
} from './provider.ts'

export {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_DEFAULT_SNIPPET_LIMIT,
  TAVILY_PROVIDER_ID,
  TavilySearchProvider,
} from './provider.ts'
export type { TavilySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Tavily API key. Falls back to `$TAVILY_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval depth sent as Tavily's `search_depth`. Defaults to `basic`. */
  searchDepth?: 'basic' | 'advanced'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Whether Tavily synthesizes an `answer` beside the results. Defaults to false. */
  includeAnswer?: boolean
  /** Maximum characters of each result's full text kept as the snippet. Defaults to 400. */
  snippetLimit?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  searchDepth: z.union(['basic', 'advanced'] as const),
  numResults: z.number().step(1).min(1),
  includeAnswer: z.boolean(),
  snippetLimit: z.number().step(1).min(1),
})

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new TavilySearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('TAVILY_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    includeAnswer: config.includeAnswer ?? false,
    snippetLimit: config.snippetLimit ?? TAVILY_DEFAULT_SNIPPET_LIMIT,
    ...config.numResults !== undefined ? { numResults: config.numResults } : {},
  }))
}
