---
SESSION: blueprint-stacked-pr-ownership
DATE: 2026-06-24
TOPIC: Discussion-capture (NOT a decision session). Captures the June 2026 research/discussion
  thread about combining GraphReFly's read-only blueprint with Graphite-style stacked PRs/diffs and
  an ownership-control layer built from ABAC-style node guards plus source-diff checks. Oak was
  researched as an agent-native VCS/storage substrate but explicitly deprioritized in favor of
  Graphite/stacked-diff integration because stacked PRs map more directly to GraphReFly's current
  blueprint / ownership / verification direction.
REPO: graphrefly-ts (primary)
STATUS: DISCUSSION CAPTURE ONLY. No D-number minted, no spec amended, no code implemented. Any
  public API, new primitive, ownership policy artifact, Graphite adapter, or guard semantics change
  requires design-review -> explicit user approval -> decision/spec flow as applicable.
SUPERSEDES: none
RELATED:
  - SESSION-reactive-linear-and-git.md
  - SESSION-DS-14.5-A-narrative-reframe.md
  - SESSION-DS-14-changesets-design.md
  - packages/ts/src/graph/blueprint.ts
  - docs/roadmap.md
  - docs/implementation-plan.md
---

## CONTEXT

The thread began with research into Graphite's "stacked PRs" / "stacked diffs" model, then expanded
into how GraphReFly's blueprint, ownership boundaries, and node guards could cooperate with stacked
review flows.

The key external distinction:

- **Graphite / stacked PR tools** manage the review and branch mechanics: branch stack creation,
  PR dependencies, restacking/rebasing, review UI, and merge order.
- **GraphReFly** should manage the semantic layer: blueprint-backed affected nodes/subgraphs,
  ownership claims, allowed patch scopes, required checks, causal impact, and reviewer evidence.
- **Oak** is relevant as a possible future VCS/workspace backend, but it solves a lower-level
  storage/worktree problem. It should not be prioritized over stacked-diff integration for the
  current GraphReFly product direction.

This session intentionally records a product/design direction, not a locked architecture.

## PART 1: TERMINOLOGY

The English terms discussed:

- **stacked PRs** / **stacked pull requests**: dependent pull requests reviewed and merged in order.
- **stacked diffs** / **stacked changes**: the lower-level change-review framing used by tools and
  systems that treat each change as a separate review unit.
- **patch stack** / **review stack**: broader historical terms, common around Mercurial/Sapling,
  Gerrit, StGit, and related flows.

Important correction: Graphite is not primarily an automatic "split my giant PR safely" engine.
The useful workflow is to split intentionally before or during implementation, then let Graphite
manage the stack mechanics. Auto-splitting a finished mega-diff may be a future advisor feature, but
it is much harder and should not be the first product shape.

## PART 2: CURRENT BLUEPRINT BOUNDARY

Current `GraphBlueprint` is not a stack plan and not an ownership artifact.

The current TypeScript blueprint slice explicitly says a blueprint is read-only audit/collaboration
evidence over `graph.topology()`, and is not an authoring spec, checkpoint, restore input, hash owner,
or collaboration ownership artifact.

Current shape:

```ts
interface GraphBlueprint {
  readonly version: typeof GRAPH_BLUEPRINT_VERSION;
  readonly topology: NormalizedGraphTopologySnapshot;
  readonly diagnostics?: GraphBlueprintDiagnostics;
  readonly provenance?: GraphBlueprintProvenance;
  readonly hash?: GraphBlueprintHash;
}
```

The topology carries normalized nodes, edges, and optional subgraphs. It does not carry a `stack`
field. The earlier JSON example with `"stack": [...]` was only a hypothetical planner output and
should be renamed to avoid confusion.

Preferred naming:

- **GraphBlueprint**: read-only topology/audit evidence.
- **ChangePlan** or **StackPlan**: task-specific planning artifact that references a blueprint hash.
- **WorkUnit**: one planned change unit, usually mapping to one stacked diff/PR.
- **OwnershipPolicy** or **OwnershipClaims**: authority artifact for who may edit what.
- **VerificationPlan**: required checks/evidence for a WorkUnit.

