/** The media card's staging, provider switch, and credential write path. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  MediaCardController,
  PROVIDER_IDS,
  type MediaProviderSettings, type MediaSelection,
} from '../src/client/media-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

/** The card plugin's context, scripted down to the credentials namespace it reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

function credentialsApi(configured: boolean, writable = true) {
  const describe = vi.fn((refs: readonly string[]) => Promise.resolve({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured, writable }])),
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  return { ctx: ctxWith({ credentials: { describe, set } }), describe, set }
}

/** Snapshot fields a scenario overrides when it serves the three sections. */
interface ServedLayers {
  media?: Parameters<StubConfigForm<MediaSelection>['publish']>[0]
  openai?: Parameters<StubConfigForm<MediaProviderSettings>['publish']>[0]
  gemini?: Parameters<StubConfigForm<MediaProviderSettings>['publish']>[0]
}

/**
 * Mount the controller over three stub scopes.
 * @param options - whether each Host accepts writes and the credential answer.
 * @returns the scopes, the controller, its face, and a state reader.
 */
function bench(options: { accept?: boolean; configured?: boolean; writable?: boolean; ctx?: never } = {}) {
  const media = stubConfigForm<MediaSelection>()
  const openai = stubConfigForm<MediaProviderSettings>()
  const gemini = stubConfigForm<MediaProviderSettings>()
  if (options.accept === true) {
    acceptWrites(media)
    acceptWrites(openai)
    acceptWrites(gemini)
  }
  const credentials = credentialsApi(options.configured ?? true, options.writable ?? true)
  const controller = new MediaCardController(
    { media: media.scope, openai: openai.scope, gemini: gemini.scope }, options.ctx ?? credentials.ctx,
  )
  const face = controller.inject()
  return { media, openai, gemini, credentials, controller, face, state: () => face.hooks.mediaCard.getSnapshot() }
}

/** Serve all three sections, with one model per provider so a switch is visible. */
function serve(b: ReturnType<typeof bench>, layers: ServedLayers = {}): void {
  b.media.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {}, ...layers.media })
  b.openai.publish({
    status: 'ready', writable: true, value: { describeModel: 'gpt-4o-mini' }, base: {}, user: {}, ...layers.openai,
  })
  b.gemini.publish({
    status: 'ready', writable: true, value: { describeModel: 'gemini-2.0-flash' }, base: {}, user: {}, ...layers.gemini,
  })
}

describe('MediaCardController credential', () => {
  it('reads the default reference of the provider being edited', async () => {
    const b = bench()
    serve(b)
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['OPENAI_API_KEY']) })
    await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true) })
    expect(b.state()).toMatchObject({ choice: 'openai', apiKey: { text: '', overridden: false } })
    b.controller.dispose()
  })

  it('switches the reference with the staged provider, before any save', async () => {
    const b = bench()
    serve(b)
    await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true) })

    b.face.setChoice('gemini')

    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['GEMINI_API_KEY']) })
    expect(b.state()).toMatchObject({ choice: 'gemini', describeModel: { text: 'gemini-2.0-flash' } })
    b.controller.dispose()
  })

  it('addresses the reference a section declares, or the provider default when it names none', async () => {
    const b = bench()
    serve(b)
    b.openai.publish({ value: { apiKeyEnv: 'MY_OPENAI_KEY' } })
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['MY_OPENAI_KEY']) })

    b.openai.publish({ value: { apiKeyEnv: '' } })
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['OPENAI_API_KEY']) })
    b.controller.dispose()
  })

  it('writes the staged key for the selected provider and reports the stored result', async () => {
    const b = bench({ configured: false })
    serve(b)
    b.face.edit('apiKey', '  sk-secret  ')
    expect(b.credentials.set).not.toHaveBeenCalled()

    b.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    }))
    b.face.save()

    await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-secret') })
    await vi.waitFor(() => { expect(b.state()).toMatchObject({ dirty: false, apiKeyConfigured: true }) })
    expect(b.media.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('keeps the stored key when the draft is left blank', () => {
    const b = bench()
    serve(b)
    b.face.edit('apiKey', '   ')
    expect(b.state().dirty).toBe(false)
    b.face.save()
    expect(b.credentials.set).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('keeps a refused key write as a draft instead of claiming it landed', async () => {
    const b = bench({ configured: false })
    serve(b)
    b.face.edit('apiKey', 'sk-secret')
    b.face.save()
    await vi.waitFor(() => { expect(b.state()).toMatchObject({ failed: true, dirty: true }) })
    expect(b.state().apiKeyConfigured).toBe(false)
    b.controller.dispose()
  })

  it('drops an answer for a reference that changed while the read was pending', async () => {
    type Answer = { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }
    let answer: (value: Answer) => void = () => {}
    const describe = vi.fn(() => new Promise<Answer>((resolve) => { answer = resolve }))
    const b = bench({ ctx: ctxWith({ credentials: { describe, set: vi.fn() } }) })
    serve(b)
    b.openai.publish({ value: { apiKeyEnv: 'RENAMED_KEY' } })

    answer({ ok: true, value: { OPENAI_API_KEY: { configured: true, writable: true } } })
    await Promise.resolve()

    expect(b.state().apiKeyConfigured).toBe(false)
    b.controller.dispose()
  })

  it('clears the previous answer as soon as the watched reference changes', async () => {
    const b = bench({ configured: true })
    serve(b)
    await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true) })

    b.face.setChoice('gemini')
    // The Gemini read has not answered yet, so no configured/key answer from
    // OpenAI may survive the switch.
    expect(b.state().apiKeyConfigured).toBe(false)
    b.controller.dispose()
  })

  it('treats a reference the Host does not describe as unconfigured but writable', async () => {
    const describe = vi.fn(() => Promise.resolve({ ok: true as const, value: {} }))
    const b = bench({ ctx: ctxWith({ credentials: { describe, set: vi.fn() } }) })
    serve(b)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(b.state()).toMatchObject({ apiKeyConfigured: false, apiKeyWritable: true })
    b.controller.dispose()
  })

  it('keeps the card usable when the credential read is refused', async () => {
    const refusal = () => Promise.resolve({
      ok: false as const,
      error: new RemoteError('credential/rejected', 'offline', { ref: 'OPENAI_API_KEY' }),
    })
    const describe = vi.fn(refusal)
    const b = bench({ ctx: ctxWith({ credentials: { describe, set: vi.fn() } }) })
    serve(b)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(b.state()).toMatchObject({ available: true, apiKeyConfigured: false, baseURL: { text: '' } })
    b.controller.dispose()
  })

  it('reports a reference the Host marks read-only as not writable', async () => {
    const b = bench({ configured: true, writable: false })
    serve(b)
    await vi.waitFor(() => { expect(b.state().apiKeyWritable).toBe(false) })
    b.controller.dispose()
  })

  it('re-reads only when the Host reports the watched reference changed', async () => {
    const b = bench({ configured: false })
    serve(b)
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenCalled() })
    b.credentials.describe.mockClear()

    b.controller.refreshCredential('OTHER_KEY')
    expect(b.credentials.describe).not.toHaveBeenCalled()

    b.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    }))
    b.controller.refreshCredential('OPENAI_API_KEY')
    await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true) })
    b.controller.dispose()
  })

  it('does not republish an answer that matches what it already reported', async () => {
    const b = bench({ configured: true })
    serve(b)
    await vi.waitFor(() => { expect(b.state().apiKeyConfigured).toBe(true) })
    const settled = b.state()
    b.credentials.describe.mockClear()

    b.controller.refreshCredential('OPENAI_API_KEY')
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenCalledTimes(1) })

    expect(b.state()).toBe(settled)
    b.controller.dispose()
  })
})

