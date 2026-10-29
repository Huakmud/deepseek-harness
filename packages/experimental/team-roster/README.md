---
description: "Run a roster of specialist subagents, each on its own model, that discuss a plan before working in parallel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-team-roster

English | [中文](README.zh.md)

## Summary

`dsh-experimental-team-roster` exposes two model-facing tools over a configured roster of specialists. `team_discuss` asks every specialist for a position on one topic, in parallel, and feeds earlier positions into later rounds. `team_execute` runs one self-contained task per specialist, again in parallel. Each specialist is an ordinary subagent child created with an explicit LLM provider and model, so one roster can mix vendors. The bundle ships switched off; the roster is the row's `agents` configuration.

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

Enable **Team Roster** in the sidebar Plugins page, then list the specialists. Each entry names a lower-kebab-case `name`, an LLM `provider`, one of its `model` ids, and a one-line `specialty`:

```yaml
- id: team-roster
  name: '@deepseek-ai/dsh-experimental-team-roster'
  config:
    agents:
      - { name: architect, provider: deepseek, model: deepseek-v4-pro, specialty: architecture, duty: 'plan and review' }
      - { name: coder, provider: openai, model: gpt-code, specialty: implementation, duty: 'edit files' }
      - { name: operator, provider: gemini, model: gemini-3.8-flash, specialty: operations, duty: 'run shell commands' }
    leader: architect
    activeAgents: 2
    order: sequence
    maxParallel: 4
    rounds: 1
```

`subagentProvider` names the subagent backend that creates the children (`spawn` by default). `leader` names the agent that speaks first and is addressed as coordinator; `activeAgents` limits how many roster agents participate, leader included, with `0` meaning all; `order` chooses `parallel` or `sequence`. `maxParallel` bounds concurrent children, and `rounds` sets the default discussion depth. The generated [configuration catalog](../../../docs/config-catalog.md) owns the exhaustive field list.

### When to choose it

Choose it for work that splits into independent pieces where several models bring different strengths: a first opinion round makes disagreement visible, then specialists work at the same time. Switch `order` to `sequence` when each step needs the previous report. It is not a scheduler: tasks that must happen in order also belong in one task when the handoff is trivial.

### Limits

Every specialist starts with no memory of the Lead's conversation, so each task must be self-contained. All children share one working directory; assign disjoint files. Parallel work is faster only when the pieces are independent, and the slowest model bounds each round; a sequential run is slower by design, because each step waits for the previous report.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin installs its tools in each Agent scope and creates one child per call through `ctx.subagents.startActivation`, with `delivery: 'caller'` so only the tool returns the result and nothing reaches the model's inbox. Each child carries `agentOptions: { provider, model }`, which the in-process backend merges over the parent's Agent options. Discussion prompts forbid tool use and file writes; only `team_execute` starts work. Children are disposed after their result settles, and caller cancellation races the result so a stopped turn does not leave children running.

</details>

-----
<a id="further-exploration"></a>
## Further Exploration


<a id="model-experience"></a>
## Model Experience

Teammate prompts are the model-visible contract: each discussion prompt asks for a bounded position and forbids work, and each execution prompt names the task and the reporting expectations. The Lead receives JSON with every position or task result, attributed by agent name and model.

#### KV Cache effect

Independent. Tool registration and the roster section are fixed per composition; calling a tool sends no new request prefix beyond the ordinary tool result.

## Known Limitations and Deferred Work

- **No settings card yet** — the roster is edited through the row's configuration, not in the Web GUI; a dedicated Plugins card is the next piece.
- **No shared task board** — `team_execute` returns each child's report; durable assignment and ownership belong to Agent Teams.
- **Discussion is bounded, not negotiated** — later rounds feed earlier positions but no member revises another's text, and rounds stop at five.
- **Attribution only** — a failed child reports its own stop reason; the tool does not retry on another model.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>