## PART 3: STACKED PR INTEGRATION MODEL

The prioritized integration shape:

```text
User/agent task
  -> GraphReFly reads current blueprint
  -> GraphReFly emits ChangePlan / WorkUnits
  -> each WorkUnit maps to one stacked diff / PR
  -> agent works within the active WorkUnit boundary
  -> GraphReFly checks diff scope + causal/verification evidence
  -> Graphite manages stack submit/restack/review/merge mechanics
```

Boundary:

- Graphite owns branch/PR stack mechanics.
- GitHub or the forge owns review UI.
- GraphReFly owns semantic planning, ownership, affected-node evidence, and check routing.
- The agent works inside the currently active WorkUnit.

The best first product is not "auto split a user's large PR." It is:

```text
Before the agent writes, split the task into causal/ownership-aware WorkUnits.
```

This aligns better with GraphReFly's blueprint model and avoids trying to reconstruct intent from a
finished diff.

## PART 4: PROPOSED CHANGEPLAN SHAPE

The earlier `"stack"` key should be avoided in GraphReFly-owned artifacts because it sounds like
GraphBlueprint topology. Prefer `units`.

Illustrative shape only:

```json
{
  "kind": "graphrefly.changePlan.v0",
  "baseBlueprintHash": "bp_abc123",
  "units": [
    {
      "id": "auth-schema",
      "title": "Add refresh token schema",
      "claims": ["node:auth.token-store", "sourceRange:src/auth/schema.ts"],
      "allowedFiles": ["src/auth/schema.ts", "src/__tests__/auth/schema.test.ts"],
      "dependsOn": [],
      "checks": ["auth:schema", "blueprint:hash"]
    },
    {
      "id": "refresh-runtime",
      "title": "Wire refresh runtime graph",
      "claims": ["subgraph:auth.refresh"],
      "allowedFiles": ["src/auth/refresh.ts", "src/graph/auth.ts"],
      "dependsOn": ["auth-schema"],
      "checks": ["auth:runtime", "explainPath:refresh"]
    }
  ]
}
```

This artifact is outside the blueprint. It references `baseBlueprintHash` so checks can detect when
the plan was generated against stale topology.

## PART 5: OWNERSHIP CONTROL VIA GUARDS + DIFF CHECKS

The user's observation was that every node can have guards, and guards can express ABAC. This is a
strong fit for runtime ownership enforcement, but it is not sufficient by itself for source-code
ownership.

Split the ownership system into layers:

```text
Blueprint = address book / lookup index
OwnershipPolicy = authority
Node guards = runtime enforcement points
Diff checker = source-code enforcement point
Stacked PR = delivery/review vehicle
Lease provider = distributed coordination mechanism, if needed
```

Runtime ABAC can answer:

- Can this actor emit to this state node?
- Can this actor rewire this graph/component?
- Can this actor trigger this effect?
- Can this WorkUnit mutate this owned runtime resource?
- Is the actor's lease still valid?

Example attributes:

```json
{
  "subject": {
    "actorId": "agent-17",
    "kind": "agent",
    "role": "implementation-agent",
    "workUnitId": "refresh-runtime"
  },
  "resource": {
    "graphId": "auth",
    "nodeId": "auth.refresh.status",
    "owner": "team-auth",
    "safety": "normal"
  },
  "action": "write",
  "context": {
    "branch": "agent/refresh-runtime",
    "baseBlueprintHash": "bp_abc123",
    "leaseToken": "lease_123"
  }
}
```

Source-code edits still need a diff checker because an agent changing files through shell/editor
happens outside the running graph. The diff checker maps changed files/ranges back to blueprint
claims and WorkUnit allowed scopes.

Conclusion from the discussion:

```text
Use ABAC node guards as enforcement machinery, not as the entire ownership system.
```

## PART 6: CLI/MCP POSITION

The thread also revisited CLI vs MCP.

Current preferred shape:

- CLI first, with strict `--json` outputs.
- MCP as an optional projection later, if agent clients benefit from discoverable typed tools.
- One shared core operation layer should back both surfaces.

