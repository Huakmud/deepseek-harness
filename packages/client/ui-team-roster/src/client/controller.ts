/**
 * The roster card's form over the `team-roster` settings namespace.
 *
 * The roster is one array value rather than a fixed set of fields: rows are
 * added and removed as a whole, so every save writes the complete `agents`
 * array. Provider and model choices come from the Host's live model catalog,
 * which is the same catalog the model selector uses.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote Context merge and the settings operation view.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace owned by the Team Roster plugin row. */
export const ROSTER_NS = 'team-roster'

/** One specialist as the card edits it. */
export interface RosterEntry {
  /** Lower-kebab-case name the Lead addresses in tasks. */
  name: string
  /** LLM provider id. */
  provider: string
  /** Model id served by that provider. */
  model: string
  /** One line describing what this specialist is best at. */
  specialty: string
  /** What this specialist is allowed to do. */
  duty: string
}

/** The settings value the card reads and writes. */
export interface RosterConfig {
  /** Specialists addressable by name. */
  agents?: RosterEntry[]
  /** Children allowed to run at the same time. */
  maxParallel?: number
  /** Default discussion rounds. */
  rounds?: number
  /** Subagent backend that creates one child per agent. */
  subagentProvider?: string
  /** Agent that speaks first and is named as coordinator; empty means none. */
  leader?: string
  /** How many agents participate, leader included; 0 means every agent. */
  activeAgents?: number
  /** Default execution order. */
  order?: 'parallel' | 'sequence'
}

/** One provider and the models the Host catalog lists for it. */
export interface RosterProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly { readonly id: string; readonly name: string }[]
}

/** What the card renders. */
export interface RosterState {
  /** Whether the Host serves the `team-roster` namespace. */
  readonly available: boolean
  /** Whether the settings document accepts writes. */
  readonly writable: boolean
  /** Whether a save would write anything. */
  readonly dirty: boolean
  /** Whether a save is crossing the wire. */
  readonly saving: boolean
  /** Whether the Host refused the last save. */
  readonly failed: boolean
  /** The edited roster. */
  readonly rows: readonly RosterEntry[]
  /** Chosen leader name, empty when none. */
  readonly leader: string
  /** Participating agents, leader included; 0 means all. */
  readonly activeAgents: number
  /** Chosen execution order. */
  readonly order: 'parallel' | 'sequence'
  /** Model providers the picker offers. */
  readonly providers: readonly RosterProvider[]
  /** Empty when the catalog loaded, otherwise why it is unavailable. */
  readonly catalogError: string
}

/** The registration-side face the card's slot entry injects. */
export interface RosterFace {
  readonly hooks: {
    /** Card snapshot bound by the renderer as useRoster. */
    readonly roster: SnapshotStore<RosterState>
  }
  /** Append one empty specialist. */
  addRow(): void
  /** Remove one specialist by position. */
  removeRow(index: number): void
  /** Stage one field on one specialist. */
  setField(index: number, field: keyof RosterEntry, value: string): void
  /** Stage the leader by roster name; empty means none. */
  setLeader(name: string): void
  /** Stage how many agents participate, leader included; 0 means all. */
  setActiveAgents(count: number): void
  /** Stage the execution order. */
  setOrder(order: 'parallel' | 'sequence'): void
  /** Write the complete roster. */
  save(): void
  /** Drop staged edits. */
  discard(): void
}

/** Read the configured rows, tolerating an absent or malformed section value. */
function rowsOf(value: RosterConfig | undefined): RosterEntry[] {
  const agents = value?.agents
  if (!Array.isArray(agents)) return []
  return agents.map(agent => ({
    name: typeof agent.name === 'string' ? agent.name : '',
    provider: typeof agent.provider === 'string' ? agent.provider : '',
    model: typeof agent.model === 'string' ? agent.model : '',
    specialty: typeof agent.specialty === 'string' ? agent.specialty : '',
    duty: typeof agent.duty === 'string' ? agent.duty : '',
  }))
}

/** Bridge the `team-roster` settings scope and the model catalog onto the card. */
export class RosterController {
  private rows: RosterEntry[]
  private leader = ''
  private activeAgents = 0
  private order: 'parallel' | 'sequence' = 'parallel'
  private dirty = false
  private saving = false
  private failed = false
  private providers: readonly RosterProvider[] = []
  private catalogError = ''
  private readonly store: SnapshotStore<RosterState>
  private readonly off: () => void
  private disposed = false

