# Storage WAL parity scenarios

**Source:** [SESSION-DS-14-storage-wal-replay.md](../../../../archive/docs/SESSION-DS-14-storage-wal-replay.md) (locked 2026-05-08), Phase 14.6 in [docs/implementation-plan.md](../../../../docs/implementation-plan.md#phase-146--storage-wal-replay-implementation-ds-14-storage-substrate).

## Activation schedule

| Milestone | Impls | Status |
|---|---|---|
| Phase 14.6 land (this session) | `pure-ts` only | ✅ active |
| M4 close (`graphrefly-storage` Rust crate) | + `rust` | gates main-branch merges per L2 lock |

Until `@graphrefly/native` exposes `attachSnapshotStorage` + `restoreSnapshot`, these scenarios import from `@graphrefly/pure-ts` directly. When the rust arm activates, lift them onto the cross-impl `Impl` interface (`packages/parity-tests/impls/types.ts`) and convert to `describe.each(impls)`.

## What's covered (TS-side, locked contract)

- `WALFrame<T>` byte-format roundtrip (Q1 lock)
- `frame_seq` vs `change.seq` distinction (Q1)
- Cross-scope replay ordering `spec → data → ownership` (Q2)
- Within-lifecycle `frame_seq` ASC ordering (Q2)
- Recovery: latest baseline + `frame_seq > baseline.seq` filter (Q3)
- Codec contract: `jsonCodec` default; tier-level uniformity (Q4)
- `BaseStorageTier.listByPrefix` lazy iteration; lex-ASC = numeric ASC keys (Q5)
- INVALIDATE persistence as `node.invalidate` frame (Q7 §8.7.6)
- `restoreSnapshot({ mode: "diff", source, lifecycle?, targetSeq?, onTornWrite? })` API surface (Q9)

## Q1 deviation note

Pure-TS impl uses **SHA-256 hex** for the checksum field; the locked design specified BLAKE3 32-byte. Tracked in the session header as a deliberate dep-cost tradeoff. M4 Rust impl matches via the `sha2` + `hex` crates. BLAKE3 returns when post-1.0 DagCbor IPLD content-addressing lands.
