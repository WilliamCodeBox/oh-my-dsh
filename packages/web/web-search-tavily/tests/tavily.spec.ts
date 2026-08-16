import { afterEach, describe, expect, it, vi } from 'vitest'
import { TavilySearchProvider } from '@williamcodebox/omd-web-search-tavily'
import { mapTavilyResponse, mapTavilyResult } from '../src/provider.ts'

const options = {
  apiKey: 'tavily-key',
  baseURL: 'https://api.tavily.test',
  searchDepth: 'basic' as const,
  includeAnswer: false,
  snippetLimit: 40,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Tavily result mapping', () => {
  it('maps a full result entry with truncated content', () => {
    expect(mapTavilyResult(
      { url: 'https://a.test', title: 'A', content: 'x'.repeat(100), published_date: '2026-01-01' },
      40,
    )).toEqual({ url: 'https://a.test', title: 'A', snippet: 'x'.repeat(40) + '…', publishedAt: '2026-01-01' })
  })

  it('keeps short content verbatim and omits empty optionals', () => {
    expect(mapTavilyResult({ url: 'https://a.test', title: '', content: 'short text' }, 40))
      .toEqual({ url: 'https://a.test', snippet: 'short text' })
    expect(mapTavilyResult({ url: 'https://a.test', title: 'A', content: '', published_date: null }, 40))
      .toEqual({ url: 'https://a.test', title: 'A' })
  })

  it('maps a response with an answer as content and filtered sources', () => {
    const result = mapTavilyResponse({
      answer: 'Synthesized answer',
      results: [
        { url: 'https://a.test', title: 'A', content: 'one' },
        { url: 'https://b.test', title: 'B', content: '' },
      ],
    }, 40)
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'one' },
        { url: 'https://b.test', title: 'B' },
      ],
      content: 'Synthesized answer',
      truncated: false,
    })
  })

  it('omits content when no answer is present', () => {
    expect(mapTavilyResponse({ results: [] }, 40).content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapTavilyResponse({}, 40).sources).toEqual([])
  })
})

describe('TavilySearchProvider', () => {
  it('is unavailable without a key', () => {
    expect(new TavilySearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new TavilySearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new TavilySearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when snippetLimit is not a positive integer', () => {
    expect(new TavilySearchProvider({ ...options, snippetLimit: 0 }).available()).toBe(false)
  })

  it('posts the query with the configured depth and key', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.tavily.test/search')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        api_key: 'tavily-key',
        query: 'what is omd',
        search_depth: 'basic',
        include_answer: false,
        max_results: 3,
      })
      return jsonResponse({ results: [{ url: 'https://a.test', title: 'A', content: 'hit' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new TavilySearchProvider(options)
    const result = await provider.search({ query: 'what is omd', maxResults: 3 })
    expect(result.sources).toEqual([{ url: 'https://a.test', title: 'A', snippet: 'hit' }])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('surfaces a non-OK status as WEB_PROVIDER_ERROR with the API detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'rate limited' }, { status: 429 })))
    const provider = new TavilySearchProvider(options)
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'rate limited',
    })
  })

  it('surfaces a malformed success body as WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    const provider = new TavilySearchProvider(options)
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})
