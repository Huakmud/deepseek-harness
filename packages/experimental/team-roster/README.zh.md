---
description: "让一组各用不同模型的专家先讨论计划，再并行执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-team-roster

[English](README.md) | 中文

## Summary

`dsh-experimental-team-roster` 围绕一份配置好的专家名册提供两个模型可见工具。`team_discuss` 并行询问每位专家对同一议题的立场，并把上一轮立场带入下一轮；`team_execute` 为每位专家并行执行一项独立任务。每位专家都是一次普通子代理创建，显式携带 LLM 提供方与模型，因此同一名册可以混合多家厂商。该组合包默认关闭，名册就是该行的 `agents` 配置。

## Table of Contents

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

在侧边栏「插件」页启用 **团队名册**，然后列出专家。每项给出 `name`（短横线小写）、LLM `provider`、其 `model` 之一，以及一行 `specialty`：

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

`subagentProvider` 指定创建子代理的后端（默认 `spawn`）；`leader` 指定先发言并被点名为协调者的专家；`activeAgents` 限制参与人数（含队长，`0` 表示全部）；`order` 选择 `parallel`（并行）或 `sequence`（顺序）；`maxParallel` 限制同时运行的子代理数量；`rounds` 设定默认讨论轮数。完整字段以生成的[配置目录](../../../docs/config-catalog.zh.md)为准。

### 何时选用

当工作可以拆成彼此独立的片段、且不同模型各有长处时选用：先来一轮意见让分歧显形，再由专家同时开工。当每一步都需要上一步的报告时，把 `order` 改成 `sequence`。它不是调度器：交接很简单时，按顺序完成的步骤也应放进同一个任务。

### 限制

每位专家都不带主代理的对话记忆，因此每个任务必须自包含。所有子代理共享同一工作目录，请分配互不重叠的文件。只有任务彼此独立时并行才更快，且每轮耗时由最慢的模型决定；顺序执行按设计更慢，因为每一步都在等待前一份报告。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>维护者细节——点击展开</summary>

插件在每个 Agent 作用域安装工具，并通过 `ctx.subagents.startActivation` 每次调用创建一个子代理，使用 `delivery: 'caller'`，因此结果只回到工具，不进入模型收件箱。每个子代理携带 `agentOptions: { provider, model }`，由进程内后端覆盖父级的 Agent 选项。讨论提示禁止调用工具与写文件，只有 `team_execute` 才开始工作。子代理在结果落定后被释放，调用方取消会与结果竞速，避免停止的回合留下运行中的子代理。

</details>

-----
<a id="further-exploration"></a>
## 延伸阅读


<a id="model-experience"></a>
## 模型体验

队友提示就是模型可见契约：讨论提示要求有限篇幅的立场并禁止开工，执行提示说明任务与汇报要求。主代理收到按代理名与模型归属的 JSON，包含全部立场或任务结果。

#### KV Cache effect

独立。工具注册与名册提示段落按组合固定；调用工具只产生普通工具结果，不新增请求前缀。

## Known Limitations and Deferred Work

- **暂无设置卡片** — 名册通过该行的配置编辑，而不是 Web 界面；专用插件卡片是下一步。
- **没有共享任务板** — `team_execute` 只返回每个子代理的报告；持久分派与归属属于 Agent Teams。
- **讨论是有限轮次而非协商** — 后续轮次会带入上一轮立场，但成员不会改写他人文本，轮数上限为五。
- **只做归属** — 失败的子代理报告自己的停止原因；工具不会改用另一个模型重试。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者细节——点击展开</summary>

None.

</details>