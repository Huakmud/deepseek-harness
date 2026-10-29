---
description: "实验性语音服务的云端 Gemini 转录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-speech-to-text-gemini

[English](README.md) | 中文

## 概要

这个可选提供方在 `ctx.speechToText` 上注册一个识别器，把完成的录音转发给 Gemini API 并返回文本。它不拥有麦克风、不下载任何内容、也不运行本地模型：语音输入工具栏仍然负责录音，转录结果仍然在发送前进入草稿。

它读取与媒体提供方相同的 `GEMINI_API_KEY` 凭据，因此一个 Gemini 密钥同时服务图像描述、图像生成、音频转录和语音输入。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在插件中启用[语音输入捆绑包](../voice-input-bundle/README.zh.md)，然后打开其详情并选择 **Gemini** 作为识别器。此后每次按下都只产生一次 Gemini 请求，本地不安装任何内容。

首次按下会请求浏览器麦克风权限。停止录音后，捕获的音频发送给 Gemini，返回的文本插入输入框草稿，供你在发送前查看。

在 `cordis.patch.yml` 的 `speech-to-text-gemini` 行中配置端点、模型和凭据引用：

```yaml
- id: speech-to-text-gemini
  name: '@deepseek-ai/dsh-experimental-speech-to-text-gemini'
  config:
    baseURL: https://generativelanguage.googleapis.com/v1beta
    apiKeyEnv: GEMINI_API_KEY
    model: gemini-3.8-flash
```

`baseURL` 与 `model` 实际上是必填的：空的 `model` 会在首次录音时失败，而不是悄悄用上非预期的模型。`apiKeyEnv` 指定凭据引用，因此在挂载了 `credentials` 服务时通过该服务解析，否则回退到启动环境。

任何多模态 Gemini 模型都能转录音频。`gemini-3.5-transcribe` 返回空响应而非文本，不可选用。

<a id="understand-the-implementation"></a>
## 理解实现

该提供方注册的 `info` 带 `location: 'cloud'` 且没有 `preparation`，注册表因此报告 `phase: 'ready'`。正是这一省略让工具栏可以立即录音，而不弹出下载对话框。

每次录音以规范化的 16 kHz 单声道 PCM16 WAV 到达，Gemini 直接接受该格式，因此字节被原样作为一个 `inlineData` 部分转发，旁边附一段简短指令。转录因此是一次 `POST /models/{model}:generateContent` 请求。

凭据随该请求传输，所以 `redirect` 为 `error`：跟随重定向会把密钥转发到新源。上游状态码与限长的响应正文摘要构成上报的失败，且绝不返回部分转录。

<a id="further-exploration"></a>
## 延伸探索

- [实验性语音识别](../speech-to-text/README.zh.md) —— 本提供方注册所向的注册表。
- [语音输入捆绑包](../voice-input-bundle/README.zh.md) —— 挂载它的组合。
- [本地 SenseVoice 提供方](../speech-to-text-sensevoice/README.zh.md) —— 离线替代方案。

<a id="model-experience"></a>
## 模型体验

无。转录发生在提示词发送之前，因此没有任何模型请求、token 或 KV 缓存条目会观察到本包。转录文本仅作为用户可编辑的普通草稿文本进入对话。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 音频离开本机。选择本提供方即用 SenseVoice 的离线保证换取无需下载与更好的多语言覆盖。
- 长录音整体在一次请求中发送，受注册表录音上限而非本提供方约束。
- 语言提示是指令性提示，而非 API 参数，因此错误的提示只会降低准确度，不会使请求失败。

<a id="dev-note"></a>
## 开发说明

该提供方每次调用都重新读取配置，因此通过配置文件更改模型或端点会在下一次录音时生效，无需重启。
