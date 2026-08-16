# web-search-tavily

[English](README.md) | 中文

基于 Tavily 的搜索 provider，接入 oh-my-dsh web 能力缝（`ctx.web`）。

## 使用

挂载插件并选为搜索 provider：

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

API key 从环境解析（`TAVILY_API_KEY`）；显式 `apiKey` 配置优先。无 key 时 provider 报告不可用。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKey` | `$TAVILY_API_KEY` | Tavily API key |
| `baseURL` | `https://api.tavily.com` | 端点基址；追加 `/search` |
| `searchDepth` | `basic` | 检索深度：`basic` 或 `advanced` |
| `numResults` | 无 | 请求未带 `maxResults` 时的默认结果数 |
| `includeAnswer` | `false` | 是否让 Tavily 生成综合回答 |
| `snippetLimit` | `400` | 每个结果全文保留为摘要的最大字符数 |

## 错误语义

失败归一为缝的 `WEB_PROVIDER_ERROR`；调用方取消以 `WEB_ABORTED` 呈现。HTTP 重定向以 `WEB_PROVIDER_ERROR` 失败。

## 模型体验

间接通过 [`dsh-tool-web`](../tool-web/README.md)：该消费者保留本 provider 的 `maxResults` 限定的 URL、标题、截断的内容摘要与发布日期，或把 `Tavily search aborted`、`Tavily search request failed: <error>`、`Tavily returned an unprocessable response body: <error>` 精确失败包裹在消费者错误包装下；综合回答在配置 `includeAnswer` 前不进入上下文。

#### KV 缓存效应

无直接失效；命名消费者拥有请求前缀变更。

## 已知限制与延后工作

- **结果内容截断到 `snippetLimit` 字符**——页面全文不会到达模型；提高 `snippetLimit` 可获取更长摘录。
- **仅暴露 `searchDepth`/`numResults`/`includeAnswer`/`snippetLimit`**——Tavily 的其他控制（话题过滤、域名、原始内容）等待 provider 中立的 Service Definition 字段。
- **中止分类基于错误形状**——仅名为 `AbortError` 的 `DOMException` 映射为 `WEB_ABORTED`；携带自定义原因的中止以 `WEB_PROVIDER_ERROR` 呈现。
