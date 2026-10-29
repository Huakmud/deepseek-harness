---
description: "The model-facing media tools (media_describe_image, media_generate_image, media_transcribe_audio) over ctx.media: how a text-only model sees, draws, and hears through a second API."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-media

English | [中文](README.zh.md)

## Summary

`dsh-tool-media` gives a model three tools that delegate image and audio work to the auxiliary media route. A text-only model can then ask about a picture, draw one, or read a recording without gaining image input: it calls a tool, a different model does the work, and the answer returns as a tool result.

Each result names the provider and model that produced it and states that the calling model did not see the image or hear the recording, which keeps it from claiming perception it lacks. Generated images are committed to the attachment store for later reference by id.

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

Mount it after `dsh-media` and at least one provider. It registers into `ctx.tools` and contributes one prompt section per enabled tool.

```yaml
- id: tool-media
  name: '@deepseek-ai/dsh-tool-media'
  config:
    generate: true
```

### When to choose it

Choose it when the conversation's model cannot accept images or audio and the deployment has a second API that can. A deployment whose model accepts images does not need `media_describe_image`: `read_image` handles that case directly.

`tool-media` is composed per agent preset rather than once per host, because which tools a model sees is a per-agent decision. A deployment that mounts it on the host plane should disable that row and let each preset add its own.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `describe` | `true` | Register `media_describe_image`. |
| `generate` | `true` | Register `media_generate_image`. |
| `transcribe` | `true` | Register `media_transcribe_audio`. |
| `quickTimeoutMs` | `120000` | Cooperative budget for one describe or transcribe call. |
| `generateTimeoutMs` | `300000` | Cooperative budget for one image generation, which is slower than a request. |

A disabled tool takes its guidance section with it, so the model is never told about a tool it cannot call.

## Understand the implementation

### Naming an image

`media_describe_image` accepts either an `attachmentId` or a `path`, and exactly one must be given. The two are different kinds of reference and both are needed: an image the user attached is durable and named by id, while an image the model produced or downloaded is a path.

An attachment id is only an identifier, so the tool recovers the complete reference from the Session log before reading. The store verifies a full reference against the stored bytes, which is what makes the recovery necessary: an id that this conversation never referenced is refused rather than guessed at.

Bytes decide the media type for a path source. An extension that disagrees with the content is refused, because a provider rejects an upload whose declared type contradicts its body.

### Committing a generated image

`media_generate_image` sends the prompt to the seam, then commits the returned bytes through `attachments.saveImage`. The commit happens before the result is returned, so a model that continues the conversation in the same turn can already refer to the attachment id.

A generation that returns no image — because the model answered in text instead of drawing — is reported as a failure rather than committed as a picture.

### Registration and the settings page

Every setting is read from plugin config at mount time; the tool set is fixed for a composition. Provider endpoint, model, and credential settings are volatile and belong to the provider packages, so changing a model in the Models page applies to the next call without remounting these tools.

## Further Exploration

- [Media subsystem](../../../docs/subsystems/media.md) — the seam, both adapters, and these tools together.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-media) — the generated schemas, including every parameter.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — the presentation contract these tools follow.

## Model Experience

### The three media tools

#### What the model sees

Three tool schemas, registered only for the tools a composition enables. Their parameters and descriptions are catalogued at [tool-catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-media) and are not repeated here. The delta this package owns is the result rendering: a description or transcript names its producer and disclaims direct perception, while a drawn image is an image block plus a text block naming the producer and the pixel size.

#### Token effect

Conditional. Each enabled tool adds its schema to every request. A result adds the provider/model sentence plus the description or transcript text, and a generated image adds an image block whose cost depends on the image itself. A describe or transcribe call whose result is later compacted costs no more than any other tool result.

#### KV Cache effect

Append-only for tool results, which extend the transcript in call order and preserve the reusable prefix. A settings change to the provider endpoint, model, or credential alters no request token, so it cannot invalidate a cached prefix. Enabling or disabling a tool changes the schema list, which replaces the request prefix and does invalidate reuse.

### Media guidance in the system prompt

#### What the model sees

One section per enabled tool, at section order `TOOL_MEDIA`. Each section states when to call the tool, that another model does the work, and — for describe — that the model must not claim to have seen the image.

##### Verbatim text for media_describe_image

```markdown
When the conversation carries an image and the current model cannot accept images, call media_describe_image with its attachment id rather than guessing at the contents. The description comes from a separate vision model: report what it says, and never claim you saw the image yourself.
```

##### Verbatim text for media_generate_image

```markdown
When the user asks for a picture, call media_generate_image with a self-contained prompt. The image is produced by a separate model and committed to the conversation, so subsequent turns can refer to it by its attachment id.
```

##### Verbatim text for media_transcribe_audio

```markdown
When the conversation carries a recording and the current model cannot decode audio, call media_transcribe_audio with its attachment id rather than asking the user to retype it. The transcript comes from a separate audio model.
```

#### Token effect

Fixed per enabled tool, retained for the whole Session. The three sections together are roughly 120 tokens.

#### KV Cache effect

Prefix-stable while the enabled tool set is unchanged. The sections sit at a fixed order, so enabling a further tool inserts text that replaces the request prefix from that point on and invalidates reuse beyond it.

## Known Limitations and Deferred Work

- **No cross-turn image memory** — a description is a tool result like any other, so a compaction that drops it leaves the picture unreachable until the model asks again. The attachment itself survives; only the description is lost.
- **One image per call** — comparing several images costs one call each, and the model must correlate the answers itself.
- **Audio transcription is declared on both providers but no default model ships** — the reliable transcription model depends on the deployment's account, so a deployment must name one explicitly or the tool reports the missing route.
- **An unconfigured route stays visible** — a tool whose provider advertises nothing is still registered, so calling it returns a structured error rather than the tool disappearing. This keeps the schema list stable mid-conversation; a policy that wants to hide unused tools must gate on `ctx.media.capabilities()` itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: recovering the image reference without the Session log

`image-input.ts` walks the Session events to turn an attachment id into the complete reference the store verifies, which duplicates a private helper in `session-controller`. Both need the same traversal, so the eventual home is an exported lookup on the session or attachment side. It was not extracted here because the two callers read different event sets and the shared form is not yet clear.

</details>
