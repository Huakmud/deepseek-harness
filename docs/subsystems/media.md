# Media Access

English | [中文](media.zh.md)

The media access seam is a [capability seam](../glossary.md#capability-seam) that spans **three operations** — describe an image, generate an image, transcribe audio — on one `ctx.media` service, split across packages: Service Definition ([dsh-media](../../packages/media/media), `ctx.media` + the provider registry), Service Providers ([dsh-media-openai](../../packages/media/media-openai), [dsh-media-gemini](../../packages/media/media-gemini)), and Consumer ([dsh-tool-media](../../packages/media/tool-media), the three tool schemas). Media is **one optional capability**, not part of the agent-loop spine. Swapping a provider does not change how the model asks for a description, a drawing, or a transcript.

The reason this seam exists at all: a deployment may run a model that reads text only, while the user still attaches photos and asks for pictures. Rather than route those requests away, the harness delegates them to a second API and returns an ordinary tool result.

Source: [`packages/media/media/src/types.ts`](../../packages/media/media/src/types.ts)

## The delegation model

The conversation's model keeps its own route. It gains no image-input capability, no vision endpoint, and no second system prompt. What it gains is a tool call: `media_describe_image` for a picture it cannot see, `media_generate_image` for one it cannot draw, `media_transcribe_audio` for a recording it cannot decode.

A different model — selected by the deployment, on a different vendor if the deployment wants — does the work, and the answer returns as a tool result. Every result names its producer and states that the calling model did not perceive the source itself. That sentence is not decoration: without it a model that receives a description tends to answer as though it had looked at the image, which then makes later questions about the picture unanswerable.

Generated images differ from the other two operations. The bytes are committed to the durable attachment store and returned as an ordinary `image` block, so the next turn can reference the picture the same way it references any other attachment. No new Session event type is involved, and no format version changes.

## Why one capability has three operations

The three operations share one registry, one selection policy, and one error vocabulary, which is why they are one `ctx.media` and not three services. They do not share a request schema — describing takes an image, generating takes a prompt, transcribing takes audio — so the service exposes parallel `describe`/`generate`/`transcribe` methods rather than one generic call. That parallelism is intentional.

Providers register **capabilities**, not tools. The model-facing names, schemas, prompt guidance, and presentation all live in the single `dsh-tool-media` consumer. A provider package never sees a tool schema, and a consumer never sees a wire format.

## Selecting a provider

`resolve(capability)` is the only selection point, and it runs once per call.

When the composition sets `mediaProvider`, that provider serves every operation it advertises: a request for an operation it does not offer fails with `MEDIA_UNSUPPORTED_CAPABILITY`, and the deployment is not quietly routed elsewhere. When it sets none, the seam requires exactly one usable provider per operation. Two candidates is `MEDIA_PROVIDER_AMBIGUOUS` rather than an arbitrary pick, because an arbitrary pick would make the attribution the consumer prints wrong.

A provider that has configured no model is dormant, not invalid. The settings section starts empty, so a fresh deployment must boot with both provider packages mounted and nothing configured; a dormant provider simply advertises nothing, and selection never reaches it.

Reachability and advertised operations are separate axes. `available()` reports whether a provider could serve a request from local configuration — an endpoint that parses — and says nothing about which operations it offers or whether the host answers.

## The two provider adapters

[dsh-media-openai](../../packages/media/media-openai) speaks the OpenAI wire protocol, so it works with OpenAI itself and with any gateway that reproduces those endpoints. Describing posts a chat completion with the image as a data URL; generating posts to the images endpoint and downloads the result when the answer carries a URL rather than bytes; transcribing posts multipart audio.

[dsh-media-gemini](../../packages/media/media-gemini) speaks Gemini's native `generateContent`. Both describing and generating are one request, and a generated image arrives as inline base64 in a response part — no second download, so the credential never leaves the API host. A requested pixel size becomes the nearest of the five supported aspect ratios.

Both adapters refuse redirects on credential-bearing requests: following one would send the credential to whatever host the response named.

## Where the image gate loosens

Two existing surfaces used to refuse an image outright when the routed model could not accept one: `read_image` in [dsh-tool-fs](../../packages/fs/tool-fs) and prompt admission in [dsh-session-controller](../../packages/api/session-controller). Both now check whether a media provider can describe an image before refusing, because refusing would leave the model unable to look at any picture even though the deployment can describe one.

The gate still refuses when neither path exists. It refuses with the same reason code as before, so a client sees no new failure mode — only fewer of them.

## Configuration surfaces

`cordis.yml` carries the provider endpoint, the per-operation models, and the credential reference. All of those fields are volatile, so the Models settings page writes them and the next media call observes the change without remounting a plugin.

The [Media card](../../packages/client/ui-settings-media) is that page's UI. It edits the `media`, `media-openai`, and `media-gemini` namespaces: which provider serves the operations, and each provider's endpoint, models, and credential reference.

`tool-media` is composed per agent preset rather than once per host, because which tools a model sees is a per-agent decision. The host plane therefore disables its `tool-media` row and each preset adds its own.

## Testing this seam

Three kinds of coverage back the seam. Unit suites run each provider against a real loopback server, so the request body, the authentication header, the redirect refusal, and the failure mapping are all observed rather than mocked. A REAL-composition suite boots a test-only `cordis.yml` through the Loader, so the composition a deployment actually uses is what registers the plugins. Recorded-session snapshots pin the model-visible tool results.

## Further reading

- [Capability seams](../glossary.md#capability-seam) — the three-role structure every seam follows.
- [Web access](web.md) — the two-operation seam this design follows.
- [Tool catalog](../tool-catalog.md#deepseek-aidsh-tool-media) — the generated schemas.
