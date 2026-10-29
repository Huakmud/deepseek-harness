/**
 * The Team Roster card, browser half: it registers into the Plugins page's
 * `plugins.item` slot for the `team-roster` row, so the card appears exactly
 * while that row exists and the Host serves its namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RosterCard } from './RosterCard.tsx'
import { ROSTER_NS, RosterController } from './controller.ts'
import { en, zh, type TeamRosterKey } from './locales.ts'

export type { RosterCardProps } from './RosterCard.tsx'
export type { RosterConfig, RosterEntry, RosterFace, RosterProvider, RosterState } from './controller.ts'
export type { TeamRosterKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team Roster card copy. */
    'settings.teamRoster': TeamRosterKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.teamRoster'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'configForms']

/**
 * Mount the roster card on the Plugins page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-team-roster: dictionaries')
  const controller = new RosterController(ctx.configForms.get(ROSTER_NS), ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-team-roster: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([ROSTER_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'team-roster', order: 110, label: () => t('title'), locale: NS, inject: () => controller.inject(),
  }, RosterCard))), 'ui-team-roster: card')
}
