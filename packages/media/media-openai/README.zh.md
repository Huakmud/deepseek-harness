---
description: "适用于 ctx.media 的 OpenAI 兼容提供方：为使用 OpenAI 对话、图片与音频 API 的主机提供端点、按操作的模型与凭据设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-media-openai

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-media-openai` 向 `ctx.media` 注册一个 OpenAI 兼容提供方。它使用 OpenAI 线协议，因此既适用于 OpenAI 本身，也适用于任何复现这些端点的网关：OpenRouter、厂商的兼容端点，或自托管代理。为某个操作指定模型即启用该操作；不指定模型则该操作保持不声明，因此只有视觉路由的部署永远不会提供绘图能力。

每个操作使用一个端点和一个模型，凭据在每次请求时从部署的凭据平面解析，因此轮换密钥无需重启。

<a id="table-of-contents"></a>
## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-media` 之后挂载它。所有设置都是易变的，因此模型设置页可以在应用运行期间修改它们。

```yaml
- id: media
  name: '@deepseek-ai/dsh-media'

- id: media-openai
  name: '@deepseek-ai/dsh-media-openai'
  config:
    baseURL: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    describeModel: gpt-4o-mini
    generateModel: gpt-image-1
    transcribeModel: whisper-1
```

### 何时选择它

当第二个 API 使用 OpenAI 协议时选择它。若希望使用 Gemini 原生端点，则选择 [`dsh-media-gemini`](../media-gemini/README.zh.md)，它在请求体、认证头和图片返回格式上有所不同。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | 包含版本前缀的端点基址。操作路径会追加其后。 |
| `apiKeyEnv` | `OPENAI_API_KEY` | 每次请求解析的凭据引用。 |
| `describeModel` | 空 | 用于 `describe` 的模型。为空则该操作不声明。 |
| `generateModel` | 空 | 用于 `generate` 的模型。为空则该操作不声明。 |
| `transcribeModel` | 空 | 用于 `transcribe` 的模型。为空则该操作不声明。 |

### 端点

| 操作 | 请求 |
|---|---|
| `describe` | `POST /chat/completions`，图片以 data URL 分片形式提交。 |
| `generate` | `POST /images/generations`，若返回 URL 则再 `GET` 该 URL。 |
| `transcribe` | `POST /audio/transcriptions`，以 multipart 表单提交。 |

<a id="understand-the-implementation"></a>
## 理解实现

`OpenAiMediaProvider` 通过回调读取其配置，而非捕获一个值，因此两次调用之间的设置写入会被第二次调用观察到。`capabilities` 在每次读取时由配置派生，这正是清空模型会移除该操作的原因。

凭据在挂载了 `ctx.get('credentials')` 接缝时经其解析，否则回退到启动环境，因此没有凭据服务的部署仍可从环境工作。

重定向会被拒绝而非跟随。携带凭据的请求若发生重定向，会把 `authorization` 头发送到响应所指向的主机；提供方会报告该拒绝。

生成的图片以 base64 或 URL 形式返回。URL 路径不发送凭据，因为存储主机不是 API 主机。

<a id="further-exploration"></a>
## 进一步探索

- [媒体子系统](../../../docs/subsystems/media.zh.md) — 接缝、两个适配器与使用方三者合观。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-media) — 其调用会到达此提供方的 schema。

<a id="model-experience"></a>
## 模型体验

Indirectly, through [`dsh-tool-media`](../../media/tool-media/README.zh.md), which owns the tool schemas, the prompt guidance, and the attribution sentence that names this provider and model in the result.

#### KV Cache effect

Independent. Provider requests are separate from the conversation's model calls, so no cached conversation prefix is affected by a media call or by changing this provider's settings.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有按操作的端点** — 一个 `baseURL` 为全部三个操作服务。在不同主机上代理视觉与图片生成的网关无法表达；部署必须将它们置于同一个基址之后。
- **没有流式传输** — 每个操作都等待完整响应。因此长时间图片生成会耗尽整个工具调用预算，而无法报告进度。
- **没有成本或配额报告** — 提供方原样呈现端点的错误消息，不附加任何关于开销的信息。
- **`sniffImageMediaType` 对无法识别的字节回退为 `image/png`** — 附件存储在提交解码后的图片前会重新校验，因此错误猜测在那里被捕获，而非在此处。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

本开发备注是维护者的工作背景：未决问题与尚未确定的方向。它明确不具权威性 — 已发布的行为、限制与理由位于上文各节。

#### 未来：提供方特有的响应方言

适配器读取 `b64_json` 与 `url`，因为 OpenAI 图片 API 会依模型以及是否请求响应格式而返回二者之一。各网关对它们支持程度不一。若实际部署需要方言开关，它应位于模型名旁边的配置中，而不是另建一个提供方包，因为线协议在其他方面完全相同。

</details>
