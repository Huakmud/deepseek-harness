/**
 * The Team Roster card on the Plugins page: one row per specialist, each with
 * its own provider, model, specialty, and duty. The card edits the complete
 * `agents` array of the `team-roster` plugin row.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RosterFace, RosterProvider } from './controller.ts'
import styles from './RosterCard.module.css'

/** Props the renderer binds for the roster card. */
export type RosterCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.teamRoster'>
  & InjectFace<RosterFace>

/** One selectable provider. */
interface Option {
  readonly id: string
  readonly label: string
}

/** Providers the picker offers, keeping an unknown configured value selectable. */
function providerOptions(providers: readonly RosterProvider[], current: string): readonly Option[] {
  const options: Option[] = providers.map(provider => ({ id: provider.id, label: provider.name }))
  if (current.length > 0 && !options.some(option => option.id === current)) options.push({ id: current, label: current })
  return options
}

/** Models the picker offers for one provider, keeping an unknown configured value selectable. */
function modelOptions(providers: readonly RosterProvider[], providerId: string, current: string): readonly Option[] {
  const provider = providers.find(candidate => candidate.id === providerId)
  const options: Option[] = (provider?.models ?? []).map(model => ({ id: model.id, label: model.name }))
  if (current.length > 0 && !options.some(option => option.id === current)) options.push({ id: current, label: current })
  return options
}

/**
 * Render the roster editor.
 * @param props - locale copy, the roster snapshot, and its actions.
 * @returns the roster card, or its one-line summary.
 */
export function RosterCard(props: RosterCardProps) {
  const { t } = props
  const state = props.useRoster(snapshot => snapshot)
  if (props.view === 'summary') return <p className={styles.summary}>{t('summary')}</p>
  if (!state.available) return <p role="status" className={styles.notice}>{t('unavailable')}</p>
  const disabled = !state.writable || state.saving
  return (
    <section className={styles.card}>
      <p className={styles.description}>{t('description')}</p>
      {!state.writable ? <p role="status" className={styles.notice}>{t('readOnly')}</p> : null}
      {state.rows.length === 0 ? <p className={styles.empty}>{t('empty')}</p> : null}
      {state.rows.map((row, index) => (
        <fieldset key={String(index)} className={styles.row}>
          <div className={styles.field}>
            <label htmlFor={`team-roster-${String(index)}-name`}>{t('name')}</label>
            <input
              id={`team-roster-${String(index)}-name`}
              value={row.name}
              disabled={disabled}
              onChange={(event) => { props.setField(index, 'name', event.target.value) }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`team-roster-${String(index)}-provider`}>{t('provider')}</label>
            <select
              id={`team-roster-${String(index)}-provider`}
              value={row.provider}
              disabled={disabled}
              onChange={(event) => { props.setField(index, 'provider', event.target.value) }}
            >
              {providerOptions(state.providers, row.provider).map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={`team-roster-${String(index)}-model`}>{t('model')}</label>
            <select
              id={`team-roster-${String(index)}-model`}
              value={row.model}
              disabled={disabled}
              onChange={(event) => { props.setField(index, 'model', event.target.value) }}
            >
              {modelOptions(state.providers, row.provider, row.model).map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={`team-roster-${String(index)}-specialty`}>{t('specialty')}</label>
            <input
              id={`team-roster-${String(index)}-specialty`}
              value={row.specialty}
              disabled={disabled}
              onChange={(event) => { props.setField(index, 'specialty', event.target.value) }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`team-roster-${String(index)}-duty`}>{t('duty')}</label>
            <input
              id={`team-roster-${String(index)}-duty`}
              value={row.duty}
              placeholder={t('dutyHint')}
              disabled={disabled}
              onChange={(event) => { props.setField(index, 'duty', event.target.value) }}
            />
          </div>
          <button
            type="button"
            className={styles.remove}
            disabled={disabled}
            onClick={() => { props.removeRow(index) }}
          >
            {t('remove')}
          </button>
        </fieldset>
      ))}
      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor="team-roster-leader">{t('leader')}</label>
          <select
            id="team-roster-leader"
            value={state.leader}
            disabled={disabled}
            onChange={(event) => { props.setLeader(event.target.value) }}
          >
            <option value="">{t('noLeader')}</option>
            {state.rows.filter(row => row.name.length > 0).map(row => (
              <option key={row.name} value={row.name}>{row.name}</option>
            ))}
          </select>
          <p className={styles.notice}>{t('leaderHint')}</p>
        </div>
        <div className={styles.field}>
          <label htmlFor="team-roster-active">{t('activeAgents')}</label>
          <input
            id="team-roster-active"
            type="number"
            min={0}
            value={String(state.activeAgents)}
            disabled={disabled}
            onChange={(event) => { props.setActiveAgents(Number(event.target.value)) }}
          />
          <p className={styles.notice}>{t('activeAgentsHint')}</p>
        </div>
        <div className={styles.field}>
          <label htmlFor="team-roster-order">{t('order')}</label>
          <select
            id="team-roster-order"
            value={state.order}
            disabled={disabled}
            onChange={(event) => { props.setOrder(event.target.value === 'sequence' ? 'sequence' : 'parallel') }}
          >
            <option value="parallel">{t('orderParallel')}</option>
            <option value="sequence">{t('orderSequence')}</option>
          </select>
          <p className={styles.notice}>{t('sequenceHint')}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={disabled} onClick={() => { props.addRow() }}>{t('addAgent')}</button>
        <button
          type="button"
          disabled={disabled || !state.dirty}
          onClick={() => { props.save() }}
        >
          {state.saving ? t('saving') : t('save')}
        </button>
        <button type="button" disabled={disabled || !state.dirty} onClick={() => { props.discard() }}>
          {t('discard')}
        </button>
      </div>
      {state.failed ? <p role="alert" className={styles.error}>{t('saveFailed')}</p> : null}
      {state.catalogError.length > 0 ? <p role="status" className={styles.notice}>{t('catalogFailed')}</p> : null}
    </section>
  )
}
