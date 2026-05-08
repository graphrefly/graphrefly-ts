/**
 * Public types for `topologyView` (D3 — Three-layer view).
 *
 * /qa F-17 (2026-04-30): the canonical type definitions live in
 * `src/extra/render/layout-types.ts` so the SVG renderer there can consume
 * them without inverting the layering (extra/ → patterns/). This module
 * re-exports them for the pattern's public surface.
 *
 * @module
 */

export type {
	LayoutBox,
	LayoutEdge,
	LayoutFn,
	LayoutFrame,
} from "../../extra/render/layout-types.js";
