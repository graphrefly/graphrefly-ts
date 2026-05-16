# Cross-track ledger — presentation ↔ Rust-port coordination

> **Single source of truth** for any change that couples the two parallel tracks:
> the **presentation track** (`@graphrefly/graphrefly`, this repo, `src/`) and the
> **Rust-port track** (`@graphrefly/native`, `~/src/graphrefly-rs`).
>
> These tracks are decoupled *by design* (D206: `@graphrefly/pure-ts` is the sole
> working sync substrate; presentation never consumes native). The **only** coupling
> surface is the `Impl` contract at `packages/parity-tests/impls/types.ts`. This doc
> exists so that coupling stays **explicit and logged**, never implicit.
>
> Item-level optimization state still lives in [`docs/optimizations.md`](optimizations.md);
> this doc is *only* the cross-track coordination ledger. Do not lump general
> optimization items here.

---

## When to add a row here

Add a row to the relevant section below **before** landing the change, whenever:

1. **`Impl`-contract widening** — presentation starts importing a NEW symbol from a
   `@graphrefly/pure-ts` public barrel (`core`, `extra`, …). This widens the contract
   `@graphrefly/native` must satisfy → it is a public-API decision.
2. **Substrate behavior change with parity implications** — a bug fix / semantic
   change to substrate code (`packages/pure-ts/src/`) that the `@graphrefly/native`
   parity arm must mirror (even if no new symbol).
3. **Substrate-boundary rename / removal** — any pre-1.0 rename or removal at the
   `pure-ts` public surface (collision resolution, barrel reshape, etc.).
4. **Anything else that forces both tracks to move together.**

Never widen `Impl` or change substrate behavior implicitly. The Rust-port track
consumes this ledger via `~/src/graphrefly-rs/docs/migration-status.md` § "NEXT
BATCH" (the **N1 → item-8** handoff is the reference pattern).

## When to close / archive a row

Mark a row ✅ when the native side has shipped the symbol/behavior AND the parity
arm is tight (`packages/parity-tests/impls/rust.ts` casts `as Impl`, not
`as unknown as Impl`). On the next docs sweep, move closed rows to
`archive/optimizations/resolved-decisions.jsonl` per
[`docs/docs-guidance.md`](docs-guidance.md) § "Optimization decision log".

---

## §1 — `Impl`-contract widening ledger

| Date | Symbols | Presentation consumer(s) | TS side (`types.ts` + `pure-ts.ts`) | Native side (`@graphrefly/native` + `rust.ts` tight cast) | Status |
|---|---|---|---|---|---|
| 2026-05-15 (N1) | `RingBuffer`, `ResettableTimer`, `describeNode`, `sha256Hex`, `sourceOpts` — `wrapSubscribeHook` dropped by Group-3 Edge #2 → N1 is **5, not 6** | `src/utils/resilience/*`, `src/base/sources/async.ts`, `src/base/io/*`, `src/utils/ai/adapters/*` | ✅ `7437fb7` (Impl-contract pin) | ✅ Option C: rs `5b5c041`, ts `d441648` (`rust.ts` tight `as Impl`); `@graphrefly/native@0.0.1` published | ✅ **RESOLVED** (archive on next sweep) |

## §2 — Substrate behavior / parity-coupled changes (no new symbol)

