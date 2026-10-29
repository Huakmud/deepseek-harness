---
description: "适用于 ctx.media 的 Gemini 原生提供方：generateContent、长宽比映射，以及面向 Google 自有 API 表面的按操作模型设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-media-gemini

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-media-gemini` 向 `ctx.media` 注册一个 Gemini 原生提供方。它使用 Google 的 `generateContent` 表面，而非 OpenAI 兼容门面，这在图片生成上很重要：绘图模型在响应的内容分片中以内联图片数据返回，而非 URL，因此没有第二次下载，凭据也不会离开 API 主机。

为某个操作指定模型即启用该操作；不指定模型则该操作保持不声明。描述与生成通常共用一个多模态模型，而生成需要图片输出变体。

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

在 `dsh-media` 之后挂载它。

```yaml
- id: media
  name: '@deepseek-ai/dsh-media'

- id: media-gemini
  name: '@deepseek-ai/dsh-media-gemini'
  config:
    baseURL: https://generativelanguage.googleapis.com/v1beta
    apiKeyEnv: GEMINI_API_KEY
    describeModel: gemini-2.5-flash
    generateModel: gemini-2.5-flash-image
```

### 何时选择它

当第二个 API 是 Gemini 且希望使用原生表面时选择它。当部署已有 OpenAI 兼容网关且不希望引入第二条凭据路径时，选择 [`dsh-media-openai`](../media-openai/README.zh.md)。

Gemini 的兼容端点也可通过 `dsh-media-openai` 使用；本包存在的原因是原生端点：图片生成以内联方式返回数据，长宽比控制是生成配置字段。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://generativelanguage.googleapis.com/v1beta` | 端点基址。会追加 `/models/{model}:generateContent`。 |
| `apiKeyEnv` | `GEMINI_API_KEY` | 每次请求解析的凭据引用。 |
| `describeModel` | 空 | 用于 `describe` 的模型。为空则该操作不声明。 |
| `generateModel` | 空 | 用于 `generate` 的模型。为空则该操作不声明。 |
| `transcribeModel` | 空 | 用于 `transcribe` 的模型。为空则该操作不声明。 |

<a id="understand-the-implementation"></a>
## 理解实现

每个操作都以 `x-goog-api-key` 头向 `/models/{model}:generateContent` 发起 POST 请求。只有一个端点，没有单独的上传或下载步骤。

`describe` 将图片作为内联分片发送并请求文字答案；答案是响应各分片文本的拼接，因为模型可能把一个答案拆到多个分片中。

`generate` 发送提示词，可选地附带参考图片分片，并请求 `IMAGE` 输出模态。响应在某个分片中以内联 base64 携带图片；仅含文字的响应会被报告为 `MEDIA_EMPTY_RESPONSE`，而不是作为图片提交，因为模型是在拒绝而非绘图。

请求的 `WIDTHxHEIGHT` 会转换为最接近的 Gemini 支持长宽比：先按最大公约数约简，再与 API 接受的五个比例匹配，因此不受支持的具体尺寸会变成最接近的合法比例，而不是报错。

### 长宽比映射

| 请求 | 发送 |
|---|---|
| `1024x1024` | `1:1` |
| `1536x1024` | `3:2` |
| `1024x1536` | `2:3` |
| `1536x864` | `16:9` |

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

- **`transcribe` 已声明但默认未配置** — Gemini 转写通过带音频分片的 `generateContent` 进行，本适配器已实现，但没有随附默认模型，因为可靠的选择取决于部署的账号。部署必须显式指定。
- **长宽比是近似的** — 无法请求精确像素尺寸。会发送五个支持比例中最接近的一个，因此 `size` 是提示而非规范。
- **没有安全过滤透传** — 被端点过滤器拦截的响应会以携带端点自身消息的提供方错误到达。没有配置会重新解释或重试它。
- **所有操作共用同一端点** — 通过不同于视觉的 Gemini 表面代理图片生成的部署无法表达。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

本开发备注是维护者的工作背景：未决问题与尚未确定的方向。它明确不具权威性 — 已发布的行为、限制与理由位于上文各节。

#### 未来：以长宽比参数取代解析尺寸

工具 schema 接受 `WIDTHxHEIGHT`，因为这是图片模型惯常接受的形式，但 Gemini 提供五个具名比例。把像素尺寸解析回比例会丢失信息，并可能让请求精确画幅的调用方感到意外。让比例直接穿过接缝会更忠实；这需要 OpenAI 适配器的相应改动（它确实接受精确尺寸），因此接缝的请求类型将携带调用方所选的任一形式。

</details>
