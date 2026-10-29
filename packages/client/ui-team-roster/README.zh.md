---
description: "插件页中的团队名册卡片：每位专家的提供方、模型与职责。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-team-roster

[English](README.md) | 中文

## Summary

该卡片在插件页编辑 `team-roster` 插件的 `agents` 数组。每一行命名一位专家，从其提供方的实时模型目录中选择提供方与模型，并写明它擅长的工作与允许承担的职责。行以整体增删，一次保存写出完整数组。只有 `team-roster` 命名空间被提供时卡片才出现。

## Table of Contents

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

在插件页启用 **团队名册** 组合包，打开其详情，为每位专家添加一行：短名称、提供方、该提供方的一个模型、擅长的工作，以及允许执行的职责。在行下方选择**队长**（先发言，并计入人数上限）、**参与人数**（`0` 表示全部专家）与**执行方式**（同时进行，或一个接一个并交接报告）。整份名册保存一次。

### 限制

模型选择器需要至少一个已配置的提供方；没有时卡片报告目录不可用，行内已输入的值仍保留。职责是提示而非强制：它告诉专家应守住的边界，而工具访问仍由 Agent 预设决定。删除一行只在保存前影响草稿。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>维护者细节——点击展开</summary>

控制器持有一份草稿数组，通过 `configForms.get('team-roster')` 以单次 `set agents` 操作写出，因此一次保存就是一次带版本校验的写入。提供方与模型来自 `ctx.remote.session.modelCatalog()`，与模型选择器同源；目录外的既有值仍保持可选，避免旧行无法编辑。卡片以行 id `team-roster` 注册到插件页的 `plugins.item` 槽位。

</details>

-----
<a id="further-exploration"></a>
## 延伸阅读

消费该名册的 Host 半边位于 `@deepseek-ai/dsh-experimental-team-roster`。

<a id="model-experience"></a>
## Model Experience

None directly. The roster this card writes changes which agents, providers, and duties the Host plugin can offer; the Host owns every model-visible prompt.

#### KV Cache effect

Independent. The card writes configuration and sends no model request.

## Known Limitations and Deferred Work

- **没有逐行校验** — 重复或空名称会被卡片接受；可用名册由 Host 报告。
- **职责只是文字，不是工具白名单** — 限制子代理可调用的工具需要 Agent 预设，本卡片不负责编写。
- **只读目录** — 页面加载后提供方新增的模型需要刷新。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>
