# web-search-tavily

English | [中文](README.zh.md)

Tavily-backed search provider for the oh-my-dsh web capability seam (`ctx.web`).

## Usage

Mount the plugin and select it as the search provider:

```yaml
- id: web
  name: '@williamcodebox/omd-web'
  config:
    searchProvider: tavily

- id: web-search-tavily
  name: '@williamcodebox/omd-web-search-tavily'
  config:
    apiKeyEnv: TAVILY_API_KEY
```

The API key resolves from the environment (`TAVILY_API_KEY`); an explicit `apiKey` config overrides it. When no key is present the provider reports itself unavailable.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `$TAVILY_API_KEY` | Tavily API key |
| `baseURL` | `https://api.tavily.com` | Endpoint base; `/search` is appended |
| `searchDepth` | `basic` | Retrieval depth: `basic` or `advanced` |
| `numResults` | none | Default result count when a request carries no `maxResults` |
| `includeAnswer` | `false` | Whether Tavily synthesizes an `answer` beside the results |
| `snippetLimit` | `400` | Maximum characters of each result's full text kept as the snippet |

## Error semantics

Failures normalize to the seam's `WEB_PROVIDER_ERROR`; caller cancellation surfaces as `WEB_ABORTED`. HTTP redirects fail as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, truncated content snippets, and publication dates or its exact `Tavily search aborted`, `Tavily search request failed: <error>`, and `Tavily returned an unprocessable response body: <error>` failures under the consumer's error wrapper while the synthesized answer remains outside context unless `includeAnswer` is configured.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Result content is truncated to `snippetLimit` characters** — a page's full text never reaches the model; raise `snippetLimit` for longer excerpts.
- **Only `searchDepth`/`numResults`/`includeAnswer`/`snippetLimit` are exposed** — Tavily's other controls (topic filters, domains, raw content) wait on provider-neutral Service Definition fields.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason surfaces as `WEB_PROVIDER_ERROR`.
