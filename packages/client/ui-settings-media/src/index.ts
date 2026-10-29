/**
 * Media model card, node half. The empty apply exists so the plugin appears in
 * the host cordis.yml / Loader; the browser half owns the card through
 * exports["./client"], discovered from the package.json dsh.client declaration.
 * The `media`, `media-openai`, and `media-gemini` namespaces the card edits are
 * registered by their plugins, so this package registers no namespace of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
