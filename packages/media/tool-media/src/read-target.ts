/**
 * Filesystem acquisition for the media tools: resolve one model-supplied path
 * in the Session's current directory and require a regular file before any
 * bytes are read, so a refusal never follows a partial read.
 *
 * The filesystem is an optional collaborator: a deployment can keep the media
 * tools usable for attachments alone, and only a path request needs the seam.
 * A missing seam is therefore a plain precondition failure, as with a missing
 * attachment store — not one of {@link FsError}'s file-level codes.
 *
 * @module @deepseek-ai/dsh-tool-media/read-target
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - plugin context providing filesystem resolution and observation events.
 * @param exec - current tool execution, including the owning Agent and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its display path for messages.
 * @throws when the deployment has no filesystem seam, or when the path is
 *   absent or not a regular file.
 */
export async function resolveMediaReadTarget(
  ctx: Context,
  exec: Readonly<ToolExecution>,
  requestedPath: string,
): Promise<{ target: FsTarget; displayPath: string }> {
  const fs = requiredFs(ctx, requestedPath)
  const workingDirectory = ctx.get('workingDirectory')
  const cwd = exec.agent === undefined || workingDirectory === undefined
    ? undefined
    : await workingDirectory.ensure(exec.agent, exec.signal)
  const target = await fs.resolve(requestedPath, {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  })
  const info = await fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, displayPath: fs.processPath(target) }
}

/**
 * Read one path-sourced file through the filesystem seam.
 * @param ctx - plugin context providing the filesystem seam.
 * @param target - the resolved target to read.
 * @param signal - cancellation forwarded to the read.
 * @param limit - maximum bytes to read before the read fails.
 * @returns the file's bytes.
 * @throws when the deployment has no filesystem seam.
 */
export async function readMediaBytes(
  ctx: Context,
  target: FsTarget,
  signal: AbortSignal | undefined,
  limit: number,
): Promise<Uint8Array> {
  return await requiredFs(ctx, target.displayPath).readBytes(target, signal, limit)
}

/** The filesystem seam, or the precondition failure naming the path request that needed it. */
function requiredFs(ctx: Context, requestedPath: string) {
  const fs = ctx.get('fs')
  if (fs === undefined) {
    throw new Error(
      `cannot read "${requestedPath}": this deployment has no filesystem backend; pass the file as an attachment id instead`,
    )
  }
  return fs
}
