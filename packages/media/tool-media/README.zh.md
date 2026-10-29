---
description: "基于 ctx.media 的面向模型的媒体工具（media_describe_image、media_generate_image、media_transcribe_audio）：仅支持文本的模型如何通过第二个 API 看、画与听。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-media

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-tool-media` 为模型提供三个工具，把图片与音频工作委派给辅助媒体路由。仅支持文本的模型因此可以询问图片内容、绘制图片或读取录音，而无需获得图片输入能力：它调用一个工具，由另一个模型完成工作，答案作为工具结果返回。

每个结果都标明产出它的提供方与模型，并声明调用模型未看到图片、也未听到录音，从而避免模型声称自己不具备的感知能力。生成的图片会提交到附件存储，以便后续按 id 引用。

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

在 `dsh-media` 与至少一个提供方之后挂载它。它注册到 `ctx.tools`，并为每个启用的工具贡献一个提示词段。

```yaml
- id: tool-media
  name: '@deepseek-ai/dsh-tool-media'
  config:
    generate: true
```

### 何时选择它

当对话所用模型无法接受图片或音频，而部署有第二个可以处理的 API 时选择它。模型本身接受图片的部署不需要 `media_describe_image`：此时 `read_image` 直接处理。

`tool-media` 按 agent 预设组合，而非在主机层只组合一次，因为模型能看到哪些工具是按 agent 的决定。在主机层挂载它的部署应禁用该行，让每个预设自行添加。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `describe` | `true` | 注册 `media_describe_image`。 |
| `generate` | `true` | 注册 `media_generate_image`。 |
| `transcribe` | `true` | 注册 `media_transcribe_audio`。 |
| `quickTimeoutMs` | `120000` | 单次描述或转写调用的协作预算。 |
| `generateTimeoutMs` | `300000` | 单次图片生成的协作预算，它比一次请求更慢。 |

被禁用的工具会带走它的引导段，因此模型永远不会获知它无法调用的工具。

<a id="understand-the-implementation"></a>
## 理解实现

### 指定一张图片

`media_describe_image` 接受 `attachmentId` 或 `path`，且必须恰好提供其一。二者是不同种类的引用，都有必要：用户附加的图片是持久的并以其 id 命名，而模型自己生成或下载的图片是一个路径。

附件 id 只是一个标识符，因此工具在读取前会从 Session 日志恢复完整引用。存储会依据已存字节校验完整引用，这正是恢复必要的原因：本对话从未引用的 id 会被拒绝，而非猜测。

对于路径来源，字节决定媒体类型。与内容不一致的扩展名会被拒绝，因为提供方会拒绝声明类型与其正文相矛盾的上传。

### 提交生成的图片

`media_generate_image` 将提示词发送到接缝，然后通过 `attachments.saveImage` 提交返回的字节。提交在返回结果之前完成，因此在同一轮继续对话的模型已经可以引用该附件 id。

没有返回图片的生成 — 因为模型改用文字回答而非绘图 — 会被报告为失败，而不是作为图片提交。

### 注册与设置页

所有设置在挂载时从插件配置读取；工具集合对一次组合是固定的。提供方端点、模型与凭据设置是易变的，属于提供方包，因此在模型设置页修改模型会在下一次调用时生效，无需重新挂载这些工具。

<a id="further-exploration"></a>
## 进一步探索

- [媒体子系统](../../../docs/subsystems/media.zh.md) — 接缝、两个适配器与这些工具三者合观。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-media) — 生成的 schema，包含全部参数。
- [添加工具](../../../docs/cookbook/adding-a-tool.zh.md) — 这些工具遵循的呈现约定。

<a id="model-experience"></a>
## 模型体验

### 三个媒体工具

#### What the model sees

Three tool schemas, registered only for the tools a composition enables. Their parameters and descriptions are catalogued at [tool-catalog](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-media) and are not repeated here. The delta this package owns is the result rendering: a description or transcript names its producer and disclaims direct perception, while a drawn image is an image block plus a text block naming the producer and the pixel size.

#### Token effect

Conditional. Each enabled tool adds its schema to every request. A result adds the provider/model sentence plus the description or transcript text, and a generated image adds an image block whose cost depends on the image itself. A describe or transcribe call whose result is later compacted costs no more than any other tool result.

#### KV Cache effect

Append-only for tool results, which extend the transcript in call order and preserve the reusable prefix. A settings change to the provider endpoint, model, or credential alters no request token, so it cannot invalidate a cached prefix. Enabling or disabling a tool changes the schema list, which replaces the request prefix and does invalidate reuse.

### 系统提示词中的媒体引导

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

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **没有跨轮次的图片记忆** — 描述与任何其他工具结果一样，因此丢弃它的压缩会让图片不可达，直到模型再次询问。附件本身仍然存在，只有描述会丢失。
- **每次调用一张图片** — 比较多张图片需要每次调用一张，模型必须自行关联这些答案。
- **音频转写在两个提供方上都已声明，但没有随附默认模型** — 可靠的转写模型取决于部署的账号，因此部署必须显式指定，否则工具会报告缺少路由。
- **未配置的路由仍保持可见** — 提供方未声明任何操作的工具仍会注册，因此调用它会返回结构化错误，而不是让工具消失。这保持了会话中途 schema 列表的稳定；希望隐藏未使用工具的策略必须自行依据 `ctx.media.capabilities()` 判断。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

本开发备注是维护者的工作背景：未决问题与尚未确定的方向。它明确不具权威性 — 已发布的行为、限制与理由位于上文各节。

#### 未来：不依赖 Session 日志恢复图片引用

`image-input.ts` 遍历 Session 事件，把附件 id 变成存储可校验的完整引用，这复制了 `session-controller` 中的一个私有辅助函数。两者都需要同一次遍历，因此最终的归属是会话侧或附件侧的一个导出查询。此处未抽取，是因为两个调用方读取的事件集合不同，而共享形式尚未清晰。

</details>
