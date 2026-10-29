/** Types for {@link packageManagerCommand} and {@link runPackageManager}. */

/** How to invoke the package manager that started this process. */
export interface PackageManagerCommand {
  readonly command: string
  readonly prefix: readonly string[]
}

/** Optional supervisor that records one packaging step. */
export interface PackageManagerRunOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly cwd: string
  readonly run?: {
    run: (
      stage: string,
      executable: string,
      args: readonly string[],
      options: { cwd: string, env: NodeJS.ProcessEnv },
    ) => Promise<void>
  } | undefined
}

/**
 * Describe how to run the invoking package manager.
 * @param environment - Environment carrying `npm_execpath`.
 * @returns The executable and its leading arguments.
 */
export function packageManagerCommand(environment?: NodeJS.ProcessEnv): PackageManagerCommand

/**
 * Run the invoking package manager and wait for it to exit.
 * @param args - Package manager arguments.
 * @param options - Working directory, environment, and optional supervisor.
 * @returns Resolves when the command exits successfully.
 */
export function runPackageManager(args: readonly string[], options: PackageManagerRunOptions): Promise<void>
