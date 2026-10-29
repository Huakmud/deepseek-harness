# Media 访问

[English](media.md) | 中文

媒体访问接缝是一个[能力接缝](../glossary.zh.md#capability-seam)，在一个 `ctx.media` 服务上横跨**三项操作** — 描述图片、生成图片、转写音频 — 并拆分到多个包：服务定义（[dsh-media](../../packages/media/media)，`ctx.media` + 提供方注册表）、服务提供方（[dsh-media-openai](../../packages/media/media-openai)、[dsh-media-gemini](../../packages/media/media-gemini)）与使用方（[dsh-tool-media](../../packages/media/tool-media)，三个工具 schema）。媒体是**一项可选能力**，不属于 agent loop 主干。更换提供方不会改变模型请求描述、绘图或转写的方式。

此接缝存在的原因：部署可能运行仅读取文本的模型，而用户仍会附加照片并要求生成图片。与其把这些请求拒之门外，harness 将它们委派给第二个 API，并作为普通工具结果返回。

来源：[`packages/media/media/src/types.ts`](../../packages/media/media/src/types.ts)

## 委派模型

对话所用模型保留自己的路由。它不获得图片输入能力、视觉端点或第二个系统提示词。它获得的是一个工具调用：无法查看的图片用 `media_describe_image`，无法绘制的图片用 `media_generate_image`，无法解码的录音用 `media_transcribe_audio`。

由部署选择的另一个模型 — 若部署希望，可来自另一家厂商 — 完成工作，答案作为工具结果返回。每个结果都标明其产出者，并声明调用模型未亲自感知原始内容。这句话并非装饰：缺少它时，收到描述的模型往往会像自己看过图片一样作答，从而使后续关于该图片的问题无法回答。

生成的图片与其他两项操作不同。字节被提交到持久附件存储，并作为普通 `image` 块返回，因此下一轮可以像引用任何其他附件那样引用该图片。不涉及新的 Session 事件类型，也不改变格式版本。

## 为什么一项能力包含三项操作

三项操作共享一个注册表、一套选择策略与一套错误词汇，因此它们是同一个 `ctx.media` 而非三个服务。它们不共享请求 schema — 描述接收图片、生成接收提示词、转写接收音频 — 因此服务暴露并行的 `describe`/`generate`/`transcribe` 方法，而非一个通用调用。这种并行是有意为之。

提供方注册的是**能力**，而非工具。面向模型的名称、schema、提示词引导与呈现全部位于唯一的 `dsh-tool-media` 使用方中。提供方包永远不会看到工具 schema，使用方也永远不会看到线格式。

## 选择提供方

`resolve(capability)` 是唯一的选择点，每次调用执行一次。

当组合设置 `mediaProvider` 时，该提供方为其声明的每个操作服务：请求它不提供的操作会以 `MEDIA_UNSUPPORTED_CAPABILITY` 失败，部署不会被悄悄路由到别处。未设置时，接缝要求每个操作恰好有一个可用提供方。出现两个候选即 `MEDIA_PROVIDER_AMBIGUOUS`，而非随意挑选，因为随意挑选会使使用方打印的来源信息失真。

未配置任何模型的提供方处于休眠状态，而非无效。设置段初始为空，因此全新部署必须在两个提供方包都挂载、且未配置任何内容的情况下启动；休眠提供方只是不声明任何操作，选择过程永远不会到达它。

可达性与声明的操作是两个独立维度。`available()` 报告提供方能否依据本地配置服务请求 — 端点可解析 — 并不说明它提供哪些操作，也不说明主机是否应答。

## 两个提供方适配器

[dsh-media-openai](../../packages/media/media-openai) 使用 OpenAI 线协议，因此既适用于 OpenAI 本身，也适用于任何复现这些端点的网关。描述以 data URL 形式提交图片的对话补全；生成向图片端点提交，并在答案携带 URL 而非字节时下载结果；转写以 multipart 提交音频。

[dsh-media-gemini](../../packages/media/media-gemini) 使用 Gemini 原生的 `generateContent`。描述与生成都是一次请求，生成的图片在响应分片中以内联 base64 到达 — 没有第二次下载，因此凭据永远不会离开 API 主机。请求的像素尺寸会转换为五个支持长宽比中最接近的一个。

两个适配器都拒绝携带凭据的请求发生重定向：跟随重定向会把凭据发送到响应所指的主机。

## 图片限制放宽之处

此前有两个现有接口在路由到的模型无法接受图片时直接拒绝：[dsh-tool-fs](../../packages/fs/tool-fs) 中的 `read_image` 与 [dsh-session-controller](../../packages/api/session-controller) 中的提示词准入。两者现在会在拒绝前检查是否有媒体提供方能够描述图片，因为拒绝会让模型无法查看任何图片，尽管部署能够描述它。

两条路径都不存在时，限制仍然拒绝。它使用与之前相同的理由码，因此客户端不会看到新的失败模式 — 只会看到更少的失败。

## 配置界面

`cordis.yml` 承载提供方端点、按操作的模型与凭据引用。这些字段全部是易变的，因此模型设置页会写入它们，而下一次媒体调用会观察到变化，无需重新挂载插件。

[媒体卡片](../../packages/client/ui-settings-media) 是该页面的界面。它编辑 `media`、`media-openai` 与 `media-gemini` 命名空间：由哪个提供方服务这些操作，以及每个提供方的端点、模型与凭据引用。

`tool-media` 按 agent 预设组合，而非在主机层只组合一次，因为模型能看到哪些工具是按 agent 的决定。因此主机层禁用其 `tool-media` 行，由每个预设自行添加。

## 测试此接缝

三类覆盖支撑此接缝。单元套件针对真实的回环服务器运行每个提供方，因此请求体、认证头、重定向拒绝与失败映射都是被观察到的，而非模拟的。真实组合套件通过 Loader 启动仅用于测试的 `cordis.yml`，因此注册插件的正是部署实际使用的组合。录制的 Session 快照固定了面向模型的工具结果。

<a id="further-reading"></a>
## 延伸阅读

- [能力接缝](../glossary.zh.md#capability-seam) — 每个接缝都遵循的三角色结构。
- [Web 访问](web.zh.md) — 本设计所遵循的双操作接缝。
- [工具目录](../tool-catalog.zh.md#deepseek-aidsh-tool-media) — 生成的 schema。
