---
SESSION: graphrefly-canvas-data-query-wedge
DATE: 2026-06-04
TOPIC: Discussion-capture (NOT a decision session). Reconnects the prior GraphReFly Canvas /
  Workbench product vision with the Data Agent / Data Query wedge surfaced by a Xiaohongshu post
  about enterprise data agents. The result is a product framing: GraphReFly Canvas is the mother
  product; Trusted Data Query is the first professional paid wedge. No substrate, protocol, or
  package-boundary decision is made here.
REPO: graphrefly-ts
STATUS: DISCUSSION CAPTURE ONLY. This document captures product strategy and solution-layer shape.
  Anything that would add a primitive, change the 8-verb floor, change the wave protocol, or lock
  a new package/API requires the normal /design-review -> user approval -> decision log path.
---

## CONTEXT

The user pointed out that the assistant's initial "Data Agent" framing had lost an important
earlier product thread: GraphReFly as the engine under a web application similar in surface to n8n,
but with a different center of gravity.

Prior product thread, as recalled by the user:

- **GraphReFly Canvas / Workbench** is a separate product or host built on GraphReFly as the bottom
  engine, not a protocol change to GraphReFly itself.
- The product has at least two visible layers: a **UI layer** and a **code/spec layer**. The missing
  middle, and the reason GraphReFly matters, is the live topology layer between them.
- Commodity surfaces can be rented or reused: page/canvas editors, chat UI, code sandbox, workflow
  canvas, generated UI renderers, and app-store-like registry surfaces. The non-commodity asset is
  the binding chain between presentation, boundary nodes, GraphSpec/code, and the reactive runtime.
- Plugin strategy has a clean divide: plugging into builders that already own the workflow engine
  demotes GraphReFly into one node; plugging into distribution or UI surfaces can preserve
  GraphReFly as the engine but hides some moat. The more durable path is an independent or
  embeddable workbench/canvas whose value is the inspectable topology and code escape hatch.
- Forkable workbench unit = GraphSpec + presentation JSON + capability manifest, not user data.
  Users fork logic, connect their own accounts, and keep private data at their own boundaries.
- Web-first remains plausible for many wedges: OPFS/local storage, optional local inference, thin
  relay for notifications, premium cloud for offline or heavy work. Native is a later pro/local
  upgrade, not the assumed first surface.

The new trigger was a Xiaohongshu post/comment cluster about enterprise Data Agents. Its useful
thesis: enterprise data-agent failure is usually not SQL syntax generation; it is business semantics,
metric definitions, stale schema/context, entity ambiguity, retrieval misses, and insufficient
verification. The user connected this to GraphReFly: data retrieval and transformation are fragile
step-by-step processes; each step should be explicit, explainable, locally repairable, and
verifiable; once stabilized, an ad-hoc query can become ETL-like reusable work.

This document captures the synthesis:

> **GraphReFly Canvas is the mother product; Trusted Data Query is the first professional wedge.**

## PRODUCT CONCEPT

GraphReFly Canvas is a malleable professional workbench where AI-generated work is not accepted as a
black-box answer. It is represented as a live, inspectable topology that both humans and LLMs can
read, patch, verify, and eventually promote into reusable artifacts.

The clean product mental model is three layers:

| Layer | What the user sees or edits | GraphReFly role |
|---|---|---|
| **Presentation UI** | Tables, charts, dashboards, controls, layout, answer cards, review buttons | Projection bound to graph boundary nodes |
| **Inspectable Topology** | Nodes, edges, descriptions, assumptions, validation checks, lineage, execution status, topology diff | The live trust surface and LLM editing target |
| **Code / Spec Layer** | GraphSpec, node factory names, SQL, dbt/Cube/Snowflake calls, custom code, capability manifests | Durable/forkable substrate for serious users |

This is intentionally not "another n8n". n8n's graph is workflow automation. GraphReFly Canvas'
graph is a confidence surface: it explains how a result was produced, what assumptions entered it,
where verification happened, and what local patch would repair it.

