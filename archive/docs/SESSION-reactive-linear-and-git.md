---
SESSION: reactive-linear-and-git
DATE: 2026-05-31
TOPIC: Discussion-capture (NOT a decision session). Started as a /research pass on three repos
  surfaced by a Xiaohongshu post (Multica / CubeSandbox / ECC + a "stateless agent service unit"
  essay) and converged into a deep architecture discussion that produced (a) a corrected mental
  model of how locality / parallelism / write-isolation actually work on the GraphReFly substrate,
  and (b) a product vision — "a reactive blend of git and Linear" — for causal-level (not text-level)
  multi-agent collaboration on graph code. Two locked decisions are CHALLENGED by this discussion
  (DS-14.6.A L2 subgraph-level write isolation; D22 "causal" wording) — both flagged, NEITHER
  decided. No D-number minted, no spec amended, no code touched.
REPO: graphrefly-ts (primary)
STATUS: DISCUSSION CAPTURE ONLY — user said "不拍，纯粹讨论". Nothing here is locked. Anything that
  would change a locked decision (L2, D22 wording) or add a primitive requires /design-review →
  explicit approval → decisions.jsonl, per feedback_no_autonomous_decisions +
  feedback_no_implement_without_approval.
SUPERSEDES: none (does NOT supersede DS-14.6.A L2 — it surfaces a tension with it)
---

## CONTEXT