describe('MediaCardController provider choice', () => {
  it('shows the first provider for an id this card does not edit', async () => {
    const b = bench()
    serve(b, { media: { value: { mediaProvider: 'another-provider' } } })
    expect(b.state()).toMatchObject({ choice: 'openai', describeModel: { text: 'gpt-4o-mini' } })
    b.controller.dispose()
  })

  it('shows Auto as the first provider when no provider is pinned', async () => {
    const b = bench()
    serve(b)
    expect(b.state()).toMatchObject({ choice: 'openai', choiceAvailable: true })
    b.controller.dispose()
  })

  it('hides the provider switch unless both provider sections are served', () => {
    const b = bench()
    serve(b)
    expect(b.state().choiceAvailable).toBe(true)

    b.gemini.publish({ status: 'unavailable' })

    expect(b.state().choiceAvailable).toBe(false)
    b.controller.dispose()
  })

  it('pins the staged provider when it differs from the composed value', async () => {
    const b = bench({ accept: true })
    serve(b)
    expect(b.state().dirty).toBe(false)

    b.face.setChoice('gemini')
    expect(b.state()).toMatchObject({ choice: 'gemini', dirty: true })
    b.face.save()

    await vi.waitFor(() => { expect(b.media.mutate).toHaveBeenCalledWith(
      [{ op: 'set', path: ['mediaProvider'], value: PROVIDER_IDS.gemini }], undefined,
    ) })
    await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
    b.controller.dispose()
  })

  it('clears a pin instead of copying the composed provider', async () => {
    const composed = { mediaProvider: PROVIDER_IDS.openai }
    const b = bench({ accept: true })
    serve(b, { media: { value: { mediaProvider: PROVIDER_IDS.gemini }, base: composed, user: { mediaProvider: PROVIDER_IDS.gemini } } })

    b.face.setChoice('openai')
    expect(b.state().dirty).toBe(true)
    b.face.save()

    await vi.waitFor(() => { expect(b.media.mutate).toHaveBeenCalledWith(
      [{ op: 'unset', path: ['mediaProvider'] }], undefined,
    ) })
    expect(b.state().choice).toBe('openai')
    b.controller.dispose()
  })

  it('clears a pin that already equals the composed provider instead of copying it', () => {
    const composed = { mediaProvider: PROVIDER_IDS.gemini }
    const b = bench({ accept: true })
    serve(b, { media: { value: composed, base: composed } })

    b.face.setChoice('gemini')

    expect(b.state()).toMatchObject({ choice: 'gemini', dirty: false })
    b.controller.dispose()
  })

  it('discards a staged provider switch', () => {
    const b = bench()
    serve(b)
    b.face.setChoice('gemini')
    expect(b.state().choice).toBe('gemini')

    b.face.discard()

    expect(b.state()).toMatchObject({ choice: 'openai', dirty: false, apiKey: { text: '' } })
    b.controller.dispose()
  })
})