## TOPOLOGY LENS / BLUEPRINT OVERLAY

The user proposed a UI mechanism that makes the three-layer product concrete:

> The inspectable topology should be available as a semi-transparent blueprint overlay, or as a
> minimap-like layer, over either the canvas layer or the code/spec layer.

This topology layer is not the primary workspace for ordinary users. It is an x-ray / blueprint /
trust lens that can be opened when the user wants to understand, debug, bind UI, or watch execution.

Possible visibility modes:

- **Off:** canvas/code only.
- **Boundary-only:** show only UI-bound input/output boundary nodes.
- **Focused path:** show the currently selected node, its upstream/downstream path, and validations.
- **Full topology:** show the whole graph.
- **Debug/protocol mode:** expose deeper runtime/protocol state for advanced users.

During graph execution, opening the topology lens should let the user see flow through the graph:

- running / waiting / needs input / ready / verified / failed in normal user language
- DATA / RESOLVED / COMPLETE / ERROR only in advanced/debug mode
- active path, stale nodes, error nodes, and verification nodes highlighted

When execution reaches a human-input or missing-input node:

```text
graph reaches humanInput / missing boundary input
  -> topology node highlights
  -> canvas locates the corresponding input UI
  -> if no UI exists and auto-generate UI is enabled
       -> AI creates an input widget slot on the canvas
       -> widget binds to the node
       -> user fills it
       -> graph continues
```

The user also clarified a key navigation rule:

- If the hovered topology node already has a corresponding UI widget, the canvas should **not**
  automatically move by default; it should show that the node is already pinned.
- Users can choose in settings whether the canvas follows topology hover/selection:
  - **No tracking:** show pinned state only.
  - **Soft tracking:** reveal a subtle connector/highlight without panning.
  - **Follow selection:** pan/zoom canvas to the corresponding widget when a topology node is
    selected or when runtime needs human input.

This keeps topology inspection from hijacking the user's canvas layout, while still allowing a
debugger-like follow mode when desired.

## WHY DATA QUERY FIRST

The Data Agent market gives the workbench a sharp professional wedge.

The initial paid wedge should not be "ETL builder" and should not be "AI writes SQL". It should be:

> **Trusted Data Query: every data answer comes with a graph.**

Reasoning:

- **The acute Data Agent pain is query correctness.** Business users and analysts do not merely need
  a query entry point; they need the right metric, right grain, right exclusions, right freshness,
  right source, and a way to see why a number should be trusted.
- **Data Query is higher-frequency than full ETL.** Professionals ask and review ad-hoc questions
  daily. A full production pipeline is a later hardening step.
- **Data Query naturally promotes into ETL.** Once a query graph is verified and reused, it can be
  saved, scheduled, materialized, exported, or converted into a dbt model/report/pipeline.
- **The use case forces the topology layer to matter.** Unlike casual app generation, data
  professionals already want lineage, assumptions, row profiles, validation, and source-of-truth
  evidence. They are willing to inspect the middle layer because the cost of a wrong answer is real.
- **It avoids rebuilding the semantic layer.** GraphReFly should wrap and orchestrate existing data
  systems (dbt Semantic Layer, Cube, Snowflake, BigQuery, DuckDB, warehouses, notebooks), not replace
  their metric engines.

## TRUSTED DATA QUERY FLOW

The first wedge can be described as:

```text
business question
  -> LLM proposes topology or topology diff
  -> metric/entity/source resolution
  -> semantic/runtime/tool selection
  -> query/tool execution
  -> result profiling
  -> verification checks
  -> explanation/evidence assembly
  -> human approve/edit/split/merge nodes
  -> saved reusable graph
  -> optional promotion to ETL/report/dashboard/model
```

Typical node families are solution-layer/preset catalog entries, not new core verbs:

