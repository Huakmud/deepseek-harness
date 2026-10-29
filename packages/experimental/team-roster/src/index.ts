/**
 * Multi-model team roster: named specialist subagents, each routed to its own
 * provider and model, that produce a shared plan before any of them works.
 *
 * The roster is deployment configuration rather than a model-visible catalog:
 * every entry names an LLM provider and model the deployment already serves, so
 * one team can mix vendors without teaching any agent about routing. A
 * discussion round runs every specialist once, in parallel, and feeds the
 * previous round back so disagreement becomes visible to the caller before it
 * splits the work. Execution then runs one independent child per task, again in
 * parallel, each on the model its entry names. Discussion never writes files;
 * only `team_execute` starts work.
 *
 * @module @deepseek-ai/dsh-experimental-team-roster
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the ctx.subagents Context merge.
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'team-roster'

/** Services this plugin requires. */
export const inject = ['agents', 'subagents', 'tools', 'systemPrompt']

/** One specialist the roster can address by name. */
export interface RosterAgent {
  /** Lower-kebab-case name the Lead uses in tasks. */
  name: string
  /** LLM provider id exactly as the model settings list it. */
  provider: string
  /** Model id that provider serves. */
  model: string
  /** One line describing the work this specialist is best at. */
  specialty: string
  /** What this specialist is allowed to do, such as shell commands or file edits. */
  duty: string
}

/** Roster and execution bounds. */
export interface Config {
  /** Subagent backend that creates one child per agent. */
  subagentProvider?: string
  /** Specialists addressable by name; at least two are needed to discuss. */
  agents?: RosterAgent[]
  /** Children allowed to run at the same time. */
  maxParallel?: number
  /** Default discussion rounds when a call names none. */
  rounds?: number
  /** Agent that speaks first and is named as coordinator; empty means none. */
  leader?: string
  /** How many roster agents participate at all, leader included; 0 means every agent. */
  activeAgents?: number
  /** Default execution order: all tasks at once, or one after another with handoff. */
  order?: 'parallel' | 'sequence'
}

/** Loader schema for the roster. */
export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
  agents: z.array(z.object({
    name: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    specialty: z.string().default(''),
    duty: z.string().default(''),
  })).default([]),
  maxParallel: z.natural().min(1).max(16).default(4),
  rounds: z.natural().min(1).max(5).default(1),
  leader: z.string().default(''),
  activeAgents: z.natural().min(0).max(16).default(0),
  order: z.union(['parallel', 'sequence']).default('parallel'),
})

const AGENT_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    specialty: { type: 'string', required: true },
  },
} as const

const POSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    text: { type: 'string', required: true },
    stopReason: { type: 'string', required: true },
  },
} as const

const DISCUSS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agents: { type: 'array', required: true, items: AGENT_VIEW_SCHEMA },
    rounds: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          round: { type: 'integer', required: true },
          positions: { type: 'array', required: true, items: POSITION_SCHEMA },
        },
      },
    },
  },
} as const

const EXECUTE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          output: { type: 'string', required: true },
          stopReason: { type: 'string', required: true },
        },
      },
    },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- roster tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Join the text blocks of one child's final output. */
function textOf(output: readonly { readonly type: string; readonly text?: string }[]): string {
  return output.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
}

/** Run independent items with a fixed number of workers, preserving input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** One child run with its own model route. */
interface SpecialistRun {
  readonly text: string
  readonly stopReason: string
}

/**
 * Run one specialist as an independent child on its own provider and model.
 * @param ctx - the plugin context owning the subagent service.
 * @param config - resolved roster configuration.
 * @param parent - the calling Agent, which supplies lineage and directory.
 * @param member - the roster entry whose route the child uses.
 * @param prompt - complete instruction for this child.
 * @param signal - caller cancellation.
 * @returns the child's final text and stop reason.
 */
async function runSpecialist(
  ctx: Context,
  config: Required<Config>,
  parent: Agent,
  member: RosterAgent,
  prompt: string,
  signal: AbortSignal,
): Promise<SpecialistRun> {
  const run = await ctx.subagents.startActivation({
    provider: config.subagentProvider,
    label: `team-roster ${member.name}`,
    delivery: 'caller',
    signal,
    request: {
      prompt: [{ type: 'text', text: prompt }],
      parent,
      agentOptions: { provider: member.provider, model: member.model },
    },
  })
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await Promise.race([run.result, aborted.promise])
    return { text: textOf(result.output), stopReason: result.stopReason }
  } finally {
    signal.removeEventListener('abort', onAbort)
    await run.dispose()
  }
}

