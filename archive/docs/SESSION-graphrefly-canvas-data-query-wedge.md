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

## OPEN QUESTIONS

1. **Vertical packaging:** should the first concrete deliverable be a `solutions/data-query` starter
   kit, an external GraphReFly Canvas app, or an embeddable canvas package with a data-query pack?
2. **Integration order:** dbt Semantic Layer first, Cube first, Snowflake/BigQuery first, or local
   DuckDB/CSV first for demo speed?
3. **Verification baseline:** what minimum verification set makes the demo feel differentiated:
   freshness, row-count drift, schema drift, metric reconciliation, sample trace, or all of them?
4. **Promotion target:** should "promote to ETL" first export a dbt model, a scheduled graph, a
   notebook, a dashboard/report, or just a saved reusable graph?
5. **Canvas form:** is this wedge better as a standalone web PWA, an internal demo host, or an
   embeddable component that later powers several vertical packs?

## STATUS

Captured as product strategy / solution-layer direction only. No D-number minted, no spec amended,
no implementation started.