- `resolveMetric` / `resolveEntity` / `resolveGrain`
- `selectSource` / `loadCatalog` / `loadSemanticModel`
- `runQuery` / `runNotebook` / `runDbtMetric` / `callCube` / `callSnowflake`
- `profileResult` / `sampleRows` / `detectSchemaDrift`
- `validateFreshness` / `validateRowCount` / `compareBaseline` / `checkBusinessRule`
- `explainAnswer` / `materializeOutput` / `promoteToPipeline`

Every node should carry metadata that improves both human trust and LLM editing:

- description
- owner/source of truth
- grain
- source tables or semantic models
- filters and exclusion rules
- assumptions
- freshness expectation
- verification policy
- last evidence/result profile
- whether it is editable, locked, or requires human approval

## TOPOLOGY CREATION AND DIFF

The user clarified an important product principle: creating a topology and proposing a topology diff
are the same underlying capability. The difference is governance and step size.

Low model ability or low enterprise trust:

- change fewer nodes per patch
- require more verifiable intermediate nodes
- require explicit verification nodes
- gate edits through human approval
- keep external tools narrow and declared

High model ability or low-risk context:

- allow larger topology patches
- compress several steps into a coarser node
- use existing external tools such as shell, dbt, notebooks, or warehouse jobs inside a declared node
- rely on post-run validation and rollback/diff rather than per-step approval

This maps neatly to GraphReFly's existing direction: finite node catalogs, declared factory names,
descriptions, `describe()`/snapshot/diff, and graph-first inspection. The LLM is constrained to patch
topology, not freely invent hidden control flow.

## PIN NODE TO CANVAS

The user proposed a core UI action:

> Hover a topology node, see a ghost frame on the canvas, click pin, then decide how that node's data
> should become UI.

Interaction sketch:

```text
hover topology node
  -> if no corresponding UI exists
       -> canvas shows a ghost frame / ghost square
  -> click pin on the topology node
       -> ghost frame becomes a widget slot
  -> user moves / resizes / positions the slot
  -> user chooses input or output binding
  -> user chooses which node data/path to bind
  -> AI generates UI, or user pastes/provides a custom component
```

This separates the two decisions that output UI cannot safely infer:

- **Data intent:** which node, which direction, and which data path should be exposed.
- **Presentation intent:** where the widget lives, how large it is, and what kind of component it
  should become.

Inputs and outputs differ:

- **Input UI can be inferred from missing interaction.** If the graph is blocked on human input or a
  required boundary state has no UI, the runtime/AI can propose or auto-create the widget slot when
  allowed.
- **Output UI should be pinned by user intent.** The AI can suggest likely output nodes, but the user
  should declare that a node is presentation-worthy by pinning it.

Once pinned, AI generation and custom component import can share the same binding contract:

```text
node data -> component props
component events -> boundary/input node
```

This lets the user either:

- ask AI to generate a practical widget from schema/metadata, or
- paste a prettier component generated by another app/builder, then bind its props/events to the
  selected GraphReFly node.

The product rhythm becomes:

```text
hover node -> pin -> place -> bind -> generate or paste component
```

For Data Query examples:

- Pin `runQuery.rows` as a table.
- Pin `compareBaseline.summary` as a verification panel.
- Pin `validateFreshness.status` as a small status badge.
- Pin `explainAnswer.value` as a narrative answer card.
- Auto-create an input widget when `resolveMetricDefinition` needs the user to choose a business
  metric definition.

## HOW THIS REDUCES DATA ANNOTATION WORK

The wedge is not "annotate the whole warehouse by hand". The intended product leverage is to make
annotation incremental and structural.

Instead of asking a team to fully document every table/metric upfront, GraphReFly Canvas can:

- attach descriptions and assumptions to the exact nodes created during real work
- reuse known-good nodes and factories across later questions
- localize missing context to the node that failed or became ambiguous
- turn validation failures into targeted annotation tasks
- preserve successful query graphs as reusable examples for the next LLM topology proposal

