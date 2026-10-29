/**
 * The media card's staged form over the `media` selection and the two provider
 * namespaces it can configure.
 *
 * The card edits exactly one provider at a time: the staged selection decides
 * which namespace's endpoint, key reference, and per-operation models the form
 * shows, so the user never sees two endpoints for one route. A selection equal
 * to the service's composed value clears the override instead of storing a copy
 * of it.
 *
 * The key is the one control that does not live in a section: its literal never
 * rides a response, so the card learns only whether one is configured and
 * writes it through the credentials domain, addressed by the reference the
 * selected provider's section names.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormShell, type SettingsFormScope, type SettingsFormScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Namespaces this card edits. Spelled here rather than imported: a client
 * package must not depend on a Host package.
 */
export const MEDIA_NS = 'media'
/** Namespace of the OpenAI-compatible media provider. */
export const MEDIA_OPENAI_NS = 'media-openai'
/** Namespace of the native Gemini media provider. */
export const MEDIA_GEMINI_NS = 'media-gemini'

/** Provider ids the selection writes, matching what each provider package registers. */
export const PROVIDER_IDS = {
  openai: 'openai-compatible',
  gemini: 'gemini',
} as const

/** Credential reference each provider resolves when its section names none. */
const DEFAULT_API_KEY_REFS = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
} as const

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The media service's provider selection. */
export interface MediaSelection {
  /** Explicit provider id; omitted auto-selects the only usable provider. */
  mediaProvider?: string
}

/** The fields one provider's namespace carries. */
export interface MediaProviderSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Endpoint base with its version prefix; blank inherits the provider default. */
  baseURL?: string
  /** Image-describing model id; blank disables `describe`. */
  describeModel?: string
  /** Image-generating model id; blank disables `generate`. */
  generateModel?: string
  /** Audio-transcribing model id; blank disables `transcribe`. */
  transcribeModel?: string
}

/** Which provider the card is editing. */
export type MediaProviderChoice = keyof typeof PROVIDER_IDS

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the media card renders. */
export interface MediaCardState extends SettingsFormShell {
  /** Staged provider choice. */
  choice: MediaProviderChoice
  /** Whether both provider namespaces are served, so the choice can be switched. */
  choiceAvailable: boolean
  /** Endpoint of the selected provider. */
  baseURL: SettingsFieldState
  /** Image-describing model of the selected provider. */
  describeModel: SettingsFieldState
  /** Image-generating model of the selected provider. */
  generateModel: SettingsFieldState
  /** Audio-transcribing model of the selected provider. */
  transcribeModel: SettingsFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: SettingsFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface MediaCardFace extends SettingsFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMediaCard. */
    mediaCard: SnapshotStore<MediaCardState>
  }
  /** Stage the provider choice. */
  setChoice: (choice: MediaProviderChoice) => void
}

/** Settings scopes for the namespaces the card edits. */
export interface MediaCardScopes {
  /** The media service's provider selection. */
  media: SettingsFormScope<MediaSelection>
  /** OpenAI-compatible provider settings. */
  openai: SettingsFormScope<MediaProviderSettings>
  /** Native Gemini provider settings. */
  gemini: SettingsFormScope<MediaProviderSettings>
}

/** Bridges the three settings scopes and the credentials domain onto the card. */
export class MediaCardController {
  private readonly selection: SettingsFormModel<MediaSelection>
  private readonly openai: SettingsFormModel<MediaProviderSettings>
  private readonly gemini: SettingsFormModel<MediaProviderSettings>
  private readonly store: SnapshotStore<MediaCardState>
  private readonly unsubscribe: (() => void)[]
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scopes - the bound settings scopes for the card's namespaces.
   * @param ctx - the plugin's context, whose `remote.credentials` namespace
   * answers for the credential the selected provider references.
   */
  constructor(
    private readonly scopes: MediaCardScopes,
    private readonly ctx: ClientContext,
  ) {
    this.selection = new SettingsFormModel(scopes.media, [settingsTextField('mediaProvider')], [
      { field: API_KEY_FIELD, write: text => this.writeKey(text) },
    ])
    this.openai = new SettingsFormModel(scopes.openai, PROVIDER_FIELDS.map(settingsTextField))
    this.gemini = new SettingsFormModel(scopes.gemini, PROVIDER_FIELDS.map(settingsTextField))
    this.store = createSnapshotStore(this.projection())
    // A staged choice can change which section names the key, without any scope
    // publishing; a scope change can rename the reference itself.
    const publish = () => {
      this.store.set(this.projection())
      if (this.ref() !== this.credential.ref) void this.readCredential()
    }
    this.unsubscribe = [
      ...[this.selection, this.openai, this.gemini].map(form => form.bind(() => form.shell()).subscribe(publish)),
      ...[scopes.media, scopes.openai, scopes.gemini].map(scope => scope.subscribe(() => { void this.readCredential() })),
    ]
    void this.readCredential()
  }