/** Format the roster for the discussion prompt. */
function discussionPrompt(agent: RosterAgent, topic: string, round: number, previous: readonly Position[]): string {
  const role = agent.specialty.length > 0 ? agent.specialty : 'generalist'
  const head = `You are "${agent.name}", the ${role} specialist on a multi-model team.\nThe Lead asks: ${topic}`
  if (previous.length === 0) {
    return `${head}

Reply with your position only, at most 140 words:
1. the part of this work you are best suited to own;
2. your concrete approach;
3. what you need from another specialist.
Do not start the work, do not edit files, and do not call tools.`
  }
  const others = previous
    .filter(position => position.name !== agent.name)
    .map(position => `- ${position.name}: ${position.text}`)
    .join('\n')
  const heading = round === 1 ? 'What the other specialists said so far:' : `What the other specialists said in round ${round - 1}:`
  return `${head}

${heading}
${others}

Reply with at most 120 words: refine your position, state what you will own, and name any disagreement that the Lead must settle. Do not start the work, do not edit files, and do not call tools.`
}

/** Format one execution task for its specialist. */
function executionPrompt(agent: RosterAgent, task: string, handoff = ''): string {
  const role = agent.specialty.length > 0 ? agent.specialty : 'generalist'
  const duty = agent.duty.length > 0
    ? `\nYour job on this team: ${agent.duty}. Stay inside it: another specialist owns everything else.`
    : ''
  const previous = handoff.length > 0
    ? `\n\nThe specialists before you already worked on this. Their reports:\n${handoff}`
    : ''
  return `You are "${agent.name}", the ${role} specialist on a multi-model team.${duty}${previous}

Your task: ${task}

Do the work now. You share the working directory with the rest of the team, so edit only the files this task owns. Reply with a concise report: what you changed, which files, and anything the Lead must verify or that another specialist must finish.`
}

/** One discussion position, as reported back to the model. */
interface Position {
  readonly name: string
  readonly provider: string
  readonly model: string
  readonly text: string
  readonly stopReason: string
}

/** Render the roster as a one-line-per-agent catalog for the prompt. */
function rosterCatalog(agents: readonly RosterAgent[]): string {
  if (agents.length === 0) return 'The roster is empty. Add agents in Settings before using these tools.'
  return agents.map((agent) => {
    const specialty = agent.specialty.length > 0 ? `: ${agent.specialty}` : ''
    const duty = agent.duty.length > 0 ? ` — ${agent.duty}` : ''
    return `- ${agent.name} (${agent.provider}/${agent.model})${specialty}${duty}`
  }).join('\n')
}

/** The agents that take part, leader first, limited by `activeAgents`. */
function activeRoster(config: Required<Config>): RosterAgent[] {
  const ordered = config.leader.length === 0
    ? [...config.agents]
    : [
      ...config.agents.filter(agent => agent.name === config.leader),
      ...config.agents.filter(agent => agent.name !== config.leader),
    ]
  const limit = config.activeAgents > 0 ? Math.min(config.activeAgents, ordered.length) : ordered.length
  return ordered.slice(0, limit)
}

/** Model-facing guidance for the roster tools. */
function rosterPolicy(config: Required<Config>): string {
  const active = activeRoster(config)
  const leader = config.leader.length > 0
    ? `The leader is "${config.leader}", who speaks first and is named as coordinator.`
    : 'No leader is selected; roster order decides who speaks first.'
  const count = config.activeAgents > 0
    ? `Only ${String(active.length)} of ${String(config.agents.length)} configured specialist(s) take part.`
    : `All ${String(config.agents.length)} configured specialist(s) take part.`
  const order = config.order === 'sequence'
    ? 'Execution order is sequential: team_execute runs tasks one after another in the order you list them, and each specialist receives the earlier reports.'
    : 'Execution order is parallel: independent team_execute tasks run at once.'
  return `A multi-model team roster is configured. ${count} ${leader} Each runs on its own model and has its own duty:
${rosterCatalog(active)}

${order}

Delegate when the work splits into independent pieces or clearly needs different specialisms (shell work, file editing, research, review). Do not delegate a single small edit or a task that must happen in order.

Prefer team_execute directly: one self-contained task per specialist, addressed by name, stating what that specialist owns and where it must stop. Each specialist starts with no memory of this conversation, so include the paths, the goal, and the acceptance check.

Call team_discuss only when the plan itself is uncertain or the specialists would otherwise collide — it costs one model call per specialist per round and changes nothing on disk.`
}

