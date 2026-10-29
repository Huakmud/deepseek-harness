/**
 * The media model card, browser half: it registers into the Models settings
 * page's `settings.models.footer` slot while the Host serves the `media`
 * selection and at least one provider namespace, so a deployment without a
 * media provider shows no trace of the card.
 *
 * The card is one provider at a time. Which provider the user edits is the
 * staged `media.mediaProvider` value, so switching providers and switching the
 * route that serves images stay one fact rather than two that can disagree.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Models page's SlotMap merge (the 'settings.models.footer' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { MediaCard } from './MediaCard.tsx'
import { MEDIA_GEMINI_NS, MEDIA_NS, MEDIA_OPENAI_NS, MediaCardController } from './media-card-controller.ts'
import { en, zh, type MediaSettingsLocaleKey } from './locales.ts'

export type { MediaCardProps } from './MediaCard.tsx'
export type {
  MediaCardFace, MediaCardScopes, MediaCardState, MediaProviderChoice, MediaProviderSettings, MediaSelection,
} from './media-card-controller.ts'
export type { MediaSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Media model card copy. */
    'settings.media': MediaSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.media'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/**
 * Mount the media model card on the Models page while the Host serves its namespaces.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-media: dictionaries')
  const card = new MediaCardController({
    media: ctx.configForms.get(MEDIA_NS),
    openai: ctx.configForms.get(MEDIA_OPENAI_NS),
    gemini: ctx.configForms.get(MEDIA_GEMINI_NS),
  }, ctx)
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-media: form subscription')
  // The selected provider's key is not part of any settings section, so no
  // scope publishes when one is written. This is the only signal that a key
  // written on another surface reached the Host.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }),
    'ui-settings-media: credential invalidations',
  )
  // The card needs its selection namespace plus at least one provider section;
  // requiring both providers would hide it in a deployment that mounts only one.
  ctx.effect(() => ctx.configForms.whileServed([MEDIA_NS], () => ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'media', order: 100, locale: NS, inject: () => card.inject(),
  }, MediaCard))), 'ui-settings-media: card')
}