This matches the user's intuition: fewer allowed operations and more known nodes reduce trial cost.
The workbench narrows the freedom of both humans and LLMs while keeping an escape hatch into code.

## PRODUCT POSITIONING

Candidate positioning:

> **GraphReFly Canvas turns "ask data" into an inspectable, verifiable processing graph that humans
> and LLMs can safely edit.**

Shorter:

> **Every data answer comes with a graph.**

The customer is not the casual user who only wants a chat answer. The first buyer is likely a
professional who already feels the cost of plausible-but-wrong numbers:

- analytics engineers
- data scientists
- data/BI leads
- founders/operators living in warehouse dashboards
- teams already using dbt/Cube/Snowflake/BigQuery but lacking an AI trust surface

What they pay for is confidence, reviewability, reusable artifacts, and lower repair cost after
schema or business-definition changes.

## NON-GOALS AND GUARDRAILS

This is a product/solution-layer wedge, not a substrate specialization.

- Do **not** make GraphReFly "a data framework" at the core.
- Do **not** add data-specific verbs to the 8-verb floor.
- Do **not** rebuild dbt/Cube/Snowflake semantic runtimes.
- Do **not** sell generic "AI writes SQL" as the differentiated claim.
- Do **not** hide the topology inside another builder's static DAG where GraphReFly becomes one node.
- Do **not** let this wedge violate F-NO-WEDGE-CUT: the same Canvas/workbench shape must also remain
  applicable to research feeds, health dashboards, shopping/review-gated automation, and other
  private-flow reduction workbenches.

The product wedge is narrow; the GraphReFly substrate remains horizontal.

## RELATION TO EARLIER THREADS

This discussion connects these prior archived themes:

- **First-principles audit:** graph is the right structure for LLM composition because it is
  executable, inspectable, structurally diffable, and localizes errors.
- **Universal reduction layer:** professional data query is one concrete "massive info -> reduced
  trusted answer" instance.
- **Handle-dispatch substrate draft:** data engineering strengthens the case that large data and
  warehouse execution should live behind handles/tools/pools, not inside graph node values.
- **Reactive collaboration harness:** human review gates and verification nodes are part of the
  trust surface, not decoration.
- **GraphReFly Canvas / Workbench product thread:** data query becomes the first professional wedge
  for the UI + topology + code workbench, rather than a separate product identity.

## FOLLOW-UP: WORKSPACE GRAPH, WORK GRAPH, AND REACTIVE ISSUE TRACKER

Recorded 2026-06-06 from follow-up discussion. This is still product/solution-layer framing, not a
substrate decision.

The clearer product split is:

```text
WorkspaceGraph
  -> reactive issue tracker / work orchestration control plane

WorkGraph
  -> one code + canvas unit
  -> one GraphReFly graph / concurrency domain / edit domain

Canvas projection
  -> widgets bound to selected WorkGraph boundary nodes

Topology overlay
  -> inspectable GraphReFly blueprint over the code/canvas unit
```

The reactive issue tracker is not a Jira integration. It is the outer WorkspaceGraph that replaces
Jira/Linear-style status cards with live, verifiable work assertions. It manages requests, priority,
ownership, approvals, verification summaries, reopen/regression, artifact references, and memory.

Each individual `code + canvas` unit is a WorkGraph. A WorkGraph owns the concrete analysis or tool
flow: for data work, nodes such as metric/source resolution, query execution, result profiling,
freshness checks, baseline comparison, explanation assembly, and widget-bound outputs.

### Control-plane recommendation

The WorkspaceGraph should be a fixed product skeleton with extension slots, not a fully free-form
canvas like WorkGraph, and not one giant graph that mounts all WorkGraphs for execution.

Recommended shape:

```text
WorkspaceGraph
  issues
  workGraphRegistry
  messagingHub
  scheduler/router
  ownership/leases
  verificationIndex
  artifactIndex
  memory/factStore
  views/queues/board
```

