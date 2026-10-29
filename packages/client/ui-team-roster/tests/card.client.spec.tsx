// @vitest-environment jsdom
/** The roster card as the Plugins page renders it: rows, pickers, and save. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RosterCard, type RosterCardProps } from '../src/client/RosterCard.tsx'
import type { RosterEntry, RosterProvider, RosterState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const PROVIDERS: readonly RosterProvider[] = [
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
  { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-code', name: 'GPT Code' }] },
]

const ROWS: readonly RosterEntry[] = [
  { name: 'shell', provider: 'deepseek', model: 'deepseek-v4-pro', specialty: 'commands', duty: 'run shell commands' },
  { name: 'editor', provider: 'openai', model: 'gpt-code', specialty: 'edits', duty: 'edit files' },
]

const settled: RosterState = {
  available: true,
  writable: true,
  dirty: false,
  saving: false,
  failed: false,
  rows: ROWS,
  leader: '',
  activeAgents: 0,
  order: 'parallel',
  providers: PROVIDERS,
  catalogError: '',
}

function actions() {
  return {
    addRow: vi.fn(), removeRow: vi.fn(), setField: vi.fn(),
    setLeader: vi.fn(), setActiveAgents: vi.fn(), setOrder: vi.fn(),
    save: vi.fn(), discard: vi.fn(),
  }
}

function renderCard(state: Partial<RosterState> = {}, view: 'page' | 'summary' = 'page') {
  const store = createSnapshotStore<RosterState>({ ...settled, ...state })
  const face = actions()
  const props = { ...face, view, t, useRoster: bindSnapshotSelector(store) } as RosterCardProps
  render(<RosterCard {...props} />)
  return face
}

describe('RosterCard', () => {
  it('shows the one-line summary in the list view', () => {
    renderCard({}, 'summary')
    expect(screen.getByText(en.summary)).toBeTruthy()
    expect(screen.queryByLabelText(en.name)).toBeNull()
  })

  it('renders one row per specialist with its provider and model', () => {
    renderCard()
    const names = screen.getAllByLabelText(en.name) as HTMLInputElement[]
    expect(names.map(input => input.value)).toEqual(['shell', 'editor'])
    expect(screen.getAllByLabelText(en.duty).map(input => (input as HTMLInputElement).value))
      .toEqual(['run shell commands', 'edit files'])
    expect((screen.getAllByLabelText(en.provider)[0] as HTMLSelectElement | undefined)?.value).toBe('deepseek')
  })

  it('offers only the models the selected provider serves', () => {
    renderCard()
    const models = screen.getAllByLabelText(en.model) as HTMLSelectElement[]
    expect([...models[0]!.options].map(option => option.value)).toEqual(['deepseek-v4-pro'])
    expect([...models[1]!.options].map(option => option.value)).toEqual(['gpt-code'])
  })

  it('keeps a configured model selectable when the catalog does not list it', () => {
    renderCard({ rows: [{ ...ROWS[0]!, model: 'legacy-model' }] })
    const models = screen.getAllByLabelText(en.model) as HTMLSelectElement[]
    expect(models[0]?.value).toBe('legacy-model')
    expect([...models[0]!.options].map(option => option.value)).toContain('legacy-model')
  })

  it('stages an edit through the injected action', () => {
    const face = renderCard()
    fireEvent.change(screen.getAllByLabelText(en.name)[0]!, { target: { value: 'shell-2' } })
    fireEvent.change(screen.getAllByLabelText(en.duty)[1]!, { target: { value: 'review only' } })
    expect(face.setField.mock.calls).toEqual([[0, 'name', 'shell-2'], [1, 'duty', 'review only']])
  })

  it('adds and removes specialists', () => {
    const face = renderCard()
    fireEvent.click(screen.getByRole('button', { name: en.addAgent }))
    fireEvent.click(screen.getAllByRole('button', { name: en.remove })[1]!)
    expect(face.addRow).toHaveBeenCalledTimes(1)
    expect(face.removeRow).toHaveBeenCalledWith(1)
  })

  it('saves only when something is staged', () => {
    renderCard()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    cleanup()

    const dirty = renderCard({ dirty: true })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(dirty.save).toHaveBeenCalledTimes(1)
    expect(dirty.discard).toHaveBeenCalledTimes(1)
  })

  it('explains an empty roster, a read-only document, and a refused save', () => {
    renderCard({ rows: [] })
    expect(screen.getByText(en.empty)).toBeTruthy()
    cleanup()

    renderCard({ writable: false })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByLabelText(en.name)[0]).toHaveProperty('disabled', true)
    cleanup()

    renderCard({ failed: true })
    expect(screen.getByRole('alert').textContent).toBe(en.saveFailed)
  })

  it('stages a provider, model, and specialty change', () => {
    const face = renderCard()
    fireEvent.change(screen.getAllByLabelText(en.provider)[0]!, { target: { value: 'openai' } })
    fireEvent.change(screen.getAllByLabelText(en.model)[1]!, { target: { value: 'gpt-code' } })
    fireEvent.change(screen.getAllByLabelText(en.specialty)[0]!, { target: { value: 'ops' } })
    expect(face.setField.mock.calls).toEqual([
      [0, 'provider', 'openai'],
      [1, 'model', 'gpt-code'],
      [0, 'specialty', 'ops'],
    ])
  })

  it('keeps a configured provider selectable when the catalog does not list it', () => {
    renderCard({ rows: [{ ...ROWS[0]!, provider: 'ghost' }] })
    const provider = screen.getAllByLabelText(en.provider)[0] as HTMLSelectElement
    expect(provider.value).toBe('ghost')
    expect([...provider.options].map(option => option.value)).toContain('ghost')
  })

  it('shows the in-flight save label while writing', () => {
    renderCard({ saving: true, dirty: true })
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    expect(screen.getAllByLabelText(en.name)[0]).toHaveProperty('disabled', true)
  })

  it('lets the leader be chosen from the roster', () => {
    const face = renderCard({ leader: 'editor' })
    const leader = screen.getByLabelText<HTMLSelectElement>(en.leader)
    expect(leader.value).toBe('editor')
    expect([...leader.options].map(option => option.value)).toEqual(['', 'shell', 'editor'])
    fireEvent.change(leader, { target: { value: 'shell' } })
    expect(face.setLeader).toHaveBeenCalledWith('shell')
  })

  it('stages the participating count and the work order', () => {
    const face = renderCard({ activeAgents: 2, order: 'sequence' })
    expect((screen.getByLabelText<HTMLInputElement>(en.activeAgents)).value).toBe('2')
    expect((screen.getByLabelText<HTMLSelectElement>(en.order)).value).toBe('sequence')
    fireEvent.change(screen.getByLabelText(en.activeAgents), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(en.order), { target: { value: 'parallel' } })
    fireEvent.change(screen.getByLabelText(en.order), { target: { value: 'sequence' } })
    expect(face.setActiveAgents).toHaveBeenCalledWith(1)
    expect(face.setOrder.mock.calls).toEqual([['parallel'], ['sequence']])
  })

  it('explains the sequential handoff', () => {
    renderCard({ order: 'sequence' })
    expect(screen.getByText(en.sequenceHint)).toBeTruthy()
  })

  it('reports an unavailable catalog and unavailable namespace', () => {
    renderCard({ catalogError: 'offline' })
    expect(screen.getByText(en.catalogFailed)).toBeTruthy()
    cleanup()

    renderCard({ available: false })
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByLabelText(en.name)).toBeNull()
  })
})
