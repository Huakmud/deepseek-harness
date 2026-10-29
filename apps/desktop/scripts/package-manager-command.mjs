/**
 * Spawn the package manager that started this process.
 *
 * `npm_execpath` is the pnpm JavaScript entry when pnpm runs from a normal
 * install, but the standalone Windows distribution exposes a native executable
 * that Node cannot load as a module. Choosing the wrong one fails before any
 * work starts, so the shape of the value decides which form to spawn.
 */

import { spawn } from 'node:child_process'

/**
 * Describe how to run the invoking package manager.
 * @param {NodeJS.ProcessEnv} environment - Environment carrying `npm_execpath`.
 * @returns {{ command: string, prefix: readonly string[] }} The executable and its leading arguments.
 */
export function packageManagerCommand(environment = process.env) {
  const entry = environment.npm_execpath
  if (entry === undefined || entry === '') {
    throw new Error('desktop package: invoke this script through a pnpm package command')
  }
  // A native package manager is its own executable; a JavaScript entry needs Node.
  if (/\.(?:exe|cmd|bat)$/iu.test(entry)) return { command: entry, prefix: [] }
  return { command: process.execPath, prefix: [entry] }
}

/**
 * Run the invoking package manager and wait for it to exit.
 * @param {readonly string[]} args - Package manager arguments.
 * @param {{ env?: NodeJS.ProcessEnv, cwd: string, run?: { run: Function } | undefined }} options - Working directory, environment, and optional supervisor.
 * @returns {Promise<void>} Resolves when the command exits successfully.
 */
export async function runPackageManager(args, options) {
  const { command, prefix } = packageManagerCommand()
  const env = options.env ?? process.env
  if (options.run !== undefined) {
    await options.run.run(args.join(' '), command, [...prefix, ...args], { cwd: options.cwd, env })
    return
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...prefix, ...args], { cwd: options.cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}