| Date | Change | Substrate site | Parity implication | Native-side status | Status |
|---|---|---|---|---|---|
| 2026-05-16 | **memo:Re P0 — `appendLogStorage` `flush()` durability fix.** No-`debounceMs` tier schedules a microtask-chained `doFlush` per `appendEntries` wave; `flush()` early-returned when `pending` was empty and resolved before the in-flight `flushChain` drained → only wave #1 durable (silent data loss). Fix: `flushNow()` returns the outstanding `flushChain` when `pending` is empty. **No new symbol; no API/signature change** — `flush()` now honors its existing durability contract. | `packages/pure-ts/src/extra/storage/tiers.ts` `appendLogStorage.flushNow` | Rust `@graphrefly/native` `appendLogStorage`/WAL-flush equivalent must mirror **two** semantics, not just durability: **(1) durability-on-resolve** — `flush()` (and tier shutdown/`destroyAsync` drain) awaits all in-flight chained/buffered writes (TS bug was a chained-microtask artifact; Rust must not have the analogous "flush returns before queued writes commit" gap); **(2) error-surfacing (QA/D3)** — post-fix TS `flush()` *rejects* if a prior in-flight chained write failed (was: silently resolved); the Rust arm must make the same reject-vs-swallow decision and test the rejection path, not only the happy path. **(3) F9 debounced-flush driver (QA, now FIXED — was a divergence-avoidance note, now a positive parity obligation):** the `appendLogStorage` **tier** still has no internal timer, but `attachStorage` now drives each debounced tier's `flush()` from a **reactive timer source** (`fromTimer(d,{period:d})`) + a final drain on detach/teardown. The Rust `@graphrefly/native` reactive-log `attach_storage` equivalent must mirror this: drive debounced-tier flush from the **Rust reactive timer source** (NOT an internal tier timer, NOT a raw OS timer in the reactive layer) + drain on teardown. **(4) `rollback()` strong semantic (QA, now FIXED):** TS added a `rollbackEpoch` generation token — `rollback()` bumps it + clears `pending`; `doFlush` captures the epoch at schedule time and skips at entry if it advanced, so in-flight chained writes scheduled pre-rollback are discarded (best-effort: a `backend.write` already past the check can't be un-sent). The Rust arm must mirror the epoch/abort semantic (not just `pending`-clear). Verify all four in the M4/M5 storage parity arm. | ⏳ Open — handed off to `~/src/graphrefly-rs/docs/migration-status.md` (storage parity follow-up). Not blocking the TS fix. | TS ✅ landed 2026-05-16 (durability + reject + F9 driver + rollback epoch, uncommitted); native verify ⏳ |
| 2026-05-16 | **memo:Re P1 — `appendLogStorage` `mode: "append" \| "overwrite"` option.** Additive `AppendLogStorageOptions.mode` (default `"append"` = existing read-merge accumulate; `"overwrite"` = snapshot, replace key per flush, skip backend read). `Impl` carries `appendLogTier(backend, opts?: TierOpts)` (`types.ts:504`) so `TierOpts` is parity-coupled. | `packages/pure-ts/src/extra/storage/tiers.ts` `AppendLogStorageOptions` / `doFlush` | Rust `@graphrefly/native` `appendLogTier` must add `mode` to its `TierOpts` and implement the overwrite branch (no read-merge). **QA hardening (2026-05-16):** the tier now also **exposes `.mode`** on `AppendLogStorageTier`, and `reactiveLog.attachStorage` **throws** if handed an `"overwrite"` tier (delta-shipping into overwrite silently truncates — the memo:Re-P0 failure class). Native parity: the native append-log tier must expose `mode` and the native `attach_storage` must reject an overwrite tier with an equivalent error. Add both an `overwrite`-flush scenario AND an `attachStorage(overwrite)`-rejects scenario to the storage parity arm. | ⏳ Open — handed to `~/src/graphrefly-rs/docs/migration-status.md` (storage parity follow-up). | TS ✅ landed 2026-05-16 (uncommitted, QA-hardened); native ⏳ |
| 2026-05-16 | **memo:Re P2 — `ReactiveLogBundle.attach(upstream, { skipCachedReplay? })`.** Additive optional 2nd arg; drops the subscribe-handshake replay (cached value OR full replay buffer), keeps live emissions. `Impl` carries `attach(upstream): Promise<UnsubFn>` (`types.ts:381`) so the signature is parity-coupled. | `packages/pure-ts/src/extra/data-structures/reactive-log.ts` `attach` | Rust `@graphrefly/native` `attach` must accept `skipCachedReplay` and suppress the on-subscribe replay (NOT subsequent live emits). **QA hardening (2026-05-16):** the suppression is NOT a synchronous-window flag — `defaultOnSubscribe`'s replay is `downWithBatch`-split by tier (`[START]` phase-1 sync, replay `[DATA…]` phase-2 sync-or-`batch()`-deferred). TS now skips the **first DATA-bearing delivery**, gated on `upstream.cache !== undefined` (so a cold upstream's first live emit is NOT dropped), robust to batch-deferral. Native must replicate this exact contract (gate on cache-present; drop the one replay slice incl. a multi-value replay-buffer; survive being called inside a batch). Parity scenarios: `skipCachedReplay` with (a) cached single value, (b) `replayBuffer:N`, (c) cold upstream, (d) `attach` inside `batch()`. | ⏳ Open — handed to `~/src/graphrefly-rs/docs/migration-status.md`. | TS ✅ landed 2026-05-16 (uncommitted, QA-hardened); native ⏳ |

---

## Related

- `packages/parity-tests/impls/types.ts` — the `Impl` contract itself (the coupling surface).
- `~/src/graphrefly-rs/docs/migration-status.md` § "NEXT BATCH" — where the porting track picks up handoffs.
- [`docs/rust-port-decisions.md`](rust-port-decisions.md) — D196 (napi widening = parity-scenario gated), D206 (native substrate contract).
- [`docs/optimizations.md`](optimizations.md) — item-level optimization state (not cross-track coordination).
