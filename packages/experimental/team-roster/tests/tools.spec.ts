/** The roster tools: per-agent model routing, the discussion round, parallel execution, and lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply, type Config } from '../src/index.ts'

/** One tool captured from the Agent-scoped registry. */
interface CapturedTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec: { agent?: Agent; signal: AbortSignal }): Promise<Record<string, unknown>>
  readonly output: { render(args: unknown, value: unknown): { type: string; text: string }[] }
}

/** One specialist child started through the subagent seam. */
interface StartedChild {
  readonly label: string
  readonly provider: string
  readonly model: string
  readonly prompt: string
  readonly dispose: ReturnType<typeof vi.fn>
}

const signal = new AbortController().signal

/** Options that make the harness fail or hang where the plugin must cope. */
interface MountOptions {
  /** Throwing tool registration aborts installation at this tool. */
  failOnTool?: string
  /** Leave the child result pending so the caller can abort first. */
  pendingResult?: boolean
  /** Replace the child's output blocks, for non-text results. */
  outputBlocks?: readonly { type: string; text?: string }[]
}

/**
 * Mount the plugin over a stub Agent and subagent service.
 * @param config - roster configuration under test.
 * @param answers - final text per started child, in call order.
 * @param options - failure and pending-result controls.
 * @returns the captured tools, the calling Agent, lifecycle drivers, and the prompt sections.
 */
function mount(config: Config, answers: readonly string[], options: MountOptions = {}) {
  const tools: CapturedTool[] = []
  const started: StartedChild[] = []
  const sections: string[] = []
  const handlers = new Map<string, (payload: { agent: Agent }) => void>()
  const effects: (() => void)[] = []
  const toolDisposers: ReturnType<typeof vi.fn>[] = []
  const agent = {
    ctx: {
      systemPrompt: {
        getSectionOrder: () => 0,
        section: (section: { text: string }) => { sections.push(section.text); return () => {} },
      },
      tools: {
        register: (tool: unknown) => {
          const captured = tool as CapturedTool
          if (captured.name === options.failOnTool) throw new Error(`refused ${captured.name}`)
          tools.push(captured)
          const off = vi.fn()
          toolDisposers.push(off)
          return off
        },
      },
    },
  } as unknown as Agent
  let answer = 0
  const ctx = {
    agents: { list: () => [agent] },
    on: (event: string, handler: (payload: { agent: Agent }) => void) => { handlers.set(event, handler) },
    effect: (run: () => () => void) => {
      const off = run()
      effects.push(off)
      return off
    },
    subagents: {
      startActivation: vi.fn(async (spec: {
        label: string
        provider: string
        request: { prompt: { text: string }[]; agentOptions: { provider: string; model: string } }
      }) => {
        const dispose = vi.fn(async () => {})
        started.push({
          label: spec.label,
          provider: spec.request.agentOptions.provider,
          model: spec.request.agentOptions.model,
          prompt: spec.request.prompt[0]?.text ?? '',
          dispose,
        })
        const text = answers[answer] ?? ''
        answer += 1
        const result = options.pendingResult === true
          ? new Promise<never>(() => {})
          : Promise.resolve({ output: options.outputBlocks ?? [{ type: 'text', text }], stopReason: 'completed' })
        return { result, dispose }
      }),
    },
  } as unknown as Context
  apply(ctx, config)
  return {
    agent,
    tools: new Map(tools.map(tool => [tool.name, tool])),
    started,
    sections,
    toolDisposers,
    effectDisposers: effects,
    emit: (event: string, payload: { agent: Agent }) => { handlers.get(event)?.(payload) },
  }
}

const ROSTER: NonNullable<Config['agents']> = [
  { name: 'planner', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: 'architecture', duty: 'plan and review' },
  { name: 'coder', provider: 'openai', model: 'gpt-code', specialty: 'implementation', duty: 'edit files' },
]

