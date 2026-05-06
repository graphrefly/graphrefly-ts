/**
 * The set of impl arms a scenario parameterizes over. Currently legacy-only
 * — `rustImpl` activates when `@graphrefly/native` publishes (see
 * `./rust.ts` for activation sequence).
 *
 * `describe.each(impls)` consumers should treat the array length as variable;
 * the parity job CI gate widens automatically as Rust milestones close.
 */

import { legacyImpl } from "./legacy.js";
import { rustImpl } from "./rust.js";
import type { Impl } from "./types.js";

export const impls: readonly Impl[] = [legacyImpl, rustImpl].filter((x): x is Impl => x !== null);
