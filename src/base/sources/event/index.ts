/**
 * Event sources — cron (presentation) and DOM (browser-only).
 *
 * For the DOM subpath, import from @graphrefly/graphrefly/base/sources/browser.
 * fromTimer is substrate; import from @graphrefly/pure-ts/extra.
 *
 * @module
 */

export * from "./cron.js";
// dom.ts is browser-only; exposed via the browser subpath entry