/** Install the roster tools in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team-roster:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: rosterPolicy(config),
    }))

    register(scoped.tools.register(defineTool({
      name: 'team_discuss',
      description: 'Ask every configured specialist for a position on one topic, in parallel, and show where they disagree. Runs no file changes; use it before splitting multi-part work.',
      parameters: {
        topic: { type: 'string', required: true, description: 'The question or goal the team must plan for.' },
        rounds: { type: 'integer', description: `Discussion rounds, 1-5. Defaults to ${String(config.rounds)}; later rounds feed the previous positions back.` },
      },
      output: jsonOutput(DISCUSS_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'team_discuss')
        const roster = activeRoster(config)
        if (roster.length < 2) throw new Error('team_discuss needs at least two active agents')
        const rounds = args.rounds ?? config.rounds
        let previous: readonly Position[] = []
        const transcript: { round: number; positions: Position[] }[] = []
        for (let round = 1; round <= rounds; round += 1) {
          const positions: Position[] = []
          // The leader speaks first, so the rest answer with its position in view.
          const leader = roster.find(member => member.name === config.leader)
          if (leader !== undefined) {
            const run = await runSpecialist(
              ctx, config, caller, leader, discussionPrompt(leader, args.topic, round, previous), exec.signal,
            )
            positions.push({ name: leader.name, provider: leader.provider, model: leader.model, ...run })
          }
          const others = roster.filter(member => member.name !== config.leader)
          const rest = await mapLimit(others, config.maxParallel, async (member) => {
            const run = await runSpecialist(
              ctx, config, caller, member,
              discussionPrompt(member, args.topic, round, [...previous, ...positions]), exec.signal,
            )
            return { name: member.name, provider: member.provider, model: member.model, ...run }
          })
          positions.push(...rest)
          transcript.push({ round, positions })
          previous = positions
        }
        return { agents: roster.map(member => ({ ...member })), rounds: transcript }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_execute',
      description: 'Run one self-contained task per specialist, in parallel, each on the model its roster entry names. Teammates start with no conversation memory; include all needed context in each task.',
      parameters: {
        tasks: {
          type: 'array',
          required: true,
          description: 'One task per active specialist, in the order they should run when the order is sequential.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              agent: { type: 'string', required: true, description: 'Roster agent name.' },
              task: { type: 'string', required: true, description: 'Complete instruction for that specialist.' },
            },
          },
        },
        mode: {
          type: 'string',
          enum: ['parallel', 'sequence'],
          description: `Execution order. Defaults to the configured "${config.order}". Sequential runs one task at a time and hands each specialist the earlier reports.`,
        },
      },
      output: jsonOutput(EXECUTE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'team_execute')
        if (args.tasks.length === 0) throw new Error('team_execute needs at least one task')
        const active = activeRoster(config)
        const byName = new Map(active.map(member => [member.name, member]))
        const unknown = args.tasks.map(task => task.agent).filter(name => !byName.has(name))
        if (unknown.length > 0) throw new Error(`unknown or inactive roster agent(s): ${unknown.join(', ')}`)
        const mode = args.mode ?? config.order
        if (mode === 'sequence') {
          const results: { name: string; provider: string; model: string; output: string; stopReason: string }[] = []
          let handoff = ''
          for (const task of args.tasks) {
            const member = byName.get(task.agent) as RosterAgent
            const run = await runSpecialist(ctx, config, caller, member, executionPrompt(member, task.task, handoff), exec.signal)
            results.push({
              name: member.name, provider: member.provider, model: member.model,
              output: run.text, stopReason: run.stopReason,
            })
            handoff += `${handoff.length > 0 ? '\n' : ''}- ${member.name}: ${run.text}`
          }
          return { results }
        }
        const results = await mapLimit(args.tasks, config.maxParallel, async (task) => {
          const member = byName.get(task.agent) as RosterAgent
          const run = await runSpecialist(ctx, config, caller, member, executionPrompt(member, task.task), exec.signal)
          return { name: member.name, provider: member.provider, model: member.model, output: run.text, stopReason: run.stopReason }
        })
        return { results }
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install the roster tools in every live or subsequently published Agent scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    subagentProvider: config.subagentProvider ?? 'spawn',
    agents: config.agents ?? [],
    maxParallel: config.maxParallel ?? 4,
    rounds: config.rounds ?? 1,
    leader: config.leader ?? '',
    activeAgents: config.activeAgents ?? 0,
    order: config.order ?? 'parallel',
  }
  if (resolved.leader.length > 0 && !resolved.agents.some(agent => agent.name === resolved.leader)) {
    throw new Error(`team-roster: leader "${resolved.leader}" is not in the roster`)
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent)) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'team-roster.scopedTools()')
}
