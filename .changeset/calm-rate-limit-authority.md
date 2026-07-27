---
"@graphrefly/ts": minor
---

Add the B111.1-B111.7 TypeScript-first keyed externally authoritative rate-limit
surface, package documentation, and runnable host-integration example. D651
places the focused request/outcome/admission domain, bounded correlation gate,
three optional host-side reference transitions, and explicitly local fixed
window helper at `@graphrefly/ts/rate-limit`; the package root and orchestration
surface remain unchanged, while `KeyedRateLimitAuthority` and its bounded
adapter remain under `@graphrefly/ts/adapters`.

The example documents receipt-first replay/conflict ordering, host-owned exact
state and atomic outcome-receipt persistence, externally supplied time,
Fixed Window, exact bounded Sliding Window, integer-rational Token Bucket,
custom authority, admission-only protected effects, and the separate
application-owned protected-effect receipt boundary. This deterministic
contract-model evidence is not a real database, fsync, crash-recovery, or
parallel-process certification, and the TS-first application-infrastructure
surface is not wave-protocol, conformance, Rust, or Python parity work.
