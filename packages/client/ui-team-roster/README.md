---
description: "Team Roster card on the Plugins page: the specialists, each with its own provider, model, and duty."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-team-roster

English | [中文](README.zh.md)

## Summary

This card edits the `team-roster` plugin's `agents` array on the Plugins page. Each row names a specialist, picks its provider and model from the Host's live model catalog, and states the work it is best at and the duty it may perform. Rows are added and removed as a whole, and one Save writes the complete array. The card appears only while the `team-roster` namespace is served.

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

Enable the **Team Roster** bundle in the Plugins page. Open its details and add one row per specialist: a short name, a provider, one of that provider's models, what it is best at, and what it is allowed to do. Below the rows, choose the **leader** (it speaks first and counts toward the limit), the **number of agents at work** (`0` uses every roster agent), and the **work order** (all at once or one after another with handoff). Save once for the whole roster.

### Limits

The model picker needs at least one configured provider; without one the card reports an unavailable catalog and the rows keep their typed values. The duty is instruction, not enforcement: it tells the specialist what to stay inside, while tool access still follows the Agent preset. Removing a row removes it only from the edited roster until Save.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The controller owns one draft array and writes it through `configForms.get('team-roster')` with a single `set agents` operation, so a save is one revision-checked write. Provider groups and models come from `ctx.remote.session.modelCatalog()`, the same catalog the model selector uses; an unknown configured value stays selectable so a stale row never becomes uneditable. The card registers into the Plugins page `plugins.item` slot under the row id `team-roster`.

</details>

-----
<a id="further-exploration"></a>
## Further Exploration

The Host half that consumes this roster lives in `@deepseek-ai/dsh-experimental-team-roster`.

<a id="model-experience"></a>
## Model Experience

None directly. The roster this card writes changes which agents, providers, and duties the Host plugin can offer; the Host owns every model-visible prompt.

#### KV Cache effect

Independent. The card writes configuration and sends no model request.

## Known Limitations and Deferred Work

- **No per-row validation** — a duplicate or empty name is accepted by the card; the Host reports the usable roster.
- **Duty is prose, not a tool allowlist** — restricting the tools a child may call needs an Agent preset, which this card does not author.
- **Catalog only** — a model the provider lists after the page loaded needs a reload.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