Power users customize extension slots:

- issue/request types (`adHocDataQuery`, `experimentAnalysis`, `incidentInvestigation`)
- WorkGraph templates per issue type
- verifier packs (freshness, row-count drift, schema drift, metric reconciliation, business rules)
- priority/routing policy nodes
- widget packs and client-facing canvas layouts
- artifact promotion targets

This keeps the WorkspaceGraph reliable as a product control plane while letting WorkGraphs remain
domain-specific and user-extensible.

### Do not collapse all WorkGraphs into one execution graph

WorkGraphs may appear nested in the UI and may be referenced by WorkspaceGraph data, but they should
remain separate execution/edit domains. The WorkspaceGraph stores `WorkGraphRef` records and talks to
WorkGraphs through messaging hub / wire-boundary commands and events:

```text
WorkspaceGraph -> WorkGraph
  createFromTemplate
  proposePatch
  runVerification
  requestArtifact
  pause / resume / cancel
  requestHumanInput

WorkGraph -> WorkspaceGraph
  planProposed
  topologyChangedSummary
  needsInput
  verificationPassed
  verificationFailed
  artifactReady
  blocked
```

Reasoning:

- A graph is the single-thread concurrency/edit domain. If every WorkGraph is mounted into one large
  graph, the product loses natural parallelism and forces one agent/LLM/human ownership boundary over
  the whole workspace.
- Separate WorkGraphs let one agent modify one graph at a time while other WorkGraphs continue to
  verify or run independently.
- The WorkspaceGraph can still compute global views (board, priority, owner load, blocked issues,
  verification health) from summaries and events without owning every inner topology.
- Cross-graph causal influence is still visible as delayed consistency through declared command/event
  boundaries, rather than hidden imperative calls.

Product shorthand:

> WorkspaceGraph is the control plane. WorkGraph is the execution plane. Canvas is the projection
> plane.

For data-agent requests, the flow becomes:

```text
request filed in WorkspaceGraph
  -> issue/request node created
  -> WorkGraph template selected or forked
  -> WorkGraph runs analysis and verification nodes
  -> Canvas widgets present data views for power users / clients
  -> verification summary flows back to WorkspaceGraph
  -> issue verifies, reopens, or asks for human input
  -> successful graph/artifacts can be promoted into reusable templates or examples
```

The data analytic views are Canvas widgets, not core substrate. The product can provide a demo widget
pack for common views (table, chart, metric card, validation panel, narrative answer card), while
power users build client-specific widget packs and layouts over the same node-binding contract.

### Web-first shell, runner-backed execution

Follow-up product direction: prefer web app first, with desktop/local execution treated as a power-user
capability layer rather than the primary product surface.

Reasoning:

- The WorkspaceGraph, reactive issue tracker, Canvas, approvals, review, sharing, and client-facing
  artifacts are naturally web-first.
- The browser should not directly execute arbitrary local code. It can host the UI, Canvas widgets,
  demo data, OPFS/local-first storage, JS/WASM execution, and lightweight data views.
- Code verification, repo access, shell commands, dbt, warehouse credentials, and long-running tasks
  should run through explicit local or remote runners.
- Desktop/Tauri can later wrap the same web shell and local runner, but the durable design decision
  should be the capability boundary, not the packaging format.

Suggested execution channels:

```text
Browser sandbox
  Canvas widgets
  demo datasets
  DuckDB-WASM / Pyodide / JS WorkGraphs
  local-first drafts and artifacts

Local runner
  local repo access
  git / shell / pnpm test / dbt run / dbt test
  private credentials
  power-user WorkGraph verification

Remote runner
  team/VPC execution
  shared warehouse access
  scheduled verification
  long-running data jobs
```

The web app should send typed commands to runners rather than arbitrary shell strings. Example command
surface:

```text
runVerification(issueId, workGraphId)
runTests(repoPath, scope)
runDbt(modelSelector)
runSql(warehouseProfile, queryPlan)
produceArtifact(canvasWidgetId)
```