The session began as a `/research` pass triggered by a Xiaohongshu post the user pasted (a blogger's
comment, NOT the user's own view — clarified mid-session). The post named three repos and laid out a
"stateless agent service unit" architecture (decision/execution separation; agent layer / sandbox
layer / session layer / orchestration layer; dynamic disposable containers; context stripped off the
agent as a managed resource).

Research findings (landscape snapshot 2026-05-31, sources in PART 5):
- **Multica** (`multica-ai/multica`, ~1.7K★) — kanban-style "managed agents"; Go backend + Next.js +
  local daemon; 12 CLI runtimes (Claude Code, Codex, OpenClaw, ...); cloud runtime waitlist-only.
  Orchestration = **task dispatch on a board, NOT a dependency DAG** — this confirmed the user's
  "编排不强" read as structural, not a maturity gap.
- **CubeSandbox** (`TencentCloud/CubeSandbox`, ~6K★) — RustVMM/KVM microVM; <60ms cold start, <5MB
  overhead, E2B-SDK compatible. The "disposable cattle" execution layer.
- **ECC** (`affaan-m/ECC`) — "Everything Claude Code"; 60 agents + 232 skills as markdown config on
  top of Claude Code/Codex. The agent-capability-template layer.

Key reframe from the research: **the three repos are not competitors at one layer — they are three
DIFFERENT layers** (agent-config / sandbox / orchestration). GraphReFly sits at the orchestration +
decision layer ("the brain"), is orthogonal to the sandbox layer, and should COMPOSE the others as
node-backends rather than compete. That reframe is the on-ramp; the substance below is the
architecture discussion it triggered.

---

## PART 1: CORRECTED MECHANISM MODEL (mostly converged)

These are clarifications of EXISTING locked floor (D22 / D26 / F-SYNC-CORE / F-DISPATCH-ALL), not new
decisions. They corrected several altitude errors the assistant made mid-session; the user drove each
correction. Captured because the corrected model is load-bearing for the vision in PART 2.

### M1 — Locality is a pool/tool concern, not a node identity; protocol is agnostic to sync/async

The power user registers execution environment per fn at graph-authoring time. Short work →
in-process fn; long/heavy work → sandbox fn. Concretely, the user can register TWO fns for the same
action as two tools — `(ctx) => {/* do A in-process */}` and `(ctx) => {/* do A in a remote box */}` —
and an LLM tool-call picks which one to invoke.

The load-bearing invariant (user's phrasing): **`ctx.down()` is the only continuation point; the
protocol does not care whether the fn was sync or async.** A sync `ctx.down` lands in the current
wave; an async one lands in a later tick (pool already does this). Both sides of the protocol just
"wait for down". Therefore this is NOT new substrate — it is the existing tool registry + pool. The
assistant's earlier "conservatively present the node as async" framing was solving a non-problem.

### M2 — Parallelism unit = dispatcher = graph (D26), NOT the async boundary

The pivotal correction. The user caught a contradiction: if "async wire ⇒ parallel" were the rule,
then a pool turning one in-graph fn from sync to async would split a graph into two parallel halves —
which is nonsense.

Resolution: **parallelism comes from how many dispatchers exist, not from async.** One graph = one
graph-local clock (D26) = one wave-loop = wave is always single-threaded. Two graphs = two clocks =
two wave-loops = can land on two threads.

| | sync edge | in-graph async pool node | cross-graph async wire |
|---|---|---|---|
| crosses a tick? | no | yes | yes |
| dispatchers | 1 | **1** | **2** |
| graph waves run in parallel? | no | **no** (same thread, time-sliced) | **yes** |
| what leaves the main thread | nothing | only the leaf fn's compute (HTTP/heavy) | the whole other engine |

So **async is necessary-but-not-sufficient for parallelism** (a sync edge forces same-thread; async
unblocks the tick) — the sufficient condition is a SECOND dispatcher. An in-graph pool node offloads
the *leaf*'s compute to a pool thread but does NOT fork the graph's reactive propagation; upstream-half
and downstream-half (when causally coupled) are the same dispatcher running different waves,
time-sliced on one thread. The thread hand-off point is the **dispatcher boundary**, not the tick
boundary (an earlier assistant claim, retracted).

> **CORRECTION 2026-05-31b (user):** dispatcher:graph is NOT 1:1. The parallel/dispatcher unit is the
> **causally-connected component** (= the Rust clean-slate `SchedulingGroupId` / union-find
> connectivity auto-detect), NOT the "graph container". A graph container may hold several
> causally-DISJOINT components and be serviced by several dispatchers with no glitch and no race —
> because disjoint components share no causal path (no cross-component diamond, no shared-state
> contention). The earlier "one graph = one dispatcher" framing below (M2 table, M5, M6) is corrected
> by this: read "graph" there as "causally-connected component". This is exactly why V1 (PART 2) and
> the Rust SchedulingGroup partition are THE SAME THING (see PART 4 F1-RESOLVED).

### M3 — A sync edge welds two graphs into one; async wire keeps them as two engines

Worked example (user's): `graph1: A→B→D`, `graph2: C`, async wires `A⇢C` and `C⇢D` (a cross-graph
diamond: fast in-graph path A→B→D vs slow cross-graph path A⇢C⇢D). At time T, thread-1 runs B=f(A@N)
while thread-2 runs D consuming A@N-1 via C — two engines busy simultaneously = pipeline parallelism.
If A→C→D were a SYNC edge, D would have to consume A in the same wave, dragging A,B,C,D into one
dispatcher = one engine = no parallelism. **This is the whole sync/async difference: sync pulls the
consumer into the producer's same tick (weld); async lets it consume one tick late (two engines).**

### M4 — Causal domain spans the wire; "glitch-free" means different things in/across graphs

The user's sharpest correction: **A→(wire)→B means A's cause becomes B's effect, so they ARE one
causal domain — this does not change with sync/async or read-only/writable.** Async buys *temporal*
decoupling (B reacts on its own thread, one tick late), NOT *causal* independence. The assistant had
conflated the two.

Consequence for "glitch-free": in-graph diamonds are **same-tick strongly consistent** (the wave
protocol's RESOLVED merge guarantees D sees one consistent version of A). A cross-graph diamond
(fast path vs slow path through another graph) makes D see "new B + old C(based on older A)" — a
genuine half-new/half-old state — but it is **LEGAL**, because the async wire's contract is exactly
"I feed you a past value, no same-tick consistency promised". So: in-graph = same-tick glitch-free;
cross-graph = async-tolerated delayed consistency (a stale-while-revalidate semantics). They are
different guarantees, both making behavior predictable.

Important corollary the user re-derived: a cross-graph diamond means A still influences D (through C),
so the two graphs are causally COUPLED even though they run in parallel. **Parallel ≠ causally
independent ≠ freely separable.** This is why the fission criterion (PART 2) must walk through wires.

### M5 — Why one graph cannot use multiple dispatchers (design choice, not a missing feature)

Putting two dispatchers inside one graph (e.g. two threads pushing the two arms of an in-graph
diamond A→{B,C}→D) reintroduces **glitches** (D fires twice; momentarily sees "new B + old C") and
**data races** (B,C writing a shared downstream state need a lock — and the lock serializes away the
parallelism you added). The entire wave protocol (RESOLVED diamond merge + single-thread sweep) exists
to kill exactly that glitch. **Single dispatcher per graph is the SOURCE of correctness, not an
unoptimized state.** D22's "graph = single causal/concurrency domain" is this choice: no threads
inside a graph; want parallelism → open another graph (cross-graph is async, which makes "see a
half-old value" a legal contract instead of a hidden race).

> The two parallelism routes contrasted: in-graph multi-dispatcher trades AWAY glitch-free for
> parallelism (hidden race); multi-graph + async trades AWAY same-tick consistency (async never
> promised it) for parallelism (explicit at the wire). GraphReFly picks the second: the cost of
> parallelism is pushed to the wire boundary and made visible, not buried inside the graph.

### M6 — D26 corollary: "graph = the minimal parallel unit the user can decide" is FORCED

The user's original intuition ("the graph is the smallest parallel unit a user can decide") is not a
convention — it FALLS OUT of single-dispatcher-per-graph (M5) + graph-local clock (D26). You cannot
sub-divide a graph into two parallel units because that needs a second dispatcher, which only a second
graph yields. This is the bridge to PART 2's write-isolation model.

---

## PART 2: VISION — "a reactive blend of git and Linear" (exploratory, NOT decided)

The user's own framing (clarified as their vision, motivated by the current "GitHub flooded with
agent PRs" pain): re-think merge-conflict / commit / ownership at a different dimension. GraphReFly can
simplify these at the causal level, giving agents more autonomy while humans stop worrying about
agents touching safety-critical parts — because nodes carry guards and graph isolation lets a human
carve out a playpen for an agent (and one for themselves). At the graph level a human can SEE who
touched a graph, who MAY touch it, whether a merge is dangerous; "an agent is writing this patch, so
I'll take another — guaranteed not to step on each other's toes." Explicitly described as "not fully
thought through — a vision, like a reactive synthesis of git and Linear."

### V1 — Write-isolation unit = the GRAPH (challenges DS-14.6.A L2)

The user proposed: drop subgraph-level write isolation; **the graph is the write-isolation unit** —
"a graph represents one causally-entangled interaction, so one graph is single-writer / multi-reader."
If two changes don't entangle, split into two graphs.

⚠️ **CONFLICT FLAG (not resolved):** This directly contradicts DS-14.6.A **L2** ("write isolation =
subgraph-level"). Note the irony surfaced in-session: V1 is arguably CLOSER to D22 ("graph = single
causal/concurrency domain; parallelism via multi-graph") than L2 is — L2's subgraph-level concurrency
is the deviation from D22. But changing L2 is a decision revision; per decision-first it must go
through /design-review → approval, NOT be silently adopted here.

Definitions the user pinned down for V1:
- **(a) "one write" = exactly one external writer-actor holds write access** (may edit inputs / edit
  topology). Internal fan-in nodes emitting DATA are NOT "writes" (single-thread propagation, no
  contention). Whoever holds the lock may rewrite; others have free READ (`.cache`, `describe`,
  `observe`, read the code).
- **(b) Shared messaging hubs are out of scope** — a hub already lives inside some graph's causal
  domain, so its internal multi-publisher emits are "internal writes", not external writes. This
  dissolves the assistant's earlier worry that "N publishers on one topic violates single-writer";
  cross-agent contribution flows through the READ channel (everyone can read each other's graphs),
  not through shared external write.

### V2 — Reframe: causal-dimension conflict prevention vs text-dimension conflict detection

The vision's core (assistant's sharpening, user-endorsed direction):
- **git** judges conflicts in the TEXT dimension → can only detect them AFTER both agents finish and
  try to merge (lagging; loss already incurred).
- **GraphReFly** judges in the CAUSAL dimension → conflicts are PREVENTED at the allocation stage,
  before anyone acts: write-isolation unit is the graph, two agents take different graphs, so they
  structurally cannot step on each other.

> git = optimistic concurrency (everyone edits, detect conflict after the fact, resolve painfully).
> GraphReFly = causal partitioning (before acting, hand causally-independent regions to different
> writers; conflict is structurally impossible). The antidote to "GitHub flooded with agent PRs" is
> not fewer PRs — it's allocating causally-independent work up front so N agent changes are
> guaranteed mergeable (they land in mutually-unreachable causal cones).

### V3 — "git × Linear × reactive" decomposed into three axes
- **git half:** version / diff / branch / ownership / merge — already have `snapshot`, `Graph.diff`,
  `meta.owner`, changeset. But **causal-aware**, not text-aware.
- **Linear half:** tasks / who-owns-what / board / status. Insight: a **kanban board = the
  ContextView rendered for a HUMAN Actor** (their owned graphs, pushed todos, importance-filtered
  context). Same DS-14.6.A per-view rendering (L4); LLM view → compressed prompt, human view →
  kanban. "Board vs group-chat" preference and the multi-agent substrate are two projections of ONE
  mechanism.
- **reactive half** (neither git nor Linear has it): both are static snapshots you pull/refresh;
  GraphReFly's "who touched this graph, is the merge dangerous" is PUSHED and live.

### V4 — Structural safety: a playpen, not a leash
Safety stops being per-operation approval (which deadlocks agents and exhausts humans) and becomes
structural:
- **core safety zone** = graphs the human holds write on; agents read-only — agents can't touch it
  not because each step is blocked, but because they lack write access to that graph.
- **playpen** = graphs whose write the human handed to an agent — agent plays/errs freely; an error
  only pollutes that one graph (graph isolation = blast-radius isolation).
- **boundary** = guards on nodes; cross-zone influence must pass a guard.

This is one dimension above sandbox isolation: a sandbox stops an agent from breaking the MACHINE
(`rm -rf`); this stops an agent from breaking STATE OTHERS DEPEND ON (the real multi-agent pain a
sandbox can't solve — two agents editing the same repo inside one sandbox still conflict).

### V5 — Ownership lifecycle (user's answers to the three "thorns")

The user closed the three open thorns the assistant raised; together they form one lifecycle where
**only ONE step needs distributed coordination**:

```
create  (create-owns; single-machine; NO contention — creator holds the lock first,
         exactly like a process creating a file owns its lock; GraphReFly defines the
         lock semantics, analogous to a filesystem defining file locks)
  → hold + edit the blueprint  (single-machine; in-graph single-writer)
  → release  (when the agent is done writing, it releases write access)
  → acquire  (redis/lease-coordinated; CONTENDED; the ONLY distributed point —
              multiple agents may want to claim the same just-freed graph)
  → hold again ...
```

- **Creative work needs no partition** — the creator owns exclusively; nothing to entangle. Partition
  only matters when an EXISTING structure is edited by multiple parties. This dissolves the "partition
  needs a pre-existing graph" paradox: create-owns covers new-structure creation.
- **Blueprint = graph code = spec-as-projection** (DS-14.5.A), regenerated/updated after each edit.
  Before acting, an agent READS the blueprint → sees which graphs exist, which code maps to which
  graph, who currently holds write. "Which graph does the line I want to change belong to, is anyone
  writing it" becomes a TABLE LOOKUP, not a causal inference. The abstract causal analysis is hidden
  behind the blueprint index; the agent only deals with the index.
- **"Don't rebuild redis" ≠ "don't use redis".** GraphReFly defines the SEMANTICS (write access,
  version, causal); redis (or any lib) provides the MECHANISM (lock, lease, cross-machine store).
  Same philosophy as `attachStorage` (pluggable backend). The distributed write-coordination is just
  another adapter ("lock provider" interface; in-memory impl single-machine, redis impl on cloud).

Emergent property the assistant flagged and the user's design choices reinforce: **distributed
complexity is inversely proportional to write-isolation granularity.** Choosing graph (large unit) +
static fission shrinks the set of points needing coordination to ONE (acquire-a-free-graph). Had the
design kept L2 subgraph-level or runtime hot-fission, that surface would be far larger. Short hold +
strong isolation also means a redis-lease failure (split-brain: two agents both think they hold the
lock) degrades from catastrophe to "that one graph's change is redone" — blast-radius isolation buys
fault tolerance, not lock perfection.

### V6 — Fission = STATIC, on the code, blank-start (user clarified twice)

Fission is NOT a runtime operation. It is editing the STATIC code on the filesystem to split one graph
definition into two — "like making changes to code; like git, but more granular." Because the split
happens when nothing is running, all the runtime hazards (quiescence, state migration, live-migration)
**do not exist**. New graphs **blank-start** (re-hydrate from sources on next run via push-on-subscribe;
lossless for derived/pure compute precisely because the independence criterion guarantees the two
halves don't couple). The user explicitly chose blank-start over snapshot-fork.

**Fission criterion (causal, wire-aware):** X (writer-A's writable region) and Y (writer-B's) may
split ⟺ neither is in the other's DIRECTED causal cone, with reachability walked THROUGH wires. A
shared READ-ONLY upstream Z does NOT count as entanglement (directed reachability A→…→B excludes it).
This is exactly what `reachable()` computes (directed up/down-stream) — but it is currently
in-graph-only; cross-wire reachability is **G6 (unverified, from SESSION-multi-agent-gap-analysis)**.
So "must look at the wires" = `reachable()` must become wire-aware = **G6 is a prerequisite**.

Subtlety raised (open): if the change is a TOPOLOGY edit (adding an edge / wire) rather than an input
edit, independence must be judged on the POST-change topology, because adding a wire can CREATE
entanglement that didn't exist pre-change. "Two graphs joined by a new wire are, causally, one
coupled system" — so the unit of independence analysis is the **wire-connected component**, not the
graph container alone. (Same hard case as git "a change that adds a reference to something far away".)

### V7 — Fusion is the asymmetric, harder inverse (user: needs both writers + consent)

Fission is single-party (the sole owner decides to split — freedom). **Fusion requires BOTH writers
present and consenting to surrender write** (merging two graphs → one write-isolation unit → only one
write access can survive → an ownership negotiation, not an edit — a contract). The user's rule:
"fusing two graphs needs both to hold write access simultaneously to operate." This is where git's
merge-conflict pain actually lives; left as the sharpest unresolved corner of the model.

---

## PART 3: OPEN QUESTIONS (none decided — user said "纯粹讨论")

1. **Fission criterion: validate-only vs auto-suggest.** Assistant asked twice; user declined to pick
   ("不拍"). Assistant leans validate-only first (small, safe, and it forces G6 out as a prerequisite);
   auto-suggest can wait for a real usage signal. UNRESOLVED — gates the /design-review scope if/when
   one is opened.
2. **The single distributed point — "acquire a free graph" lease semantics.** What happens when the
   lease expires mid-write; can a human reclaim mid-handoff; two agents racing for the same idle graph.
   This is the one place a little distributed coordination is unavoidable even though graphs are
   single-machine.
3. **Blueprint 80/20.** Lookup-by-blueprint prevents the ~80% common conflict (two agents want the
   same block — direct stomp). The ~20% cross-graph RIPPLE (I write graph #7, an async wire pushes a
   non-intended value into graph #9's invariant) still needs wire-aware causal analysis. Worth a
   standing causal-analysis cost, or on-demand only?
4. **Causal-conflict UX.** Causal-dimension conflicts are more PRECISE than text conflicts but more
   ABSTRACT ("your change, three wire-hops out, violates my graph's invariant"). `explain()` gives the
   chain; how to render "two changes are causally incompatible" so a human AND an agent can act on it.
5. **Topology-edit fission (V6 subtlety):** is the independence criterion evaluated on pre- or
   post-change topology, and what's the unit (graph vs wire-connected-component)?
6. **Fusion semantics (V7):** the ownership-merge protocol when two active writers combine graphs.

## PART 4: DECISION-HYGIENE FLAGS (surfaced, NOT acted on)

Per feedback_no_autonomous_decisions — these were recorded as FLAGS for the user to adjudicate. The
user adjudicated all three on 2026-05-31 (see rulings inline). NONE of these rulings are themselves
locked decisions/spec changes yet — they set DIRECTION; the actual L2-retire / D22-amend land via the
proper flows (decisions.jsonl / /spec-amend) when the user opens them.

- **F1 — RESOLVED (user 2026-05-31): L2 is OBSOLETE; both TS and Rust clean-slate branches already
  lean D22 / V2.** The user's V1 ("graph / causally-connected component = write-isolation +
  parallel unit") is NOT in conflict with the live codebase — it is the live direction. DS-14.6.A
  **L2 (subgraph-level write isolation) is retired/stale.** Critical history the user supplied:
  dispatcher:graph is NOT constrained 1:1 (see CORRECTION 2026-05-31b in PART 1); Rust originally
  pursued fine-grained subgraph locking (the many mutex/lock machinery in
  `rust-port-d3-per-subgraph-parallelism`), found it **hurt performance**, and **DROPPED it** to land
  on D22 (`decisions.jsonl` D22, 2026-05-27: "graph = causal domain = concurrency domain =
  single-threaded; ... **Rust drops the actor model**; Py drops the subgraph lock"). **CORRECTION
  2026-05-31 (user): D22 DROPS the actor model — do NOT say Rust "moved to an actor model" (an earlier
  assistant misquote, retracted).** Rust's actual parallelism/perf direction is **DR-8** (2026-05-30):
  perf END-STATE = **arena + index/generational handles** (move the hot path off `Rc<RefCell>` onto
  arena-owned nodes addressed by index handles), with D22 honored — intra-graph multi-threading stays
  OUT, parallelism = multi-graph (one thread per graph). So the subgraph-lock approach was tried and
  rejected on perf grounds; V1 = where both tracks already are. V1 ≡ the causally-connected-component
  partition (cf. the dropped Rust union-find connectivity detection). **Action:** DS-14.6.A L2
  should be marked superseded when the multi-agent write-isolation story is next formally written;
  no live decision actually depends on L2's subgraph-level claim. The OTHER DS-14.6.A locks (L3
  tagged pool, L4 per-view rendering, L7 actorPool, L9 heterogeneousDebate) are independent of L2 and
  survive.
- **F2 — RULED (a) (user 2026-05-31): amend D22 wording.** D22 "single-thread CAUSAL/concurrency
  domain" is imprecise — causal influence SPANS wires (M4); a graph/component bounds the single-thread
  CONCURRENCY unit, not the causal influence range. The user chose to tighten the wording (option a),
  NOT just add commentary (option b). **This is a spec-wording change → goes through /spec-amend**
  (rules.jsonl + formal/*.tla + conformance) when opened; flagged here as the agreed DIRECTION, not
  yet executed. Proposed tightening: "graph/connected-component = single-thread CONCURRENCY domain;
  in-component propagation is one synchronous causal wave (same-tick glitch-free); causal influence
  propagates ACROSS components via async wire as delayed consistency."
- **F3 — DEFERRED (user 2026-05-31): record now, verify later.** The new design surface (static causal
  fission + wire-aware reachability/G6 + ownership lease + fusion negotiation) stays captured in this
  doc; do NOT advance to /design-review yet. Re-open when the user returns to it. Smallest first step
  when it re-opens = verify G6 (`reachable()` walking through wires) as an isolated check, since the
  fission criterion is air unless G6 holds.

If/when the user says go, the natural bundle for one /design-review 9Q pass:
(1) drop L2 subgraph-level → "graph = write-isolation + parallel unit"; (2) static fission criterion
(validate-only vs auto-suggest = OQ#1); (3) wire-aware reachability (G6); (4) D22 "causal"→"concurrency"
wording; (5) check the rest of DS-14.6.A (per-view rendering L4, tagged pool L3) survives dropping L2.

## PART 5: SOURCES (landscape 2026-05-31)

- Multica — https://github.com/multica-ai/multica · https://deepwiki.com/multica-ai/multica/1.2-system-architecture
  · https://multica.ai/ · issue #1900 (multi-runtime-per-agent) · AgentConn review (★/trending)
- CubeSandbox — https://github.com/TencentCloud/CubeSandbox · https://news.ycombinator.com/item?id=47863430
- ECC — https://github.com/affaan-m/ECC · https://ecc.tools/
- Agent harness vs runtime (decision/execution separation consensus) —
  https://www.credal.ai/blog/agent-harness-vs-agent-runtime ·
  https://northflank.com/blog/code-execution-environment-for-autonomous-agents
- Orchestrator-worker > group-chat in production —
  https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production
- K8s Agent Sandbox (disposable stateless sandboxes mainstreaming) —
  https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox/

## PART 6: CROSS-REFS

- [`SESSION-DS-14.6-A-multi-agent-context-architecture.md`](SESSION-DS-14.6-A-multi-agent-context-architecture.md)
  — L2 (the CHALLENGED lock), L4 per-view rendering (= the kanban=ContextView insight), L7 actorPool.
- [`SESSION-DS-14.5-A-narrative-reframe.md`](SESSION-DS-14.5-A-narrative-reframe.md) — spec-as-projection
  (= "blueprint"), meta.owner + L0–L3 ownership staircase (= write-access model).
- [`SESSION-multi-agent-gap-analysis.md`](SESSION-multi-agent-gap-analysis.md) — G6 cross-graph
  explain/reachable (the prerequisite for wire-aware fission), G10 hot-swap (rewire gap).
- [`SESSION-harness-trends-graphrefly-positioning.md`](SESSION-harness-trends-graphrefly-positioning.md)
  — variety-reduction thesis, 0.99→1.0 node-boundary resilience, "topology IS the constraint".
- [`SESSION-DS-14-changesets-design.md`](SESSION-DS-14-changesets-design.md) — mutate/BaseChange
  (the git-half versioning substrate).
- Floor: D22 (single causal/concurrency domain — see F2), D26 (graph-local clock — the M2/M6 basis),
  F-SYNC-CORE, F-DISPATCH-ALL, D7 (handle = pure data).
- Memory: project_rewire_gap, project_reactive_tracker, project_universal_reduction_layer,
  feedback_no_autonomous_decisions, feedback_no_implement_without_approval.

---

**STATUS:** Discussion captured 2026-05-31. ZERO decisions locked. No D-number, no spec amendment, no
code. PART 1 = corrected mechanism model (clarifies existing floor). PART 2 = exploratory vision.
PART 3 = open questions (OQ#1 fission validate-vs-suggest still un-picked by user). PART 4 = flags
(F1 L2-conflict, F2 D22-wording, F3 new-surface) awaiting user adjudication before any /design-review.
