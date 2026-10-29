---
description: "媒体能力族的包地图：媒体服务、其提供方适配器，以及消费它们的面向模型的工具。"
kind: "package-group"
---

# media/ — 媒体能力族

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`media/` 中的包让仅支持文本的模型通过第二个 API 读取图片、绘制图片并转写音频。服务为每个操作挑选一个提供方；部署可选择 OpenAI 兼容协议或 Gemini 原生表面，并为每个操作配置一个模型。当对话所用模型本身无法接受图片或音频时使用此能力族。提供方变更时，模型获得一致的工具行为与错误报告，且每个结果都标明完成工作的模型。

<a id="table-of-contents"></a>
## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

四个包承担媒体的角色；详尽的词汇与约定由子系统参考页负责。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`media/`](media/README.zh.md) | 媒体服务：注册提供方、为每个操作挑选一个、统一的错误词汇 | `ctx.media` |
| [`media-openai/`](media-openai/README.zh.md) | 通过 OpenAI 线协议描述、生成与转写 | 注册到 `ctx.media` |
| [`media-gemini/`](media-gemini/README.zh.md) | 通过 Gemini 原生 `generateContent` 描述与生成 | 注册到 `ctx.media` |
| [`tool-media/`](tool-media/README.zh.md) | 向模型暴露 `media_describe_image`、`media_generate_image` 与 `media_transcribe_audio` | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先阅读子系统参考页了解共享词汇，再阅读本设计所遵循的接缝。

- [媒体子系统](../../docs/subsystems/media.zh.md) — 各操作的请求与结果、提供方选择，以及图片限制放宽之处。
- [能力接缝](../../docs/glossary.zh.md#capability-seam) — 三个角色为何是独立的包。
- [Web 子系统](../../docs/subsystems/web.zh.md) — 本设计所遵循的双操作接缝。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作背景 — 点击展开</summary>

无。

</details>
