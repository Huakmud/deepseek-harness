/**
 * The media model card on the Models settings page: which provider serves
 * describe/generate/transcribe, its endpoint and per-operation models, and its
 * key — which is written through the credentials domain, never into the
 * settings section, so the literal never rides a response.
 */

import { SegmentedControl, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import styles from './MediaCard.module.css'
import type { MediaCardFace, MediaProviderChoice } from './media-card-controller.ts'

/** Props the renderer binds for the media card. */
export type MediaCardProps =
  PropsRuntime<'settings.models.footer'>
  & PropsLocale<'settings.media'>
  & InjectFace<MediaCardFace>

/**
 * Render the media model card.
 * @param props - locale copy, the form snapshot, and its actions.
 * @returns the labelled form.
 */
export function MediaCard(props: MediaCardProps) {
  const { t } = props
  const state = props.useMediaCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  const choiceLabel = (choice: MediaProviderChoice): string => choice === 'gemini' ? t('gemini') : t('openai')
  const providerHint = state.choice === 'gemini' ? t('geminiBaseUrlHint') : t('openaiBaseUrlHint')
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t('title')}</h3>
        <p className={styles.description}>{t('description')}</p>
      </header>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <div className={styles.feature}>
          <span className={styles.label}>{t('provider')}</span>
          <SegmentedControl
            id="plugin-config-media-provider"
            label={t('provider')}
            disabled={disabled || !state.choiceAvailable}
            value={state.choice}
            options={(['openai', 'gemini'] as const).map(choice => ({ value: choice, label: choiceLabel(choice) }))}
            onChange={(value) => { props.setChoice(value) }}
          />
          <p className={styles.hint}>{t('providerHint')}</p>
        </div>
        <SettingsSecretField
          id="plugin-config-media-key"
          label={t('apiKey')}
          hint={t('apiKeyHint')}
          // The credentials domain accepts a key even when the settings document
          // itself is read-only; they are separate stores with separate refusals.
          disabled={!state.apiKeyWritable}
          text={state.apiKey.text}
          configured={state.apiKeyConfigured}
          stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
          onEdit={(text) => { props.edit('apiKey', text) }}
        />
        <SettingsValueField
          id="plugin-config-media-endpoint"
          label={t('baseUrl')}
          hint={providerHint}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('saveFailed')}
          disabled={disabled}
          {...state.baseURL}
          onEdit={(text) => { props.edit('baseURL', text) }}
          onReset={() => { props.resetField('baseURL') }}
        />
        <SettingsValueField
          id="plugin-config-media-describe-model"
          label={t('describeModel')}
          hint={t('describeModelHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('saveFailed')}
          disabled={disabled}
          {...state.describeModel}
          onEdit={(text) => { props.edit('describeModel', text) }}
          onReset={() => { props.resetField('describeModel') }}
        />
        <SettingsValueField
          id="plugin-config-media-generate-model"
          label={t('generateModel')}
          hint={t('generateModelHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('saveFailed')}
          disabled={disabled}
          {...state.generateModel}
          onEdit={(text) => { props.edit('generateModel', text) }}
          onReset={() => { props.resetField('generateModel') }}
        />
        <SettingsValueField
          id="plugin-config-media-transcribe-model"
          label={t('transcribeModel')}
          hint={state.choice === 'openai' ? t('transcribeModelUnsupported') : t('transcribeModelHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('saveFailed')}
          disabled={disabled}
          {...state.transcribeModel}
          onEdit={(text) => { props.edit('transcribeModel', text) }}
          onReset={() => { props.resetField('transcribeModel') }}
        />
      </SettingsForm>
    </section>
  )
}
