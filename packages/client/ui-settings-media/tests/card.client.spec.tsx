// @vitest-environment jsdom
/** The media card as the Models settings page renders it: provider switch, key, endpoints, and models. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { MediaCard, type MediaCardProps } from '../src/client/MediaCard.tsx'
import type { MediaCardState } from '../src/client/media-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), setChoice: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

/** The card's state before a scenario overrides one part of it. */
const baseState: MediaCardState = {
  ...settled,
  choice: 'openai',
  choiceAvailable: true,
  baseURL: field(''),
  describeModel: field('gpt-4o-mini'),
  generateModel: field(''),
  transcribeModel: field(''),
  apiKey: field(''),
  apiKeyConfigured: false,
  apiKeyWritable: true,
}

function renderMediaCard(state: Partial<MediaCardState> = {}) {
  const store = createSnapshotStore<MediaCardState>({ ...baseState, ...state })
  const actions = cardActions()
  const props = { ...actions, view: 'page', t, useMediaCard: bindSnapshotSelector(store) } as unknown as MediaCardProps
  const view = render(<MediaCard {...props} />)
  return { actions, view }
}

describe('MediaCard', () => {
  it('names the card and explains what the auxiliary route is for', () => {
    renderMediaCard()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByText(en.description)).toBeTruthy()
    expect(screen.getByText(en.providerHint)).toBeTruthy()
  })

  it('switches the edited provider without saving', () => {
    const { actions } = renderMediaCard()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual([en.openai, en.gemini])
    expect(screen.getByRole('tab', { name: en.gemini }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: en.gemini }))

    expect(actions.setChoice).toHaveBeenCalledWith('gemini')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('locks the provider switch unless both providers are served', () => {
    renderMediaCard({ choiceAvailable: false })
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveProperty('disabled', true)
  })

  it('marks the selected provider and edits its models', () => {
    const { actions } = renderMediaCard({ choice: 'gemini', describeModel: field('gemini-2.0-flash') })
    expect(screen.getByRole('tab', { name: en.gemini }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(en.geminiBaseUrlHint)).toBeTruthy()
    expect(screen.getByLabelText(en.describeModel)).toHaveProperty('value', 'gemini-2.0-flash')

    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://gemini.test/v1beta' } })
    fireEvent.change(screen.getByLabelText(en.describeModel), { target: { value: 'gemini-pro' } })
    fireEvent.change(screen.getByLabelText(en.generateModel), { target: { value: 'imagen-4' } })
    fireEvent.change(screen.getByLabelText(en.transcribeModel), { target: { value: 'gemini-audio' } })

    expect(actions.edit.mock.calls).toEqual([
      ['baseURL', 'https://gemini.test/v1beta'],
      ['describeModel', 'gemini-pro'],
      ['generateModel', 'imagen-4'],
      ['transcribeModel', 'gemini-audio'],
    ])
  })

  it('explains the endpoint per provider and the transcription gap on the OpenAI surface', () => {
    renderMediaCard()
    expect(screen.getByText(en.openaiBaseUrlHint)).toBeTruthy()
    expect(screen.getByText(en.transcribeModelUnsupported)).toBeTruthy()
    expect(screen.queryByText(en.geminiBaseUrlHint)).toBeNull()
    expect(screen.queryByText(en.transcribeModelHint)).toBeNull()

    cleanup()
    renderMediaCard({ choice: 'gemini' })
    expect(screen.getByText(en.transcribeModelHint)).toBeTruthy()
    expect(screen.queryByText(en.transcribeModelUnsupported)).toBeNull()
  })

  it('reports whether a key is configured without ever showing one', () => {
    renderMediaCard({ apiKeyConfigured: true })
    expect(screen.getByText(en.apiKeySet)).toBeTruthy()
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('type', 'password')
  })

  it('reports a missing key as the reason the provider cannot be used', () => {
    renderMediaCard()
    expect(screen.getByText(en.apiKeyUnset)).toBeTruthy()
  })

  it('stages the key through the card face', () => {
    const { actions } = renderMediaCard()
    fireEvent.change(screen.getByLabelText(en.apiKey), { target: { value: 'sk-secret' } })
    expect(actions.edit).toHaveBeenCalledWith('apiKey', 'sk-secret')
  })

  it('keeps the key control usable while the settings document is read-only', () => {
    renderMediaCard({ writable: false })
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(en.baseUrl)).toHaveProperty('disabled', true)
    expect(screen.getByRole('tab', { name: en.openai })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
  })

  it('disables the key control when the reference itself is not writable', () => {
    renderMediaCard({ apiKeyConfigured: true, apiKeyWritable: false })
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.baseUrl)).toHaveProperty('disabled', false)
  })

  it('stages each model field and its reset', () => {
    const { actions } = renderMediaCard({
      baseURL: field('https://media.test/v1', { overridden: true }),
      describeModel: field('gpt-4o', { overridden: true }),
      generateModel: field('gpt-image-1', { overridden: true }),
      transcribeModel: field('whisper-1', { overridden: true }),
    })

    expect(screen.getAllByText(en.overridden)).toHaveLength(4)
    for (const reset of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(reset)

    expect(actions.resetField.mock.calls).toEqual([['baseURL'], ['describeModel'], ['generateModel'], ['transcribeModel']])
  })

  it('offers no reset before a field is overridden', () => {
    renderMediaCard()
    expect(screen.queryByText(en.overridden)).toBeNull()
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
  })

  it('shows an invalid model draft beside the field and blocks the save', () => {
    renderMediaCard({ describeModel: field('', { invalid: true }), invalid: true, dirty: true })
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.getByLabelText(en.describeModel).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('locks the section controls while a save is in flight', () => {
    renderMediaCard({ saving: true, dirty: true })
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.baseUrl)).toHaveProperty('disabled', true)
    // The credentials store has its own refusals, so a settings save does not
    // close the key control.
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('disabled', false)
    expect(screen.getByRole('tab', { name: en.openai })).toHaveProperty('disabled', true)
  })

  it('saves the staged edits', () => {
    const { actions } = renderMediaCard({ dirty: true })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.save).toHaveBeenCalledTimes(1)
  })

  it('drops every draft when the card leaves the page', () => {
    const { actions, view } = renderMediaCard()
    view.unmount()
    expect(actions.discard).toHaveBeenCalledTimes(1)
  })

  it('explains an unserved namespace in place of the controls', () => {
    renderMediaCard({ available: false })
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByLabelText(en.baseUrl)).toBeNull()
  })
})

describe('media card copy', () => {
  it('has Chinese copy for every control the card renders', () => {
    expect(zh.title).toBe('媒体模型')
    expect(zh.provider).toBe('媒体提供方')
    expect(zh.apiKey).toBe('API Key')
    expect(zh.transcribeModelUnsupported).toContain('OpenAI')
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