Potential CLI surface:

```bash
graphrefly stack plan "add refresh token support" --json
graphrefly stack start auth-schema
graphrefly stack check --unit auth-schema --json
graphrefly stack pr-body --unit auth-schema
graphrefly stack submit --via graphite
```

Potential MCP tools later:

```text
stack_plan(task)
stack_start(unitId)
stack_check_diff(unitId)
stack_explain_violation(path)
stack_pr_body(unitId)
```

This follows the existing roadmap direction where the library removed a bundled MCP server from
scope, while CLI/surface operations remain useful for humans, CI, and shell-capable agents.

## PART 7: MINIMUM VIABLE PRODUCT

Smallest useful MVP:

1. Generate a `ChangePlan` from a task plus current `GraphBlueprint`.
2. Represent each WorkUnit with `claims`, `allowedFiles`, `dependsOn`, and `checks`.
3. Implement `graphrefly stack check --json` against the current git diff.
4. Emit a PR body section with affected blueprint nodes, required checks, and base blueprint hash.
5. Later add a Graphite adapter for branch creation/submission/restack metadata.

Not MVP:

- Automatic safe splitting of an arbitrary finished mega-PR.
- Replacing Git/Graphite with a new VCS.
- Distributed lease provider.
- Full ABAC policy language.
- Bundled MCP server.

## PART 8: OPEN QUESTIONS

1. **Artifact naming:** `ChangePlan` vs `StackPlan`. Current lean: `ChangePlan` for GraphReFly-owned
   semantic plan; Graphite owns "stack" terminology.
2. **Resource granularity:** should claims address `node`, `subgraph`, `sourceRange`, `file`, or
   `wire-connected component` first?
3. **Ownership authority:** where does the first `OwnershipPolicy` live: repo file, generated temp
   artifact, PR body metadata, or graph meta projection?
4. **Guard surface:** which runtime operations are guardable in v0: state emit only, rewire, effect
   trigger, or all graph mutations?
5. **Diff mapping:** how robust must sourceRange mapping be in the first version? File-level
   `allowedFiles` may be enough for the MVP; source ranges can follow.
6. **Graphite integration:** call Graphite CLI directly, consume Graphite MCP, or produce metadata
   only and let the user/agent call Graphite?
7. **Causal conflict UX:** how should a human understand "this WorkUnit violates a downstream causal
   invariant" in a PR review?

## PART 9: RESEARCH SOURCES

External sources consulted during the thread:

- Graphite stacked PRs: https://graphite.com/blog/stacked-prs
- Graphite stacked diffs guide: https://graphite.com/guides/stacked-diffs
- Graphite review best practices: https://graphite.com/docs/best-practices-for-reviewing-stacks
- Graphite evaluating stacking tools: https://graphite.com/docs/evaluating-tools
- Graphite CI optimizer: https://graphite.com/docs/stacking-and-ci
- Graphite GT MCP: https://graphite.com/docs/gt-mcp
- Sapling source control overview: https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/
- ReviewStack / stacking resources: https://www.stacking.dev/
- Oak: https://oak.space/ and https://oak.space/docs
- re_gent: https://github.com/regent-vcs/re_gent
- GitButler stacked branches: https://docs.gitbutler.com/features/branch-management/stacked-branches
- Jujutsu docs: https://docs.jj-vcs.dev/latest/

## PART 10: RELATED LOCAL CONTEXT

- `packages/ts/src/graph/blueprint.ts`: current GraphBlueprint boundary and schema.
- `docs/roadmap.md` Wave 2: "Shared Blueprint" positioning and CLI/MCP history.
- `docs/implementation-plan.md` Phases 14-16: changesets/diff, eval, CLI/launch wave.
- `archive/docs/SESSION-reactive-linear-and-git.md`: causal-dimension collaboration, ownership
  lifecycle, blueprint as lookup index, static fission, and wire-aware reachability prerequisite.
- `archive/docs/SESSION-DS-14-changesets-design.md`: BaseChange / changeset substrate context.

