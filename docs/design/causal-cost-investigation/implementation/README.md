# Private currentness comparison implementation

The user's “继续” following implementation preparation at `60190fcc` authorizes this narrow implementation, differential/runtime qualification, offline checks, QA and commit. Owner work remains `graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`; no new architecture decision or performance-run grant is created.

The only handwritten production change is in `identity.ts`: eligible current/stale records compare transient metadata through the existing canonical codec while omitting the identical canonical-owned occurrence subtree. The exact shape, data descriptors, occurrence identity and numeric watermark are guarded. All other records retain the full comparator. The output records, state replacement, release ordering and authority lifecycle are unchanged. No public exports, cache, registry, persistent state, dependency, wave rule or imperative entry is added.

Canonical ownership comes from receiveOccurrences → canonicalSnapshot → byRevision/pending → same-entry promotion; cloneState retains occurrence identity. Shallow freezing alone is not sufficient. Arbitrary forged state and restored causal Map/Set state are outside this proof.

## Verification boundaries

`scripts/test-causal-currentness-comparison.mjs` loads a private test export through esbuild without changing package exports. It checks 76 comparisons against the original codec, including invalid and unusual shapes, errors, getters, symbols and -0/0. A 15-step transition trace compares full state and ordered outputs against the old comparator, checks digest rejection separately from valid replay conflict, pending promotion and duplicates, and proves the fast path is reached through transitionCausalAuthority.

Seven loaded mutants are checked with helper and transition outcomes recorded separately. Four are killed through the transition trace; three defensive shape/state guard mutants are helper-only evidence, not claimed as Graph mutation kills. The existing `qualify-causal-occurrence.mjs` independently loads real Graph construction/behavior mutants and checks input lanes, authority edges, release admission/currentness/replay, exact outcomes and lifecycle conservation. See `qualification.json` for each actual executed oracle and result.

Two independent static reviewers found no production defect. Test review identified helper/transition conflation and a conflict fixture rejected too early; both were corrected by separate outcomes and explicit digest/replay issue assertions. No lifecycle or restored-state support is inferred from these tests.

This batch makes no measured latency, allocation or RSS improvement claim. Metadata inspection and allocation have their own cost; performance benefit still requires a separately bound comparison run. Graded entry hiding and whole-work acceptance remain unproven. Historical frozen performance inputs, receipts and root workspace changes are preserved.

Gate results and source bindings are recorded in `receipt.json` and `checks.json`. Existing unrelated gate failures are retained verbatim rather than rewriting frozen evidence to make checks green.
