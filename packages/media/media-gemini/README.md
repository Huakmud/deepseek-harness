---
description: "Native Gemini provider for ctx.media: generateContent, aspect-ratio mapping, and per-operation model settings for Google's own API surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-media-gemini

English | [中文](README.zh.md)

## Summary

`dsh-media-gemini` registers a native Gemini provider into `ctx.media`. It speaks Google's `generateContent` surface rather than an OpenAI-compatible facade, which matters for image generation: the drawing model returns inline image data in its response parts instead of a URL, so no second download happens and no credential ever leaves the API host.

Name a model per operation and that operation becomes available; leave a model unset and it stays unadvertised. Describe and generate typically share one multimodal model, and generate needs the image-output variant.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after `dsh-media`.

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

### When to choose it

Choose it when the second API is Gemini and you want the native surface. Choose [`dsh-media-openai`](../media-openai/README.md) when the deployment already has an OpenAI-compatible gateway and does not want a second credential path.

Gemini's compatibility endpoint also works through `dsh-media-openai`; this package exists for the native one, where image generation returns data inline and the aspect-ratio control is a generation-config field.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `https://generativelanguage.googleapis.com/v1beta` | Endpoint base. `/models/{model}:generateContent` is appended. |
| `apiKeyEnv` | `GEMINI_API_KEY` | Credential reference resolved per request. |
| `describeModel` | empty | Model for `describe`. Empty leaves the operation unadvertised. |
| `generateModel` | empty | Model for `generate`. Empty leaves the operation unadvertised. |
| `transcribeModel` | empty | Model for `transcribe`. Empty leaves the operation unadvertised. |

## Understand the implementation

Every operation posts to `/models/{model}:generateContent` with the `x-goog-api-key` header. There is one endpoint and no separate upload or download step.

`describe` sends the image as an inline part and asks for a written answer; the answer is the concatenated text of the response parts, since a model may split one answer across several.

`generate` sends the prompt, optionally with a reference image part, and asks for `IMAGE` output modality. The response carries the picture as inline base64 in a part; a response that holds only text is reported as `MEDIA_EMPTY_RESPONSE` rather than committed as an image, because the model declined rather than drew.

A requested `WIDTHxHEIGHT` becomes the closest supported Gemini aspect ratio: the size is reduced by its greatest common divisor and matched against the five ratios the API accepts, so an unsupported exact size becomes the nearest legal ratio instead of an error.

### Aspect-ratio mapping

| Requested | Sent |
|---|---|
| `1024x1024` | `1:1` |
| `1536x1024` | `3:2` |
| `1024x1536` | `2:3` |
| `1536x864` | `16:9` |

## Further Exploration

- [Media subsystem](../../../docs/subsystems/media.md) — the seam, both adapters, and the consumer together.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-media) — the schemas whose calls reach this provider.

## Model Experience

Indirectly, through [`dsh-tool-media`](../../media/tool-media/README.md), which owns the tool schemas, the prompt guidance, and the attribution sentence that names this provider and model in the result.

#### KV Cache effect

Independent. Provider requests are separate from the conversation's model calls, so no cached conversation prefix is affected by a media call or by changing this provider's settings.

## Known Limitations and Deferred Work

- **`transcribe` is declared but unconfigured by default** — Gemini transcription goes through `generateContent` with an audio part, which this adapter implements, but no default model is shipped for it because the reliable choice depends on the deployment's account. A deployment must name one explicitly.
- **Aspect ratio is approximate** — an exact pixel size cannot be requested. The nearest of the five supported ratios is sent, so `size` is a hint rather than a specification.
- **No safety-filter passthrough** — a response blocked by the endpoint's filters arrives as a provider error carrying the endpoint's own message. No configuration reinterprets or retries it.
- **One endpoint for every operation** — a deployment that proxies image generation through a different Gemini surface than vision cannot express it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: an aspect-ratio argument rather than a parsed size

The tool schema takes `WIDTHxHEIGHT` because that is what image models conventionally accept, but Gemini offers five named ratios. Parsing a pixel size back into a ratio loses information and can surprise a caller who asked for an exact frame. Passing a ratio through the seam would be more faithful; it needs a matching change in the OpenAI adapter, which does accept exact sizes, so the seam's request type would carry whichever form the caller chose.

</details>
