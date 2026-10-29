---
description: "Package map for the media capability family: the media service, its provider adapters, and the model-facing tools that consume them."
kind: "package-group"
---

# media/ — media capability family

English | [中文](README.zh.md)

## Summary

The `media/` packages let a text-only model read images, draw images, and transcribe audio through a second API. The service picks one provider per operation; deployments choose the OpenAI-compatible protocol or Gemini's native surface, and configure a model per operation. Use this family when the conversation model cannot accept images or audio itself. Models receive consistent tool behavior and error reporting when providers change, and every result names the model that did the work.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Four packages play the media roles; the subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`media/`](media/README.md) | Media service: registers providers, selects one per operation, one error vocabulary | `ctx.media` |
| [`media-openai/`](media-openai/README.md) | Describes, generates, and transcribes through the OpenAI wire protocol | registers on `ctx.media` |
| [`media-gemini/`](media-gemini/README.md) | Describes and generates through Gemini's native `generateContent` | registers on `ctx.media` |
| [`tool-media/`](tool-media/README.md) | Exposes `media_describe_image`, `media_generate_image`, and `media_transcribe_audio` to the model | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the seam this design follows.

- [Media subsystem](../../docs/subsystems/media.md) — the operation requests and results, provider selection, and where the image gate loosens.
- [Capability seams](../../docs/glossary.md#capability-seam) — why the three roles are separate packages.
- [Web subsystem](../../docs/subsystems/web.md) — the two-operation seam this one follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