  /**
   * @param scope - the shared configuration form for the `team-roster` namespace.
   * @param ctx - the plugin's context, whose `remote.session` answers the model catalog.
   */
  constructor(
    private readonly scope: ConfigForm<RosterConfig>,
    private readonly ctx: ClientContext,
  ) {
    this.rows = []
    this.seed(scope.getSnapshot().value)
    this.store = createSnapshotStore(this.projection())
    this.off = scope.subscribe(() => {
      if (!this.dirty) this.seed(this.scope.getSnapshot().value)
      this.store.set(this.projection())
    })
    void this.loadCatalog()
  }

  /** Read the served section into the draft. */
  private seed(value: RosterConfig | undefined): void {
    this.rows = rowsOf(value)
    this.leader = typeof value?.leader === 'string' ? value.leader : ''
    const count = value?.activeAgents
    this.activeAgents = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
    this.order = value?.order === 'sequence' ? 'sequence' : 'parallel'
  }

  /** Ask the Host for the providers and models a picker can offer. */
  private async loadCatalog(): Promise<void> {
    try {
      const response = await this.ctx.remote.session.modelCatalog()
      if (this.disposed) return
      if (!response.ok) {
        this.catalogError = 'model catalog unavailable'
        this.store.set(this.projection())
        return
      }
      this.catalogError = ''
      this.providers = response.value.groups.map(group => ({
        id: group.id,
        name: group.name,
        models: group.models.map(model => ({ id: model.id, name: model.name })),
      }))
      this.store.set(this.projection())
    } catch {
      if (this.disposed) return
      this.catalogError = 'model catalog unavailable'
      this.store.set(this.projection())
    }
  }

  /** Build the complete published state from the scope and the staged rows. */
  private projection(): RosterState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty,
      saving: this.saving,
      failed: this.failed,
      rows: this.rows.map(row => ({ ...row })),
      leader: this.leader,
      activeAgents: this.activeAgents,
      order: this.order,
      providers: this.providers,
      catalogError: this.catalogError,
    }
  }

  /** The first model a provider offers, or the current model when unknown. */
  private firstModel(providerId: string, current = ''): string {
    const provider = this.providers.find(candidate => candidate.id === providerId)
    return provider?.models[0]?.id ?? current
  }

  /** Build the face the card's slot registration injects. */
  inject(): RosterFace {
    return {
      hooks: { roster: this.store },
      addRow: () => {
        const provider = this.providers[0]
        this.rows = [...this.rows, {
          name: '', provider: provider?.id ?? '', model: provider?.models[0]?.id ?? '', specialty: '', duty: '',
        }]
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      removeRow: (index: number) => {
        this.rows = this.rows.filter((_row, at) => at !== index)
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      setField: (index: number, field: keyof RosterEntry, value: string) => {
        this.rows = this.rows.map((row, at) => {
          if (at !== index) return row
          if (field !== 'provider') return { ...row, [field]: value }
          // A provider change starts from a model that provider serves.
          return { ...row, provider: value, model: this.firstModel(value, row.model) }
        })
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      setLeader: (name: string) => {
        this.leader = name
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      setActiveAgents: (count: number) => {
        this.activeAgents = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      setOrder: (order: 'parallel' | 'sequence') => {
        this.order = order
        this.dirty = true
        this.failed = false
        this.store.set(this.projection())
      },
      save: () => { void this.save() },
      discard: () => {
        this.seed(this.scope.getSnapshot().value)
        this.dirty = false
        this.failed = false
        this.store.set(this.projection())
      },
    }
  }

  /** Write the complete `agents` array; the Host reports whether it landed. */
  private async save(): Promise<void> {
    if (this.saving || !this.dirty) return
    this.saving = true
    this.failed = false
    this.store.set(this.projection())
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: ['agents'], value: this.rows.map(row => ({ ...row })) },
      { op: 'set', path: ['leader'], value: this.leader },
      { op: 'set', path: ['activeAgents'], value: this.activeAgents },
      { op: 'set', path: ['order'], value: this.order },
    ]
    try {
      const landed = await this.scope.mutate(ops, this.scope.getSnapshot().revision)
      if (landed) {
        this.dirty = false
        this.failed = false
      } else {
        this.failed = true
      }
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.store.set(this.projection())
    }
  }

  /** Release the scope subscription. */
  dispose(): void {
    this.disposed = true
    this.off()
  }
}