  /** Whether the Host serves both provider namespaces, so the choice can be staged. */
  private choiceAvailable(): boolean {
    return this.openai.shell().available && this.gemini.shell().available
  }

  /**
   * The staged provider choice. A selection naming a provider this card does not
   * edit — one added by another package — keeps the card showing the first
   * served namespace rather than nothing, because the card still owns the
   * selection field itself.
   */
  private choice(): MediaProviderChoice {
    const declared = this.selection.field('mediaProvider').text
    return declared === PROVIDER_IDS.gemini ? 'gemini' : 'openai'
  }

  /** The form for the currently staged provider. */
  private form(): SettingsFormModel<MediaProviderSettings> {
    return this.choice() === 'gemini' ? this.gemini : this.openai
  }

  private projection(): MediaCardState {
    const active = this.form()
    const shellOf = active.shell()
    const served = [shellOf, this.selection.shell()].filter(item => item.available)
    const shell: SettingsFormShell = {
      available: shellOf.available,
      writable: served.every(item => item.writable),
      dirty: served.some(item => item.dirty),
      invalid: served.some(item => item.invalid),
      saving: served.some(item => item.saving),
      failed: served.some(item => item.failed),
    }
    return {
      ...shell,
      choice: this.choice(),
      choiceAvailable: this.choiceAvailable(),
      baseURL: active.field('baseURL'),
      describeModel: active.field('describeModel'),
      generateModel: active.field('generateModel'),
      transcribeModel: active.field('transcribeModel'),
      apiKey: this.selection.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /** The reference the selected provider's section names, or that provider's default. */
  private ref(): string {
    const choice = this.choice()
    const snapshot = choice === 'gemini' ? this.scopes.gemini.getSnapshot() : this.scopes.openai.getSnapshot()
    return refOf(snapshot, DEFAULT_API_KEY_REFS[choice])
  }

  /**
   * Ask the credentials domain about the reference the selected provider names.
   *
   * The answer is stored with the reference it describes: the choice and
   * `apiKeyEnv` can change between the request and its response, and two reads
   * can settle out of order, so a response is published only while it still
   * answers for the reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = this.ref()
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== this.ref()) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): MediaCardFace {
    const formOf = (field: string): SettingsFormModel<MediaProviderSettings> | SettingsFormModel<MediaSelection> =>
      field === API_KEY_FIELD ? this.selection : this.form()
    return {
      hooks: { mediaCard: this.store },
      edit: (field, text) => { formOf(field).actions().edit(field, text) },
      resetField: (field) => { formOf(field).actions().resetField(field) },
      setChoice: (choice) => { this.select(choice) },
      save: () => { void this.save() },
      discard: () => {
        for (const form of [this.selection, this.openai, this.gemini]) form.actions().discard()
      },
    }
  }

  /**
   * Stage the provider selection. A target equal to the composed value clears
   * the override so the deployment default keeps applying.
   * @param choice - the provider to select.
   */
  private select(choice: MediaProviderChoice): void {
    const base = this.scopes.media.getSnapshot().base as MediaSelection | undefined
    const actions = this.selection.actions()
    const target = PROVIDER_IDS[choice]
    // Persist the choice before the next render reads it, so the form the user
    // edits is the form for the provider they just picked. Staging publishes
    // through the form subscription, which republishes the state and re-reads a
    // newly referenced credential.
    if (base?.mediaProvider === target) actions.resetField('mediaProvider')
    else actions.edit('mediaProvider', target)
  }

  /**
   * Save the provider section before the selection, so a switch takes effect
   * only after the endpoint it uses has landed. A refused section stops the
   * selection from saving and keeps every remaining draft for correction.
   * @returns settlement after every attempted write.
   */
  private async save(): Promise<void> {
    const state = this.projection()
    if (!state.available || state.invalid || state.saving) return
    const active = this.form()
    if (active.shell().dirty) {
      await active.save()
      if (active.shell().failed) return
    }
    if (this.selection.shell().dirty) await this.selection.save()
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(this.ref(), value)
    await this.readCredential()
    return this.credential.configured
  }

  /** Release configuration subscriptions. */
  dispose(): void {
    for (const off of this.unsubscribe) off()
    for (const form of [this.selection, this.openai, this.gemini]) form.dispose()
  }
}

/** The text fields every provider namespace carries. */
const PROVIDER_FIELDS = ['baseURL', 'describeModel', 'generateModel', 'transcribeModel'] as const

/**
 * The credential reference a section names, or that provider's default.
 * @param snapshot - the section's current scope snapshot.
 * @param fallback - the reference to address when the section names none.
 * @returns the reference to address.
 */
function refOf(
  snapshot: SettingsFormScopeSnapshot<{ apiKeyEnv?: string }>,
  fallback: string,
): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : fallback
}