The runner owns the capability policy:

```text
filesystem allowlist
command allowlist
warehouse profile allowlist
runtime / memory limits
artifact output policy
human approval gates
```

### Follow-up: sandbox and runner choice

Recorded 2026-06-07 from follow-up discussion. This is still product/solution-layer direction, not
a substrate, protocol, package API, or D-numbered architectural lock.

The sandbox choice splits into UI rendering trust and execution trust. GraphReFly Canvas itself, plus
trusted built-in widget packs such as table, chart, metric card, validation panel, input form, and
narrative answer card, should render directly in the host web app. A sandboxed iframe is only the
default for untrusted executable UI: AI-generated widgets, pasted custom components, and marketplace
widgets. The binding contract should be iframe-compatible from the start:

```text
node data -> component props
component events -> validated boundary/input node
```

Generated or pasted widgets can start in iframe preview/runtime, then optionally be promoted to
project-trusted code after user/team review. Promotion means they can join the normal host bundle or
trusted component pack. The product should not make "100 widgets = 100 iframes" the normal case;
most high-frequency widgets should be trusted built-ins, and untrusted widgets may be virtualized,
grouped by package/trust policy, or rendered as snapshots when off-screen.

Runner sandbox is separate from UI sandbox. The browser must not execute arbitrary local code or
shell commands. Real verification work should run through typed commands sent to a local or remote
runner:

```text
runVerification(issueId, workGraphId)
runTests(repoPath, scope)
runDbt(modelSelector)
runSql(warehouseProfile, queryPlan)
produceArtifact(canvasWidgetId)
```

The web product should not require a local app before first use. The entry path is progressive:

```text
Web-only Canvas
  demo data / sample WorkGraphs / Canvas / topology lens / built-in widgets

Cloud demo runner
  controlled templates and demo datasets, no arbitrary customer code or secrets

Local runner
  optional power-user capability for local repo, dbt, tests, files, and private credentials

Managed secure runner
  later paid/team infrastructure with login, RBAC, secrets, audit, and stronger isolation
```

For a local runner, the desired ergonomics are: web app remains the main product, a local CLI or
daemon is connected only when a task needs local capabilities, the user authorizes one workspace or
repo allowlist, and every risky action is shown as a typed approval rather than a raw shell string.
Artifacts, logs, test results, dbt outputs, screenshots, and query evidence return into WorkGraph
evidence nodes instead of living only in a terminal.

For remote execution, the recommended first serious self-hosted isolation direction is OCI/Docker
API plus gVisor/runsc or Kubernetes RuntimeClass with gVisor. This keeps image/tool compatibility
for Python, Node, dbt, git, and CI-like tasks while adding a stronger syscall boundary than default
runc. Kata Containers and Firecracker/microVMs remain enterprise/multi-tenant isolation upgrades,
not MVP blockers. E2B, Daytona, Sandbox0, nsjail, bubblewrap, and Wasmtime/WASI are relevant
evaluation targets:

- E2B / Daytona / Sandbox0: AI-agent sandbox platforms worth prototyping or adapting.
- gVisor/runsc: default remote-runner v1 candidate.
- Kata Containers / Firecracker: stronger isolation tier for hosted multi-tenant execution.
- nsjail / bubblewrap: lightweight local or single-machine process sandbox candidates.
- Wasmtime/WASI: good for small capability-style plugins or pure compute, not full repo/dbt runs.

Product conclusion: do not make strong login, Kubernetes, or gVisor a prerequisite for GraphReFly
Canvas v0. Build the web Canvas and demo/cloud-safe flows first, add optional local runner for
private local work, and defer hosted secure runner infrastructure until the product proves that
users want managed execution.

## FOLLOW-UP: DATA-QUERY FIRST CUT AND ANALYSIS CHAIN

