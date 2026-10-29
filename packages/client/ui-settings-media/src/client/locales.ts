/**
 * Locale bundles for the media model card on the Models settings page.
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the card renders. */
export type MediaSettingsLocaleKey =
  | 'title' | 'description' | 'provider' | 'providerHint'
  | 'openai' | 'gemini' | 'none'
  | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'baseUrl' | 'baseUrlHint' | 'openaiBaseUrlHint' | 'geminiBaseUrlHint'
  | 'describeModel' | 'describeModelHint'
  | 'generateModel' | 'generateModelHint'
  | 'transcribeModel' | 'transcribeModelHint' | 'transcribeModelUnsupported'
  | 'capabilityDescribe' | 'capabilityGenerate' | 'capabilityTranscribe'
  | 'capabilities' | 'capabilitiesNone'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'

/** English copy. */
export const en: Record<MediaSettingsLocaleKey, string> = {
  title: 'Media models',
  description: 'Let a model that cannot see or draw pictures use a second API for images and audio.',
  provider: 'Media provider',
  providerHint: 'Auxiliary route used by the media tools. Auto picks the only usable provider; pin one when several are configured.',
  openai: 'OpenAI-compatible',
  gemini: 'Google Gemini',
  none: 'Auto (the only configured provider)',
  apiKey: 'API key',
  apiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  apiKeySet: 'A key is configured.',
  apiKeyUnset: 'No key is configured, so this provider cannot be used.',
  baseUrl: 'API base URL',
  baseUrlHint: 'Include the API version prefix. Leave blank to use the default.',
  openaiBaseUrlHint: 'Include the version prefix, such as https://api.openai.com/v1. The provider appends /chat/completions, /images/generations, or /audio/transcriptions. Leave blank to restore the default.',
  geminiBaseUrlHint: 'Include the API version prefix, such as https://generativelanguage.googleapis.com/v1beta. The provider appends /models/{model}:generateContent. Leave blank to restore the default.',
  describeModel: 'Image description model',
  describeModelHint: 'Vision model that reads an attached picture and describes it. Leave blank to disable image description.',
  generateModel: 'Image generation model',
  generateModelHint: 'Model that draws a new image. Leave blank to disable image generation.',
  transcribeModel: 'Audio transcription model',
  transcribeModelHint: 'Model that turns a recording into text. Leave blank to disable audio transcription.',
  transcribeModelUnsupported: 'This provider has no audio endpoint on the OpenAI-compatible surface unless a gateway supplies one; leave blank if it does.',
  capabilities: 'Available now',
  capabilitiesNone: 'No usable provider yet: fill in a model and an API key.',
  capabilityDescribe: 'Describe images',
  capabilityGenerate: 'Generate images',
  capabilityTranscribe: 'Transcribe audio',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
}

/** Simplified Chinese copy. */
export const zh: Record<MediaSettingsLocaleKey, string> = {
  title: '媒体模型',
  description: '让无法看图或画图的模型通过第二个 API 处理图片和音频。',
  provider: '媒体提供方',
  providerHint: '媒体工具使用的辅助线路。留空表示自动选择唯一可用的提供方；配置了多个时请指定一个。',
  openai: 'OpenAI 兼容接口',
  gemini: 'Google Gemini',
  none: '自动（唯一已配置的提供方）',
  apiKey: 'API Key',
  apiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  apiKeySet: '已配置密钥。',
  apiKeyUnset: '未配置密钥，该提供方无法使用。',
  baseUrl: 'API 基础地址',
  baseUrlHint: '填写含 API 版本前缀的地址。留空恢复默认。',
  openaiBaseUrlHint: '填写含版本前缀的地址，例如 https://api.openai.com/v1；程序追加 /chat/completions、/images/generations 或 /audio/transcriptions，留空恢复默认。',
  geminiBaseUrlHint: '填写含版本前缀的地址，例如 https://generativelanguage.googleapis.com/v1beta；程序追加 /models/{model}:generateContent，留空恢复默认。',
  describeModel: '读图模型',
  describeModelHint: '读取并描述所附图片的视觉模型。留空表示关闭读图能力。',
  generateModel: '画图模型',
  generateModelHint: '生成新图片的模型。留空表示关闭画图能力。',
  transcribeModel: '转写模型',
  transcribeModelHint: '把录音转成文字的模型。留空表示关闭音频转写。',
  transcribeModelUnsupported: 'OpenAI 兼容接口本身不提供音频端点，除非所在网关另行提供；没有就留空。',
  capabilities: '当前可用',
  capabilitiesNone: '暂无可用能力：请填写模型并配置 API Key。',
  capabilityDescribe: '读图',
  capabilityGenerate: '画图',
  capabilityTranscribe: '音频转写',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
}

/**
 * The form frame's copy, read from this card's dictionary.
 * @param t - the card's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: MediaSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
