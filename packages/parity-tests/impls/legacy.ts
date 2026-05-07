/**
 * Legacy pure-TS impl arm. Direct workspace consumption — no build artifact
 * dependency, scenarios resolve against `@graphrefly/legacy-pure-ts/src/...`
 * via package resolution.
 */

import {
	combine,
	COMPLETE,
	DATA,
	DIRTY,
	distinctUntilChanged,
	ERROR,
	filter,
	Graph,
	INVALIDATE,
	map,
	merge,
	node,
	pairwise,
	PAUSE,
	reduce,
	RESOLVED,
	RESUME,
	scan,
	TEARDOWN,
	withLatestFrom,
} from "@graphrefly/legacy-pure-ts";
import type { Impl } from "./types.js";

export const legacyImpl: Impl = {
	name: "legacy-pure-ts",
	node,
	DATA,
	RESOLVED,
	DIRTY,
	Graph,
	INVALIDATE,
	PAUSE,
	RESUME,
	COMPLETE,
	ERROR,
	TEARDOWN,
	map,
	filter,
	scan,
	reduce,
	distinctUntilChanged,
	pairwise,
	combine,
	withLatestFrom,
	merge,
};