describe('team roster tools', () => {
  it('registers both tools and the roster guidance', () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, [])
    expect([...b.tools.keys()]).toEqual(['team_discuss', 'team_execute'])
    expect(b.sections[0]).toContain('planner (deepseek/deepseek-v4-pro): architecture — plan and review')
    expect(b.sections[0]).toContain('coder (openai/gpt-code): implementation — edit files')
    expect(b.sections[0]).toContain('Prefer team_execute directly')
  })

  it('tells the model when no specialist is configured', () => {
    const b = mount({ agents: [] }, [])
    expect(b.sections[0]).toContain('The roster is empty')
  })

  it('renders tool results as compact JSON', () => {
    const b = mount({ agents: ROSTER }, [])
    const rendered = b.tools.get('team_discuss')!.output.render({}, { ok: true })
    expect(rendered).toEqual([{ type: 'text', text: '{"ok":true}' }])
  })

  it('routes each specialist to its own provider and model', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, ['plan-a', 'plan-b'])
    const result = await b.tools.get('team_discuss')!.execute({ topic: 'Ship the feature' }, { agent: b.agent, signal })

    expect(b.started.map(child => `${child.provider}/${child.model}`)).toEqual(['deepseek/deepseek-v4-pro', 'openai/gpt-code'])
    expect(result.agents).toEqual(ROSTER)
    const rounds = result.rounds as { positions: { name: string; text: string }[] }[]
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.positions.map(position => position.text)).toEqual(['plan-a', 'plan-b'])
    for (const child of b.started) expect(child.dispose).toHaveBeenCalledTimes(1)
  })

  it('names the duty in the execution prompt', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, ['done'])
    await b.tools.get('team_execute')!.execute({ tasks: [{ agent: 'coder', task: 'Write the module' }] }, { agent: b.agent, signal })
    expect(b.started[0]?.prompt).toContain('Your job on this team: edit files')
  })

  it('feeds the previous round back into the next one', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 2 }, ['first-a', 'first-b', 'second-a', 'second-b'])
    await b.tools.get('team_discuss')!.execute({ topic: 'Ship it' }, { agent: b.agent, signal })

    const secondRound = b.started.slice(2)
    expect(secondRound[0]?.prompt).toContain('first-b')
    expect(secondRound[1]?.prompt).toContain('first-a')
    expect(secondRound[0]?.prompt).not.toContain('first-a')
  })

  it('refuses to discuss with fewer than two agents', async () => {
    const b = mount({ agents: [ROSTER[0]!], maxParallel: 2, rounds: 1 }, [])
    await expect(b.tools.get('team_discuss')!.execute({ topic: 'x' }, { agent: b.agent, signal }))
      .rejects.toThrow('at least two active agents')
  })

  it('runs independent tasks concurrently and reports each output', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, ['did-plan', 'did-code'])
    const result = await b.tools.get('team_execute')!.execute({
      tasks: [
        { agent: 'planner', task: 'Design the module' },
        { agent: 'coder', task: 'Implement the module' },
      ],
    }, { agent: b.agent, signal })

    expect(b.started.map(child => child.model)).toEqual(['deepseek-v4-pro', 'gpt-code'])
    expect(result.results).toEqual([
      { name: 'planner', provider: 'deepseek', model: 'deepseek-v4-pro', output: 'did-plan', stopReason: 'completed' },
      { name: 'coder', provider: 'openai', model: 'gpt-code', output: 'did-code', stopReason: 'completed' },
    ])
  })

  it('rejects a task addressed to an agent that is not on the roster', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, [])
    await expect(b.tools.get('team_execute')!.execute({
      tasks: [{ agent: 'ghost', task: 'Do something' }],
    }, { agent: b.agent, signal })).rejects.toThrow('unknown or inactive roster agent(s): ghost')
  })

  it('rejects an empty task list', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, [])
    await expect(b.tools.get('team_execute')!.execute({ tasks: [] }, { agent: b.agent, signal }))
      .rejects.toThrow('at least one task')
  })

  it('stops a specialist when the caller aborts', async () => {
    const b = mount({ agents: ROSTER, maxParallel: 2, rounds: 1 }, [], { pendingResult: true })
    const controller = new AbortController()
    const running = b.tools.get('team_discuss')!.execute({ topic: 'x' }, { agent: b.agent, signal: controller.signal })
    await vi.waitFor(() => { expect(b.started).toHaveLength(2) })

    controller.abort(new Error('stopped'))
    await expect(running).rejects.toThrow('stopped')
    for (const child of b.started) expect(child.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes every tool when installation fails midway', () => {
    expect(() => mount({ agents: ROSTER }, [], { failOnTool: 'team_execute' })).toThrow('refused team_execute')
  })

  it('installs once per agent and releases tools on disposal', () => {
    const b = mount({ agents: ROSTER }, [])
    b.emit('agent/created', { agent: b.agent })
    b.emit('agent/created', { agent: b.agent })
    expect(b.toolDisposers).toHaveLength(2)

    for (const off of b.effectDisposers) off()
    expect(b.toolDisposers[0]).toHaveBeenCalledTimes(1)
    expect(b.toolDisposers[1]).toHaveBeenCalledTimes(1)

    // A disposed agent that was already released is ignored.
    b.emit('agent/disposed', { agent: b.agent })
  })

  it('rejects a tool call that arrives without a calling Agent', async () => {
    const b = mount({ agents: ROSTER }, [])
    await expect(b.tools.get('team_execute')!.execute({ tasks: [] }, { signal }))
      .rejects.toThrow('team_execute requires a calling Agent')
  })

  it('applies its documented defaults when no configuration is given', () => {
    const b = mount({}, [])
    expect([...b.tools.keys()]).toEqual(['team_discuss', 'team_execute'])
    expect(b.sections[0]).toContain('The roster is empty')
  })

  it('describes a specialist without specialty or duty as a generalist', async () => {
    const plain = [
      { name: 'one', provider: 'deepseek', model: 'm1', specialty: '', duty: '' },
      { name: 'two', provider: 'openai', model: 'm2', specialty: '', duty: '' },
    ]
    const b = mount({ agents: plain, maxParallel: 2, rounds: 1 }, ['a', 'b', 'c'])
    expect(b.sections[0]).toContain('- one (deepseek/m1)')
    await b.tools.get('team_discuss')!.execute({ topic: 'x', rounds: 1 }, { agent: b.agent, signal })
    expect(b.started[0]?.prompt).toContain('the generalist specialist')

    await b.tools.get('team_execute')!.execute({ tasks: [{ agent: 'one', task: 'do it' }] }, { agent: b.agent, signal })
    expect(b.started[2]?.prompt).toContain('the generalist specialist')
    expect(b.started[2]?.prompt).not.toContain('Your job on this team')
  })

  it('keeps only text blocks from a child output', async () => {
    const b = mount({ agents: ROSTER }, [], { outputBlocks: [{ type: 'image' }, { type: 'text', text: 'kept' }] })
    const result = await b.tools.get('team_discuss')!.execute({ topic: 'x' }, { agent: b.agent, signal })
    const rounds = result.rounds as { positions: { text: string }[] }[]
    expect(rounds[0]?.positions.map(position => position.text)).toEqual(['kept', 'kept'])
  })

  it('lets the chosen leader speak first', async () => {
    const b = mount({ agents: ROSTER, leader: 'coder', maxParallel: 2, rounds: 1 }, ['lead-says', 'others-say'])
    const result = await b.tools.get('team_discuss')!.execute({ topic: 'x' }, { agent: b.agent, signal })

    expect(b.started[0]?.label).toContain('coder')
    expect(b.started[1]?.prompt).toContain('lead-says')
    const rounds = result.rounds as { positions: { name: string }[] }[]
    expect(rounds[0]?.positions.map(position => position.name)).toEqual(['coder', 'planner'])
  })

  it('states the leader, the participant count, and the execution order', () => {
    const b = mount({ agents: ROSTER, leader: 'coder', activeAgents: 2, order: 'sequence' }, [])
    expect(b.sections[0]).toContain('The leader is "coder"')
    expect(b.sections[0]).toContain('Only 2 of 2 configured specialist(s) take part')
    expect(b.sections[0]).toContain('sequential')
  })

  it('states when no leader is chosen and every agent takes part', () => {
    const b = mount({ agents: ROSTER }, [])
    expect(b.sections[0]).toContain('No leader is selected')
    expect(b.sections[0]).toContain('All 2 configured specialist(s) take part')
    expect(b.sections[0]).toContain('parallel')
  })

  it('limits participation to the chosen number of specialists', async () => {
    const b = mount({ agents: ROSTER, activeAgents: 1, maxParallel: 2, rounds: 1 }, [])
    await expect(b.tools.get('team_discuss')!.execute({ topic: 'x' }, { agent: b.agent, signal }))
      .rejects.toThrow('at least two active agents')
    await expect(b.tools.get('team_execute')!.execute({
      tasks: [{ agent: 'coder', task: 'x' }],
    }, { agent: b.agent, signal })).rejects.toThrow('unknown or inactive roster agent(s): coder')
  })

  it('keeps the leader inside the participant limit', () => {
    const b = mount({ agents: ROSTER, leader: 'coder', activeAgents: 1 }, [])
    expect(b.sections[0]).toContain('Only 1 of 2 configured specialist(s) take part')
    expect(b.sections[0]).toContain('- coder (openai/gpt-code)')
    expect(b.sections[0]).not.toContain('- planner (deepseek/deepseek-v4-pro)')
  })

  it('runs sequential tasks in order and hands each report to the next', async () => {
    const b = mount({ agents: ROSTER, order: 'sequence' }, ['first-report', 'second-report'])
    const result = await b.tools.get('team_execute')!.execute({
      tasks: [
        { agent: 'planner', task: 'plan it' },
        { agent: 'coder', task: 'build it' },
      ],
    }, { agent: b.agent, signal })

    expect(b.started[0]?.prompt).not.toContain('first-report')
    expect(b.started[1]?.prompt).toContain('first-report')
    expect(result.results).toEqual([
      { name: 'planner', provider: 'deepseek', model: 'deepseek-v4-pro', output: 'first-report', stopReason: 'completed' },
      { name: 'coder', provider: 'openai', model: 'gpt-code', output: 'second-report', stopReason: 'completed' },
    ])
  })

  it('accepts a per-call execution order over the configured one', async () => {
    const b = mount({ agents: ROSTER, order: 'parallel' }, ['a-report', 'b-report'])
    await b.tools.get('team_execute')!.execute({
      tasks: [
        { agent: 'planner', task: 'plan' },
        { agent: 'coder', task: 'code' },
      ],
      mode: 'sequence',
    }, { agent: b.agent, signal })
    expect(b.started[1]?.prompt).toContain('a-report')
  })

  it('refuses a leader that is not on the roster', () => {
    expect(() => mount({ agents: ROSTER, leader: 'ghost' }, [])).toThrow('is not in the roster')
  })
})
