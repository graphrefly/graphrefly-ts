/**
 * Standalone operators over {@link ReactiveLogBundle} (Phase 14.4).
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import type { ReactiveLogBundle } from "./reactive-log.js";

/**
 * Standalone incremental scan over a reactive log. Equivalent to
 * `log.scan(initial, step)` — provided for pipe-builder composition.
 *
 * O(1) per append; full rescan on trim/clear.
 */
export function scanLog<T, TAcc>(
	log: ReactiveLogBundle<T>,
	initial: TAcc,
	step: (acc: TAcc, value: T) => TAcc,
): Node<TAcc> {
	return log.scan(initial, step);
}
