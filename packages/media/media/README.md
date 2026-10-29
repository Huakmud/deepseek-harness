---
description: "The ctx.media capability seam: how deployments register media providers and how consumers select one that can describe an image, generate an image, or transcribe audio."
kind: "package-reference"
---

# @deepseek-ai/dsh-media

English | [中文](README.zh.md)

## Summary

`dsh-media` is the Service Definition for an auxiliary media route. It owns the `ctx.media` registry, the three operation contracts (`describe`, `generate`, `transcribe`), and the selection rule that picks one provider per call. Choose it when a text-only main model still needs to see or draw images: the model's route stays untouched, and the work goes to a second API reached through tools.

A provider advertises only configured operations. Naming `mediaProvider` makes it serve every operation it advertises; naming none requires exactly one usable provider per operation, and two candidates is an ambiguity error rather than an arbitrary pick.

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

Mount it, then mount at least one provider package. Consumers read `ctx.media`; a deployment that mounts no provider has a seam that advertises no operation, and every consumer reports that rather than failing to boot.

```yaml
- id: media
  name: '@deepseek-ai/dsh-media'
  config:
    mediaProvider: openai-compatible

- id: media-openai
  name: '@deepseek-ai/dsh-media-openai'
```

### When to choose it

Choose it when images or audio must reach a model that cannot accept them, or when a deployment wants generation to come from a different vendor than the conversation. A deployment whose model already accepts images does not need it: `tool-fs` reads images directly in that case and only falls back to this seam when the route cannot.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `mediaProvider` | unset | Provider id that serves every operation. Unset selects automatically, requiring exactly one usable provider per operation. |

Every field is volatile, so a settings-page write applies to the next media call without remounting any plugin.

### Operations

| Operation | Purpose |
|---|---|
| `describe` | Read an image and return a written description. |
| `generate` | Draw an image from a prompt, optionally conditioned on a reference image. |
| `transcribe` | Turn an audio recording into text. |

## Understand the implementation

`MediaRuntime` holds a `Map` of providers keyed by id. `registerProvider` returns the disposer that removes the registration, so a provider package that is reloaded or disabled takes its own contribution with it and emits `media/providers-updated` at both edges.

`resolve(capability)` is the only selection point. It reads the configured id from the volatile section on every call, which is why a settings write takes effect without a restart. The six outcomes are distinct errors rather than fallbacks: a configured id that is not registered, a configured provider that is not usable, a configured provider that does not offer the operation, no usable provider at all, more than one candidate, and a rejected operation.

A provider with no configured operation is dormant rather than invalid: the settings section starts empty, so a deployment that has not named a model yet must still boot. A dormant provider advertises nothing, so selection never picks it.

### Selection outcomes

| Code | Meaning |
|---|---|
| `MEDIA_PROVIDER_CONFIGURED_MISSING` | `mediaProvider` names an id no package registered. |
| `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` | The configured provider reports itself unusable. |
| `MEDIA_PROVIDER_AMBIGUOUS` | Several usable providers offer the operation and none is configured. |
| `MEDIA_PROVIDER_UNAVAILABLE` | No usable provider offers the operation. |
| `MEDIA_UNSUPPORTED_CAPABILITY` | The selected provider does not offer the operation. |
| `MEDIA_PROVIDER_DUPLICATE` | Two packages registered the same provider id. |
| `MEDIA_CONFIG_INVALID` | The section carries a value the seam cannot use. |
| `MEDIA_EMPTY_RESPONSE` | The provider answered with nothing usable. |
| `MEDIA_PROVIDER_ERROR` | The provider rejected the request. |
| `MEDIA_ABORTED` | The caller cancelled the call. |
| `MISSING_CREDENTIAL` | The provider found no usable credential. |

### Events

`media/providers-updated` fires after the registry changes. A failing listener is contained and logged rather than allowed to fail the registration that emitted it, so one broken consumer cannot take down provider registration.

## Further Exploration

- [Media subsystem](../../../docs/subsystems/media.md) — the seam, both provider adapters, and the consumer, end to end.
- [Capability seams](../../../docs/glossary.md#capability-seam) — why the three roles are separate packages.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-media) — the schemas the consumer contributes.

## Model Experience

None, as the seam contributes no prompt prose and no tool schema of its own; the consumer that registers a tool and its guidance owns every model-visible effect.

#### KV Cache effect

Independent. Registry changes reach no model request, so no cached prefix can be invalidated by adding, removing, or replacing a provider.

## Known Limitations and Deferred Work

- **No operation routing per provider** — `mediaProvider` names one provider for all three operations. A deployment that wants vision from one vendor and generation from another must pick one for both, or install a single provider package pointed at a gateway that proxies both. Per-operation routing needs a settings surface that does not exist yet.
- **No retry or failover** — a failing provider reports its failure to the caller. Nothing falls back to a second registered provider, because a silent substitution would make the attribution the consumer prints wrong.
- **Provider availability is local** — `available()` reports whether a provider could serve a request from local configuration alone; it is not a reachability probe. A provider whose endpoint is down reports itself usable and fails at request time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: per-operation provider routing

`mediaProvider` is one id for all three operations, which is a simplification rather than a decision. A deployment with vision on one vendor and generation on another is real enough that the section will likely become a per-operation map. The open question is whether that map names providers or named routes, since one provider package could legitimately be mounted twice with different endpoints.

</details>
