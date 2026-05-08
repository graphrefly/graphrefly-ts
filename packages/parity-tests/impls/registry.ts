/**
 * The set of impl arms a scenario parameterizes over. Currently pure-ts-only
 * — `rustImpl` activates when `@graphrefly/native` publishes (see
 * `./rust.ts` for activation sequence). Future: `wasmImpl` joins as the
 * third arm when `@graphrefly/wasm` lands (PART 13 Deferred 3 of
 * `archive/docs/SESSION-rust-port-architecture.md`).
 *
 * `describe.each(impls)` consumers should treat the array length as variable;
 * the parity job CI gate widens automatically as Rust milestones close.
 */

import { pureTsImpl } from "./pure-ts.js";
import { rustImpl } from "./rust.js";
import type { Impl } from "./types.js";

export const impls: readonly Impl[] = [pureTsImpl, rustImpl].filter((x): x is Impl => x !== null);