Recorded 2026-06-08 from follow-up discussion. This narrows the first product proof, but remains
solution-layer direction only. It is not a protocol change, D-numbered decision, package API lock, or
implementation approval.

The first concrete deliverable should be `solutions/data-query`, not a full Canvas product and not an
external semantic-layer runtime. The first proof should use local DuckDB/CSV so the team can validate
the analysis experience, topology shape, and evidence artifact without waiting on enterprise
connectors, warehouse auth, or semantic-runtime integration.

The semantic-layer principle is:

> **Wrap, do not own.**

GraphReFly should not rebuild dbt Semantic Layer, Cube, Snowflake semantic views, Wren MDL, BigQuery
semantic tooling, or future warehouse-native metric engines. The data-query solution owns the
inspectable analysis topology, evidence ledger, verification chain, and promotion path. It consumes
semantic context through adapter-shaped nodes:

```text
localSemanticContext / duckdbCsvContext        (first proof)
dbtSemanticContext / cubeSemanticContext       (later wrappers)
snowflakeSemanticContext / bigQueryContext     (later wrappers)
```

The term **analysis chain** means a graph-shaped evidence trail from a business question to a
trusted answer:

```text
question
  -> clarifyIntent
  -> resolveMetric / resolveEntity / resolveGrain
  -> selectSource
  -> buildQueryPlan
  -> generateSql
  -> runDuckDB
  -> profileResult
  -> validateChecks
  -> explainAnswer
  -> assembleReport
  -> approveOrRevise
  -> saveAnalysisGraph
```

It is called a chain for product language, but it should be implemented and presented as a graph
spine with sidecar evidence:

```text
semantic context -> resolveMetric
schema catalog   -> selectSource / buildQueryPlan
sample rows      -> profileResult
business notes   -> validateChecks / explainAnswer

runDuckDB
  -> sql text
  -> result table
  -> execution trace
  -> source files used

validateChecks
  -> freshness
  -> row-count drift
  -> schema drift
  -> metric reconciliation
  -> business-rule assertions
```

The first example should be an `AnalysisGraph`. This is an example / solution bundle name, not a new
core graph type or verb. Its purpose is to make "every data answer comes with a graph" concrete:

```text
AnalysisGraph
  question
  semanticContext
  queryPlan
  sql
  result
  profile
  checks
  evidence
  answer
  report
```

Each output should have visible provenance. `answer` says the conclusion; `evidence` says why the
answer is believable; `checks` say what could be wrong; `sql` says what ran; `profile` says whether
the result data looks sane; `semanticContext` says which business definitions were used. The first
local proof can be small: a CSV fixture set, a tiny semantic-context object, one generated SQL query,
one result table, one validation panel, and one answer card. The differentiator is that opening the
topology lets the user walk backward from the answer to the metric definition, SQL, source files,
row profile, and verification checks.

## OPEN QUESTIONS

1. **Vertical packaging:** resolved direction for the first proof = `solutions/data-query` starter
   kit. Canvas remains the mother product direction, but not the first concrete deliverable.
2. **Integration order:** resolved direction for the first proof = local DuckDB/CSV. dbt/Cube/
   Snowflake/BigQuery are later wrappers under the "wrap, do not own" semantic-layer principle.
3. **Verification baseline:** what minimum verification set makes the demo feel differentiated:
   freshness, row-count drift, schema drift, metric reconciliation, sample trace, or all of them?
4. **Promotion target:** should "promote to ETL" first export a dbt model, a scheduled graph, a
   notebook, a dashboard/report, or just a saved reusable graph?
5. **Canvas form:** is this wedge better as a standalone web PWA, an internal demo host, or an
   embeddable component that later powers several vertical packs?
6. **Sandbox/runner boundary:** resolved direction in the follow-up above; concrete provider choice
   remains implementation-time evaluation, but the product boundary is web-first plus optional
   local/remote typed-command runners.

## STATUS

Captured as product strategy / solution-layer direction only. No D-number minted, no spec amended,
no implementation started.
