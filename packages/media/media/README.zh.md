---
description: "ctx.media 能力接缝：部署如何注册媒体提供方，使用方如何选择一个能够描述图片、生成图片或转写音频的提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-media

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-media` 是辅助媒体路由的服务定义（Service Definition）。它拥有 `ctx.media` 注册表、三个操作约定（`describe`、`generate`、`transcribe`），以及每次调用挑选一个提供方的选择规则。当仅支持文本的主模型仍需看图或画图时选择它：模型自身的路由保持不变，工作交给模型通过工具访问的第二个 API。

提供方只声明已配置的操作。指定 `mediaProvider` 时，该提供方为其声明的每个操作服务；未指定时，每个操作必须恰好有一个可用提供方，出现两个候选即视为歧义错误，而非随意挑选。

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

先挂载它，再挂载至少一个提供方包。使用方读取 `ctx.media`；未挂载任何提供方的部署拥有一个不声明任何操作的接缝，每个使用方都会报告这一点，而不是启动失败。

```yaml
- id: media
  name: '@deepseek-ai/dsh-media'
  config:
    mediaProvider: openai-compatible

- id: media-openai
  name: '@deepseek-ai/dsh-media-openai'
```

### 何时选择它

当图片或音频必须送达一个无法接受它们的模型时，或者当部署希望生成来自与对话不同的厂商时，选择它。模型本身已接受图片的部署不需要它：此时 `tool-fs` 直接读取图片，仅当该路由不可用时才回退到此接缝。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `mediaProvider` | 未设置 | 为每个操作服务的提供方 id。未设置时自动选择，要求每个操作恰好有一个可用提供方。 |

所有字段都是易变的（volatile），因此设置页的写入会在下一次媒体调用时生效，无需重新挂载任何插件。

### 操作

| 操作 | 用途 |
|---|---|
| `describe` | 读取图片并返回文字描述。 |
| `generate` | 根据提示词绘制图片，可选地以参考图片为条件。 |
| `transcribe` | 将音频录音转为文字。 |

<a id="understand-the-implementation"></a>
## 理解实现

`MediaRuntime` 持有一个以 id 为键的提供方 `Map`。`registerProvider` 返回移除该注册的处置函数，因此被重新加载或禁用的提供方包会带走自己的贡献，并在两端发出 `media/providers-updated`。

`resolve(capability)` 是唯一的选择点。它在每次调用时从易变配置段读取 id，这就是设置写入无需重启即可生效的原因。六种结果是彼此不同的错误，而非回退：已配置的 id 未注册、已配置的提供方不可用、已配置的提供方不提供该操作、完全没有可用提供方、候选多于一个，以及操作被拒绝。

未配置任何操作的提供方处于休眠状态而非无效：设置段初始为空，因此尚未指定模型的部署仍必须能够启动。休眠提供方不声明任何操作，因此选择过程永远不会选中它。

### 选择结果

| 错误码 | 含义 |
|---|---|
| `MEDIA_PROVIDER_CONFIGURED_MISSING` | `mediaProvider` 指定了没有包注册的 id。 |
| `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE` | 已配置的提供方报告自身不可用。 |
| `MEDIA_PROVIDER_AMBIGUOUS` | 多个可用提供方提供该操作，且未指定其中之一。 |
| `MEDIA_PROVIDER_UNAVAILABLE` | 没有可用提供方提供该操作。 |
| `MEDIA_UNSUPPORTED_CAPABILITY` | 选中的提供方不提供该操作。 |
| `MEDIA_PROVIDER_DUPLICATE` | 两个包注册了同一个提供方 id。 |
| `MEDIA_CONFIG_INVALID` | 配置段包含接缝无法使用的值。 |
| `MEDIA_EMPTY_RESPONSE` | 提供方返回了没有可用内容的结果。 |
| `MEDIA_PROVIDER_ERROR` | 提供方拒绝了该请求。 |
| `MEDIA_ABORTED` | 调用方取消了该调用。 |
| `MISSING_CREDENTIAL` | 提供方找不到可用的凭据。 |

### 事件

`media/providers-updated` 在注册表变化后触发。失败的监听器会被隔离并记录，而不会让发出该事件的注册流程失败，因此一个损坏的使用方无法拖垮提供方注册。

<a id="further-exploration"></a>
## 进一步探索

- [媒体子系统](../../../docs/subsystems/media.zh.md) — 端到端介绍接缝、两个提供方适配器与使用方。
- [能力接缝](../../../docs/glossary.zh.md#capability-seam) — 三个角色为何是独立的包。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-media) — 使用方贡献的 schema。

<a id="model-experience"></a>
## 模型体验

None, as the seam contributes no prompt prose and no tool schema of its own; the consumer that registers a tool and its guidance owns every model-visible effect.

#### KV Cache effect

Independent. Registry changes reach no model request, so no cached prefix can be invalidated by adding, removing, or replacing a provider.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有按提供方的操作路由** — `mediaProvider` 为全部三个操作指定同一个提供方。希望视觉来自一个厂商、生成来自另一个厂商的部署必须为两者选择同一个，或安装一个指向同时代理两者的网关的提供方包。按操作路由需要目前尚不存在的设置界面。
- **没有重试或故障转移** — 提供方将失败报告给调用方。不会回退到第二个已注册的提供方，因为静默替换会使使用方打印的来源信息失真。
- **提供方可用性是本地判断** — `available()` 仅根据本地配置报告提供方是否可能服务请求，它并非可达性探测。端点已宕机的提供方会报告自身可用，并在请求时失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

本开发备注是维护者的工作背景：未决问题与尚未确定的方向。它明确不具权威性 — 已发布的行为、限制与理由位于上文各节。

#### 未来：按操作路由提供方

`mediaProvider` 为全部三个操作只指定一个 id，这是一种简化而非决策。视觉来自一个厂商、生成来自另一个厂商的部署足够常见，因此该配置段很可能会变成按操作的映射。未决问题是该映射指向提供方还是指向命名路由，因为同一个提供方包可能以不同端点合法地挂载两次。

</details>
