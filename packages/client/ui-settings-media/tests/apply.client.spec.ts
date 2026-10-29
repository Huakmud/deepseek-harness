/** What the browser half registers on the Models page, when, which credential it watches, and teardown. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

/** @param served - namespaces the Host describes; omitted answers a failed read. */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const describeCredentials = vi.fn((refs: readonly string[]) => Promise.resolve({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
  }))
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  const remote = new TestRemote(ctx, {
    credentials: { describe: describeCredentials, set: vi.fn() },
    settings: { describe: describeSettings },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeCredentials, describeSettings, remote }
}

/** The Models page's footer slot, as its owner declares it. */
function declareFooter(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.models.footer': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-media apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.credentials', 'configForms'])
  })

  it('registers the card while the Host serves the selection namespace', async () => {
    const { ctx, slots } = await bench(['media', 'media-openai', 'media-gemini'])
    declareFooter(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('settings.models.footer')).toHaveLength(1) })
    const entry = slots.entries('settings.models.footer')[0]!
    expect(entry.options).toMatchObject({ id: 'media', order: 100 })
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => { hooks: { mediaCard: unknown } })()
    expect(Object.keys(face.hooks)).toEqual(['mediaCard'])
  })

  it('registers nothing while the selection namespace is not served', async () => {
    const { ctx, slots, describeSettings } = await bench(['media-openai'])
    declareFooter(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })

    expect(slots.entries('settings.models.footer')).toHaveLength(0)
  })

  it('re-reads the credential when the Host reports the watched reference changed, and ignores another', async () => {
    const { ctx, slots, describeCredentials, remote } = await bench(['media', 'media-openai'])
    declareFooter(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    remote.emit('credentials/reference-updated', ['SOME_OTHER_KEY'])
    await Promise.resolve()
    expect(describeCredentials).not.toHaveBeenCalled()

    // A key written on another surface changes no settings section, so this
    // event is the only thing that reaches the card.
    remote.emit('credentials/reference-updated', ['OPENAI_API_KEY'])
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalledTimes(1) })
  })

  it('collapses the card on teardown', async () => {
    const { ctx, slots } = await bench(['media', 'media-openai', 'media-gemini'])
    declareFooter(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('settings.models.footer')).toHaveLength(1) })

    await fiber.dispose()

    expect(slots.entries('settings.models.footer')).toHaveLength(0)
  })
})
