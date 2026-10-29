/**
 * Deterministic media provider for the media snapshot scenarios: an
 * OpenAI-compatible chat endpoint on an OS-assigned loopback port, registered
 * through the real `OpenAiMediaProvider`.
 *
 * The seam, provider selection, request construction, response parsing, and
 * tool-result formatting are therefore all real; only the remote vision API is
 * replaced. The ephemeral port never reaches the Session because the tool
 * result names the provider and model, not the endpoint.
 */
import { OpenAiMediaProvider } from '@deepseek-ai/dsh-media-openai'
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

/** Description this fixture returns for any image. */
const DESCRIPTION = 'A solid red square on a white background, with no text or other detail.'

/** Provider id the fixture registers, matching the shipped adapter. */
const PROVIDER_ID = 'openai-compatible'

/** Cordis plugin name. */
export const name = 'media-fixture-server'

/** Service whose provider registry this fixture populates through the seam. */
export const inject = ['media']

/**
 * Register the real adapter against a loopback endpoint.
 * @param ctx - Cordis context; the effect disposes the server and registration with the fiber.
 */
export async function apply(ctx) {
  const media = ctx.get('media')
  if (media === undefined) throw new Error('media-fixture-server: ctx.media is not mounted')

  const readiness = Promise.withResolvers()
  let baseURL
  let startupError

  // Registration happens inside the effect so disposal removes the provider
  // alongside the listener, leaving no contribution behind.
  await ctx.effect(async () => {
    const unregister = media.registerProvider(new OpenAiMediaProvider({
      id: PROVIDER_ID,
      profile: () => ({ baseURL: baseURL ?? '', describeModel: 'snapshot-vision' }),
      resolveApiKey: async () => 'snapshot-key',
    }))

    await applyLoopbackServerEffect(ctx, {
      label: 'media-fixture-server',
      requestListener: (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: `unexpected request ${String(req.url)}` } }))
          return
        }
        if (req.headers.authorization !== 'Bearer snapshot-key') {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'missing snapshot credential' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: DESCRIPTION } }],
        }))
      },
      onListening: (address) => {
        baseURL = `http://127.0.0.1:${String(address.port)}/v1`
        readiness.resolve(undefined)
      },
      onCleanup: () => {},
    })

    if (startupError !== undefined) throw startupError
    return () => {
      unregister()
    }
  }, 'media-fixture-server')

  await readiness.promise
}
