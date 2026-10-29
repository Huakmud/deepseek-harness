---
description: "The Media card on the Models settings page: how users choose the auxiliary media provider and set its endpoint, models, and credential from the Web GUI."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-media

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-media` renders the **Media** card on the existing Models settings page. It is the only user-facing surface for the auxiliary media route: a user picks which registered provider serves image and audio work, then sets that provider's endpoint, one model per operation, and the credential reference.

The card writes the same namespaces the provider plugins read (`media`, `media-openai`, `media-gemini`), so a saved change applies to the next media call without restarting the app.

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

Load it in a Web composition that already mounts the settings surface. It contributes one card and reads the provider list from the host; it does not need to know which providers exist.

```yaml
- id: ui-settings-media
  name: '@deepseek-ai/dsh-client-ui-settings-media'
```

### When to choose it

Choose it whenever the deployment ships `dsh-tool-media`, because a deployment that mounts media tools without this card leaves the route configurable only through `cordis.yml`.

### What it edits

| Namespace | Fields |
|---|---|
| `media` | `mediaProvider` — which provider serves every operation. |
| `media-openai` | `baseURL`, `describeModel`, `generateModel`, `transcribeModel`, credential. |
| `media-gemini` | `baseURL`, `describeModel`, `generateModel`, `transcribeModel`, credential. |

## Understand the implementation

The card registers into the `settings.models.footer` slot, which the Models page renders below its own content. It owns three `SettingsFormModel` instances — one for the selection and one per provider — and saves the provider section first, then the selection, so a choice is never written before the section it names exists.

The credential is a secret field rather than a plain one: it writes the reference the provider resolves, not a key value, so the key itself stays in the deployment's credential store. Clearing a text field removes the key instead of writing an empty value, which is how a deployment expresses "this operation is unused".

The card refreshes when the credentials surface reports a reference change, so an edit made elsewhere is reflected without a reload.

## Further Exploration

- [Media subsystem](../../../docs/subsystems/media.md) — the seam, both provider adapters, and the tools these settings enable.
- [Slots reference](../../../docs/subsystems/slots.md) — the extension point the card registers into.
- [Web styling](../../../docs/web-styling.md) — the tokens and CSS Modules rules the card follows.

## Model Experience

None, as the card is browser-side settings that registers no prompt, message, schema, stream, or tool result; the provider plugins it configures own every model-visible effect.

#### KV Cache effect

Does not invalidate. The card changes provider configuration, which alters no request token, so a cached conversation prefix stays reusable after a save.

## Known Limitations and Deferred Work

- **One provider serves all three operations** — the card exposes a single selection, matching the seam. A user who wants vision from one vendor and generation from another cannot express it.
- **Only the two shipped providers are editable** — the card hard-codes the `media-openai` and `media-gemini` namespaces. A third provider package would need its own section here, because the card cannot discover a provider's config schema at runtime.
- **No reachability check** — the card validates that the endpoint parses, not that it answers. A wrong but well-formed URL saves successfully and fails at call time.
- **No credential value entry for an absent store** — the secret field writes a reference. A deployment without a credential store must set the environment variable outside the GUI.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: a discovery surface for provider sections

The card names `media-openai` and `media-gemini` directly because a client plugin cannot read a host plugin's config schema at runtime. A third provider package would need either its own card or a host-published description of its editable fields. Which of those is right depends on whether provider packages are expected to proliferate, so the choice waits for a second non-vendor provider.

</details>
