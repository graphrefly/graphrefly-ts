/**
 * Legacy pure-TS impl arm. Direct workspace consumption — no build artifact
 * dependency, scenarios resolve against `@graphrefly/legacy-pure-ts/src/...`
 * via package resolution.
 */

import {
	COMPLETE,
	DATA,
	ERROR,
	Graph,
	INVALIDATE,
	node,
	PAUSE,
	RESUME,
	TEARDOWN,
} from "@graphrefly/legacy-pure-ts";
import type { Impl } from "./types.js";

export const legacyImpl: Impl = {
	name: "legacy-pure-ts",
	node,
	DATA,
	Graph,
	INVALIDATE,
	PAUSE,
	RESUME,
	COMPLETE,
	ERROR,
	TEARDOWN,
};
