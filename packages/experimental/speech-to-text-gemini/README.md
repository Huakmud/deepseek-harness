---
description: "Cloud Gemini speech transcription for the experimental speech service."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-speech-to-text-gemini

English | [中文](README.zh.md)

## Summary

This optional provider registers one recognizer with `ctx.speechToText` that forwards a finished recording to the Gemini API and returns its text. It owns no microphone, no download, and no local model: the voice-input toolbar still records, and a transcript still lands in the draft before you send it.

It reads the same `GEMINI_API_KEY` credential the media providers read, so one Gemini key serves image description, image generation, audio transcription, and voice input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the [voice input bundle](../voice-input-bundle/README.md) from Plugins, then open its details and select **Gemini** as the recognizer. Recording then costs one Gemini request per press and installs nothing locally.

The first press asks for browser microphone access. Stopping the recording sends the captured audio to Gemini, and the returned text is inserted into the composer draft for review before you send it.

Configure the endpoint, model, and credential reference in the `speech-to-text-gemini` row of `cordis.patch.yml`:

```yaml
- id: speech-to-text-gemini
  name: '@deepseek-ai/dsh-experimental-speech-to-text-gemini'
  config:
    baseURL: https://generativelanguage.googleapis.com/v1beta
    apiKeyEnv: GEMINI_API_KEY
    model: gemini-3.8-flash
```

`baseURL` and `model` are required in effect: an empty `model` fails at the first recording rather than silently transcribing with an unintended model. `apiKeyEnv` names a credential reference, so it resolves through the `credentials` service when one is mounted and through the launch environment otherwise.

Any multimodal Gemini model transcribes audio. `gemini-3.5-transcribe` returns an empty response rather than text and must not be selected.

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider registers `info` with `location: 'cloud'` and no `preparation`, which the registry reports as `phase: 'ready'`. That omission is what lets the toolbar record immediately instead of offering a download dialog.

Each recording arrives as canonical 16 kHz mono PCM16 WAV, which Gemini accepts directly, so the bytes are forwarded unchanged as one `inlineData` part beside a short instruction. Transcription is therefore one `POST /models/{model}:generateContent` request.

A credential rides that request, so `redirect` is `error`: following a redirect would forward the key to the new origin. The upstream status and a bounded body excerpt become the reported failure, and no partial transcript is ever returned.

<a id="further-exploration"></a>
## Further Exploration

- [Experimental speech recognition](../speech-to-text/README.md) — the registry this provider registers with.
- [Voice input bundle](../voice-input-bundle/README.md) — the composition that mounts it.
- [Local SenseVoice provider](../speech-to-text-sensevoice/README.md) — the offline alternative.

<a id="model-experience"></a>
## Model Experience

None. Transcription runs before a prompt is sent, so no model request, token, or KV-cache entry observes this package. The transcript enters the conversation only as ordinary draft text the user can edit.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Audio leaves the machine. Selecting this provider trades the offline guarantee of the SenseVoice provider for no download and better multilingual coverage.
- Long recordings are sent whole in one request, bounded by the registry's recording limit rather than by this provider.
- Language hints are advisory prompts, not an API parameter, so a wrong hint degrades accuracy rather than failing the request.

<a id="dev-note"></a>
## Dev Note

The provider reads its configuration on every call, so changing the model or endpoint through the profile takes effect on the next recording without a restart.
