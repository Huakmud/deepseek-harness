/** The roster card controller: seeding, provider/model coupling, save, and discard. */

import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { RosterController, type RosterConfig } from '../src/client/controller.ts'

/** One provider group the Host catalog returns. */
const GROUPS = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
  { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-code', name: 'GPT Code' }, { id: 'gpt-mini', name: 'GPT Mini' }] },
]

/** The card plugin's context, scripted down to the model catalog. */
function ctxWith(answer: { ok: true; value: { groups: typeof GROUPS } } | { ok: false } | Error = { ok: true, value: { groups: GROUPS } }) {
  const modelCatalog = vi.fn(() => answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer))
  return { ctx: { remote: { session: { modelCatalog } } } as never, modelCatalog }
}

/** Shipped roster: two specialists on different providers. */
const SHIPPED: RosterConfig = {
  agents: [
    { name: 'shell', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: 'commands', duty: 'run shell commands' },
    { name: 'editor', provider: 'openai', model: 'gpt-code', specialty: 'edits', duty: 'edit files' },
  ],
}

/**
 * Mount the controller over one stub settings scope.
 * @param config - section value the Host serves.
 * @param answer - catalog answer.
 */
function bench(config: RosterConfig = SHIPPED, answer?: Parameters<typeof ctxWith>[0]) {
  const host = stubConfigForm<RosterConfig>()
  host.publish({ status: 'ready', writable: true, value: config, base: config, user: {}, revision: 3 })
  const { ctx, modelCatalog } = ctxWith(answer)
  const controller = new RosterController(host.scope, ctx)
  const face = controller.inject()
  return { host, controller, face, modelCatalog, state: () => face.hooks.roster.getSnapshot() }
}

