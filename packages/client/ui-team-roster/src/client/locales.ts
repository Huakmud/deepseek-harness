/** Locale-owned copy for the Team Roster settings card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.teamRoster'

/** Chinese dictionary and key source. */
export const zh = {
  title: '团队名册',
  description: '为主代理配置可按需委派的专家：每人一个提供方、一个模型，以及自己的职责（例如只跑终端命令、只改文件）。',
  summary: '主代理按需把独立的工作分派给不同模型的专家，每人职责不同。',
  addAgent: '添加专家',
  remove: '移除',
  name: '名称',
  provider: '提供方',
  model: '模型',
  specialty: '擅长',
  duty: '职责',
  dutyHint: '例如：只运行终端命令；只编辑文件；只做代码审查。',
  leader: '队长',
  noLeader: '不指定队长',
  leaderHint: '队长在讨论中先发言，并在提示中被点名为协调者。',
  activeAgents: '参与人数',
  activeAgentsHint: '0 表示全部专家参与；队长计入这个人数，并且排在最前。',
  order: '执行方式',
  orderParallel: '同时进行（并行）',
  orderSequence: '一个接一个（顺序）',
  sequenceHint: '顺序执行时，每位专家都会收到前面专家的报告。',
  empty: '还没有专家。至少添加两位才能使用讨论工具。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  catalogFailed: '无法读取模型列表，请先在模型设置中配置提供方。',
} as const

/** Keys accepted by the roster card translator. */
export type TeamRosterKey = keyof typeof zh

/** English copy. */
export const en: Record<TeamRosterKey, string> = {
  title: 'Team roster',
  description: 'Configure specialists the Lead can delegate to on demand: one provider, one model, and one duty each (for example shell commands only, or file edits only).',
  summary: 'The Lead delegates independent work to specialists on different models, each with its own duty.',
  addAgent: 'Add specialist',
  remove: 'Remove',
  name: 'Name',
  provider: 'Provider',
  model: 'Model',
  specialty: 'Best at',
  duty: 'Duty',
  dutyHint: 'For example: run shell commands only; edit files only; review code only.',
  leader: 'Leader',
  noLeader: 'No leader',
  leaderHint: 'The leader speaks first in a discussion and is named as coordinator in every prompt.',
  activeAgents: 'Agents at work',
  activeAgentsHint: '0 uses every roster agent. The leader counts toward this number and always comes first.',
  order: 'Work order',
  orderParallel: 'All at once (parallel)',
  orderSequence: 'One after another (sequential)',
  sequenceHint: 'Sequential runs hand each specialist the earlier reports.',
  empty: 'No specialists yet. Add at least two to use the discussion tool.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  catalogFailed: 'Could not read the model catalog. Configure a provider in Models settings first.',
}
