---
description: "模型设置页中的媒体卡片：用户如何在 Web GUI 中选择辅助媒体提供方，并设置其端点、模型与凭据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-media

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-client-ui-settings-media` 在现有模型设置页上渲染 **媒体** 卡片。它是辅助媒体路由唯一的面向用户界面：用户选择由哪个已注册提供方服务图片与音频工作，然后设置该提供方的端点、每个操作一个模型，以及凭据引用。

卡片写入提供方插件读取的同一批命名空间（`media`、`media-openai`、`media-gemini`），因此保存的改动会在下一次媒体调用时生效，无需重启应用。

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

在已挂载设置界面的 Web 组合中加载它。它贡献一张卡片，并从主机读取提供方列表；它不需要知道存在哪些提供方。

```yaml
- id: ui-settings-media
  name: '@deepseek-ai/dsh-client-ui-settings-media'
```

### 何时选择它

当部署随附 `dsh-tool-media` 时选择它，因为挂载媒体工具却没有此卡片的部署，只能通过 `cordis.yml` 配置该路由。

### 它编辑什么

| 命名空间 | 字段 |
|---|---|
| `media` | `mediaProvider` — 由哪个提供方服务每个操作。 |
| `media-openai` | `baseURL`、`describeModel`、`generateModel`、`transcribeModel`、凭据。 |
| `media-gemini` | `baseURL`、`describeModel`、`generateModel`、`transcribeModel`、凭据。 |

<a id="understand-the-implementation"></a>
## 理解实现

卡片注册到 `settings.models.footer` 槽位，模型设置页会在自身内容下方渲染它。它拥有三个 `SettingsFormModel` 实例 — 一个用于选择，每个提供方一个 — 并先保存提供方配置段，再保存选择，因此选择永远不会在它所指向的配置段存在之前被写入。

凭据是密钥字段而非普通字段：它写入提供方解析的引用，而非密钥值本身，因此密钥保留在部署的凭据存储中。清空文本字段会移除该键，而不是写入空值，这就是部署表达"此操作未使用"的方式。

当凭据界面报告引用变化时卡片会刷新，因此在别处所做的修改无需重新加载即可反映。

<a id="further-exploration"></a>
## 进一步探索

- [媒体子系统](../../../docs/subsystems/media.zh.md) — 接缝、两个提供方适配器，以及这些设置所启用的工具。
- [槽位参考](../../../docs/subsystems/slots.zh.md) — 卡片注册到的扩展点。
- [Web 样式](../../../docs/web-styling.zh.md) — 卡片遵循的 token 与 CSS Modules 规则。

<a id="model-experience"></a>
## 模型体验

None, as the card is browser-side settings that registers no prompt, message, schema, stream, or tool result; the provider plugins it configures own every model-visible effect.

#### KV Cache effect

Does not invalidate. The card changes provider configuration, which alters no request token, so a cached conversation prefix stays reusable after a save.

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **一个提供方服务全部三个操作** — 卡片只暴露一个选择，这与接缝一致。希望视觉来自一个厂商、生成来自另一个厂商的用户无法表达。
- **只有两个随附提供方可编辑** — 卡片硬编码了 `media-openai` 与 `media-gemini` 命名空间。第三个提供方包需要在此拥有自己的配置段，因为卡片无法在运行时发现提供方的配置 schema。
- **没有可达性检查** — 卡片只校验端点能被解析，而非它能否应答。格式正确但错误的 URL 会保存成功，并在调用时失败。
- **凭据存储缺失时无法录入凭据值** — 密钥字段写入的是引用。没有凭据存储的部署必须在 GUI 之外设置环境变量。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

本开发备注是维护者的工作背景：未决问题与尚未确定的方向。它明确不具权威性 — 已发布的行为、限制与理由位于上文各节。

#### 未来：提供方配置段的发现机制

卡片直接写出 `media-openai` 与 `media-gemini`，因为客户端插件无法在运行时读取主机插件的配置 schema。第三个提供方包将需要自己的卡片，或需要主机发布其可编辑字段的描述。二者如何取舍取决于提供方包是否会增多，因此该选择等待第二个非厂商提供方出现。

</details>