describe('RosterController', () => {
  it('seeds the rows from the served section and offers the live model catalog', async () => {
    const b = bench()
    expect(b.state().rows.map(row => row.name)).toEqual(['shell', 'editor'])
    await vi.waitFor(() => { expect(b.state().providers).toHaveLength(2) })
    expect(b.state().providers[1]?.models.map(model => model.id)).toEqual(['gpt-code', 'gpt-mini'])
    b.controller.dispose()
  })

  it('appends a specialist on the first served provider and model', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.state().providers).toHaveLength(2) })

    b.face.addRow()

    expect(b.state().rows).toHaveLength(3)
    expect(b.state().rows[2]).toEqual({ name: '', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: '', duty: '' })
    expect(b.state().dirty).toBe(true)
    b.controller.dispose()
  })

  it('starts a provider change from a model that provider serves', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.state().providers).toHaveLength(2) })

    b.face.setField(1, 'provider', 'deepseek')

    expect(b.state().rows[1]).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-pro' })
    b.controller.dispose()
  })

  it('stages a field edit without writing', () => {
    const b = bench()

    b.face.setField(0, 'duty', 'terminals only')

    expect(b.state().rows[0]?.duty).toBe('terminals only')
    expect(b.state().dirty).toBe(true)
    expect(b.host.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('writes the complete roster on save', async () => {
    const b = bench()
    b.face.setField(0, 'duty', 'terminals only')

    b.face.save()

    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledTimes(1) })
    expect(b.host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['agents'], value: [
        { name: 'shell', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: 'commands', duty: 'terminals only' },
        { name: 'editor', provider: 'openai', model: 'gpt-code', specialty: 'edits', duty: 'edit files' },
      ] },
      { op: 'set', path: ['leader'], value: '' },
      { op: 'set', path: ['activeAgents'], value: 0 },
      { op: 'set', path: ['order'], value: 'parallel' },
    ], 3)
    await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
    b.controller.dispose()
  })

  it('keeps the draft and reports a refused save', async () => {
    const b = bench()
    b.host.mutate.mockResolvedValue(false)
    b.face.setField(0, 'name', 'shell-2')

    b.face.save()

    await vi.waitFor(() => { expect(b.state()).toMatchObject({ failed: true, dirty: true }) })
    expect(b.state().rows[0]?.name).toBe('shell-2')
    b.controller.dispose()
  })

  it('discards staged edits back to the served section', () => {
    const b = bench()
    b.face.setField(0, 'duty', 'anything')
    b.face.removeRow(1)

    b.face.discard()

    expect(b.state().rows.map(row => row.name)).toEqual(['shell', 'editor'])
    expect(b.state()).toMatchObject({ dirty: false, failed: false })
    b.controller.dispose()
  })

  it('reports an unavailable catalog without blocking edits', async () => {
    const b = bench(SHIPPED, new Error('offline'))
    await vi.waitFor(() => { expect(b.state().catalogError).not.toBe('') })
    expect(b.state().providers).toEqual([])
    expect(b.state().rows).toHaveLength(2)
    b.controller.dispose()
  })

  it('releases the section subscription on dispose', () => {
    const b = bench()
    b.controller.dispose()
    expect(b.host.listenerCount()).toBe(0)
  })

  it('reseeds from the Host while no edit is staged', () => {
    const b = bench()
    b.host.publish({ value: { agents: [{ name: 'fresh', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: '', duty: '' }] } })
    expect(b.state().rows.map(row => row.name)).toEqual(['fresh'])
    b.controller.dispose()
  })

  it('keeps staged rows when the Host publishes mid-edit', () => {
    const b = bench()
    b.face.setField(0, 'name', 'staged')
    b.host.publish({ value: SHIPPED })
    expect(b.state().rows[0]?.name).toBe('staged')
    b.controller.dispose()
  })

  it('reports a refused catalog read', async () => {
    const b = bench(SHIPPED, { ok: false })
    await vi.waitFor(() => { expect(b.state().catalogError).not.toBe('') })
    expect(b.state().providers).toEqual([])
    b.controller.dispose()
  })

  it('keeps the current model when the chosen provider is not in the catalog', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.state().providers).toHaveLength(2) })
    b.face.setField(1, 'provider', 'ghost')
    expect(b.state().rows[1]).toMatchObject({ provider: 'ghost', model: 'gpt-code' })
    b.controller.dispose()
  })

  it('saves nothing when no edit is staged', () => {
    const b = bench()
    b.face.save()
    expect(b.host.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('reports a save that throws', async () => {
    const b = bench()
    b.host.mutate.mockRejectedValue(new Error('offline'))
    b.face.setField(0, 'name', 'renamed')
    b.face.save()
    await vi.waitFor(() => { expect(b.state().failed).toBe(true) })
    expect(b.state().dirty).toBe(true)
    b.controller.dispose()
  })

  it('tolerates a malformed persisted roster', () => {
    const host = stubConfigForm<RosterConfig>()
    const malformed = { agents: [{}, { name: 7, duty: 3 }] } as object as RosterConfig
    host.publish({ status: 'ready', writable: true, value: malformed, revision: 1 })
    const controller = new RosterController(host.scope, ctxWith().ctx)
    const state = controller.inject().hooks.roster.getSnapshot()
    expect(state.rows).toEqual([
      { name: '', provider: '', model: '', specialty: '', duty: '' },
      { name: '', provider: '', model: '', specialty: '', duty: '' },
    ])
    controller.dispose()
  })

  it('starts a new row blank when no provider is known yet', () => {
    const b = bench()
    b.face.addRow()
    expect(b.state().rows[2]).toEqual({ name: '', provider: '', model: '', specialty: '', duty: '' })
    b.controller.dispose()
  })

  it('ignores a catalog failure after dispose', async () => {
    let fail: (error: Error) => void = () => {}
    const modelCatalog = vi.fn(() => new Promise((_resolve, reject) => { fail = reject }))
    const host = stubConfigForm<RosterConfig>()
    host.publish({ status: 'ready', writable: true, value: SHIPPED, revision: 1 })
    const controller = new RosterController(host.scope, { remote: { session: { modelCatalog } } } as never)
    controller.dispose()
    fail(new Error('offline'))
    await Promise.resolve()
    expect(controller.inject().hooks.roster.getSnapshot().catalogError).toBe('')
  })

  it('seeds the leader, participant count, and execution order', () => {
    const b = bench({ ...SHIPPED, leader: 'editor', activeAgents: 1, order: 'sequence' })
    expect(b.state()).toMatchObject({ leader: 'editor', activeAgents: 1, order: 'sequence' })
    b.controller.dispose()
  })

  it('stages leader, participant count, and order changes, then saves them together', async () => {
    const b = bench()
    b.face.setLeader('editor')
    b.face.setActiveAgents(1)
    b.face.setOrder('sequence')

    expect(b.state()).toMatchObject({ leader: 'editor', activeAgents: 1, order: 'sequence', dirty: true })
    b.face.save()

    await vi.waitFor(() => { expect(b.host.mutate).toHaveBeenCalledTimes(1) })
    expect(b.host.mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: ['agents'], value: SHIPPED.agents },
      { op: 'set', path: ['leader'], value: 'editor' },
      { op: 'set', path: ['activeAgents'], value: 1 },
      { op: 'set', path: ['order'], value: 'sequence' },
    ])
    b.controller.dispose()
  })

  it('normalizes a missing or nonsensical participant count and order', () => {
    const host = stubConfigForm<RosterConfig>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { agents: SHIPPED.agents, activeAgents: -3, order: 'sideways' as 'parallel' },
    })
    const controller = new RosterController(host.scope, ctxWith().ctx)
    const state = controller.inject().hooks.roster.getSnapshot()
    expect(state).toMatchObject({ activeAgents: 0, order: 'parallel', leader: '' })

    const face = controller.inject()
    face.setActiveAgents(Number.NaN)
    expect(controller.inject().hooks.roster.getSnapshot().activeAgents).toBe(0)
    controller.dispose()
  })
})
