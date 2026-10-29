---
description: "OpenAI-compatible provider for ctx.media: endpoint, per-operation model, and credential settings for hosts that speak the OpenAI chat, image, and audio APIs."
kind: "package-reference"
---

# @deepseek-ai/dsh-media-openai

English | [中文](README.zh.md)

## Summary

`dsh-media-openai` registers an OpenAI-compatible provider into `ctx.media`. It talks the OpenAI wire protocol, so it works with OpenAI itself and with any gateway that reproduces those endpoints: OpenRouter, a vendor's compatibility endpoint, or a self-hosted proxy. Name a model per operation and that operation becomes available; leave a model unset and the operation stays unadvertised, so a deployment that only has a vision route never offers to draw.

Each operation uses one endpoint and one model, and the credential is resolved per request from the deployment's credential plane, so rotating a key does not need a restart.

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

Mount it after `dsh-media`. Every setting is volatile, so the Models settings page can change it while the app runs.

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

### When to choose it

Choose it when the second API speaks the OpenAI protocol. Choose [`dsh-media-gemini`](../media-gemini/README.md) instead when you want Gemini's native endpoint, which differs in request body, authentication header, and image-return format.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | Endpoint base including the version prefix. Operation paths are appended. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved per request. |
| `describeModel` | empty | Model for `describe`. Empty leaves the operation unadvertised. |
| `generateModel` | empty | Model for `generate`. Empty leaves the operation unadvertised. |
| `transcribeModel` | empty | Model for `transcribe`. Empty leaves the operation unadvertised. |

### Endpoints

| Operation | Request |
|---|---|
| `describe` | `POST /chat/completions` with the image as a data URL part. |
| `generate` | `POST /images/generations`, then `GET` the returned URL when the answer carries one. |
| `transcribe` | `POST /audio/transcriptions` as multipart form data. |

## Understand the implementation

`OpenAiMediaProvider` reads its profile through a callback rather than a captured value, so a settings write between two calls is observed by the second call. `capabilities` is derived from the profile on each read, which is what makes clearing a model remove the operation.

The credential is resolved through `ctx.get('credentials')` when that seam is mounted and falls back to the launch environment otherwise, so a deployment without the credentials service still works from the environment.

Redirects are refused rather than followed. A redirect on a credential-bearing request would carry the `authorization` header to whatever host the response named; the provider reports the refusal instead.

A generated image arrives as base64 or as a URL. The URL path sends no credential, because the storage host is not the API host.

## Further Exploration

- [Media subsystem](../../../docs/subsystems/media.md) — the seam, both adapters, and the consumer together.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-media) — the schemas whose calls reach this provider.

## Model Experience

Indirectly, through [`dsh-tool-media`](../../media/tool-media/README.md), which owns the tool schemas, the prompt guidance, and the attribution sentence that names this provider and model in the result.

#### KV Cache effect

Independent. Provider requests are separate from the conversation's model calls, so no cached conversation prefix is affected by a media call or by changing this provider's settings.

## Known Limitations and Deferred Work

- **No per-operation endpoint** — one `baseURL` serves all three operations. A gateway that proxies vision and image generation on different hosts cannot be expressed; the deployment must front them behind one base.
- **No streaming** — every operation waits for the complete response. Long image generations therefore consume the whole tool-call budget rather than reporting progress.
- **No cost or quota reporting** — the provider surfaces the endpoint's error message verbatim and adds nothing about spend.
- **`sniffImageMediaType` falls back to `image/png`** for bytes it does not recognize. The attachment store re-verifies a decoded image before it is committed, so a wrong guess is caught there rather than here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: provider-specific response dialects

The adapter reads `b64_json` and `url` because the OpenAI image API returns both depending on the model and on whether a response format is requested. Gateways vary in which they honor. If a real deployment needs a dialect switch, it belongs in the profile next to the model names rather than in a second provider package, since the wire protocol is otherwise identical.

</details>
