/**
 * Render barrel — re-exports from root src/base/render/ (presentation layer).
 *
 * The render functions were moved to root src/base/render/ during cleave A2
 * (2026-05-14) since they are presentation, not substrate.
 *
 * This stub preserves the old import path so substrate tests that haven't
 * been migrated to root src/__tests__/ yet continue to work.
 *
 * Tests importing from here should be migrated to src/__tests__/ with imports
 * updated to use the presentation package path.
 */
export * from "../../../../../src/base/render/index.js";