describe('MediaCardController save', () => {
  it('saves the provider section before the selection that starts using it', async () => {
    const b = bench({ accept: true })
    serve(b)
    const order: string[] = []
    for (const [name, host] of [['media', b.media], ['gemini', b.gemini]] as const) {
      const accept = host.mutate.getMockImplementation()!
      host.mutate.mockImplementation((ops, revision) => { order.push(name); return accept(ops, revision) })
    }

    b.face.setChoice('gemini')
    b.face.edit('describeModel', 'gemini-pro')
    b.face.save()
    await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })

    expect(order).toEqual(['gemini', 'media'])
    expect(b.gemini.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['describeModel'], value: 'gemini-pro' }], undefined)
    b.controller.dispose()
  })

  it('keeps the selection staged when the provider section refuses its save', async () => {
    const b = bench({ accept: true })
    serve(b)
    b.gemini.mutate.mockImplementation(() => Promise.resolve(false))

    b.face.setChoice('gemini')
    b.face.edit('describeModel', 'gemini-pro')
    b.face.save()

    await vi.waitFor(() => { expect(b.state().failed).toBe(true) })
    expect(b.media.mutate).not.toHaveBeenCalled()
    expect(b.state()).toMatchObject({ choice: 'gemini', dirty: true })
    b.controller.dispose()
  })

  it('saves nothing before the selected section is served', () => {
    const b = bench({ accept: true })
    b.face.edit('baseURL', 'https://media.test/v1')
    b.face.save()
    expect(b.state().available).toBe(false)
    expect(b.openai.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('saves nothing while a save is already running', async () => {
    const b = bench({ accept: true })
    serve(b)
    let release: (accepted: boolean) => void = () => {}
    b.openai.mutate.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))

    b.face.edit('baseURL', 'https://media.test/v1')
    b.face.save()
    await vi.waitFor(() => { expect(b.state().saving).toBe(true) })

    b.face.save()
    release(true)
    await vi.waitFor(() => { expect(b.state().saving).toBe(false) })
    expect(b.openai.mutate).toHaveBeenCalledTimes(1)
    b.controller.dispose()
  })

  it('saves nothing when no edit is staged', () => {
    const b = bench({ accept: true })
    serve(b)
    b.face.save()
    for (const host of [b.media, b.openai, b.gemini]) expect(host.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('reports the served sections read-only when either one is', () => {
    const b = bench()
    serve(b, { media: { writable: false } })
    expect(b.state().writable).toBe(false)
    b.controller.dispose()
  })

  it('reports the whole card dirty when only the selection is staged', () => {
    const b = bench()
    serve(b)
    b.face.setChoice('gemini')
    expect(b.state()).toMatchObject({ dirty: true, invalid: false, failed: false })
    b.controller.dispose()
  })
})

describe('MediaCardController fields', () => {
  it('routes the key to the selection form and every model field to the active provider', async () => {
    const b = bench({ accept: true })
    serve(b)

    b.face.edit('baseURL', 'https://media.test/v1')
    b.face.edit('apiKey', 'sk-secret')
    b.face.save()

    await vi.waitFor(() => { expect(b.openai.mutate).toHaveBeenCalledWith(
      [{ op: 'set', path: ['baseURL'], value: 'https://media.test/v1' }], undefined,
    ) })
    await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-secret') })
    expect(b.media.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('stages a reset of a model field and writes the unset', async () => {
    const composed = { describeModel: 'gpt-4o-mini' }
    const b = bench({ accept: true })
    serve(b, { openai: { value: composed, base: composed, user: { describeModel: 'gpt-4o' } } })

    b.face.resetField('describeModel')
    expect(b.state().dirty).toBe(true)
    b.face.save()

    await vi.waitFor(() => { expect(b.openai.mutate).toHaveBeenCalledWith(
      [{ op: 'unset', path: ['describeModel'] }], undefined,
    ) })
    expect(b.state().describeModel.text).toBe('gpt-4o-mini')
    b.controller.dispose()
  })

  it('discards every staged draft on every section', () => {
    const b = bench()
    serve(b)
    b.face.edit('baseURL', 'https://media.test/v1')
    b.face.edit('apiKey', 'sk-secret')
    b.face.setChoice('gemini')

    b.face.discard()

    expect(b.state()).toMatchObject({
      dirty: false, choice: 'openai', baseURL: { text: '' }, apiKey: { text: '' },
    })
    b.controller.dispose()
  })

  it('releases every subscription on dispose', () => {
    const b = bench()
    serve(b)
    b.controller.dispose()
    for (const host of [b.media, b.openai, b.gemini]) expect(host.listenerCount()).toBe(0)
  })
})
