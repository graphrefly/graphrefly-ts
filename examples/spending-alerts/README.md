# spending-alerts

This directory contains two different examples. The original five-hop pipeline
explains how an anomalous transaction produces an alert message. The private Causal
integration demonstrates admission, retained obligations and graded consumption
with an **offline simulated writer**. Neither command writes a real inbox.

## Original five-hop pipeline

```sh
pnpm --filter @graphrefly-examples/spending-alerts start
```

```text
txFeed → anomalyScore → thresholdGate → reasonFactors → alertMessage
             ↑
      vendorStats + userProfile
```

The original [pipeline](pipeline.ts) uses
`renderSnapshot(graph, { explain: { from: "txFeed", to: "alertMessage" } })` to explain
its dependency chain. It does not provide the complete Causal admission and host
lifecycle proof described below.

## Private Causal integration

### Choose the boundary you already have

These helpers are consumer-private source imports, **not published package
subpaths**. Start with the object supplied to your component:

| You already have | Read this contract first | Read implementation details when |
|---|---|---|
| An existing `SpendingAlertsView` and a render callback | [`mountSpendingView`](causal-view-binding.ts): five latest port values, explicit `unavailable` ports, observation cleanup | You need a different observation policy; the [ordinary panel](causal-ordinary-panel.ts) shows a consumer |
| A Graph and prepared creation inputs | [`spendingAlertsFor`](causal-entry.ts): immutable defaults, per-compose overrides and returned view/capabilities | You also own input preparation or the executing host; follow [inputs](causal-inputs.ts) or [host](causal-focused-host.ts) for those responsibilities |
| Issued capabilities, their owning Graph and expected binding | [`assertCausalCapabilities`](../../packages/ts/src/solutions/causal-occurrence/capabilities.ts): issued-object, Graph, binding and lineage validation | You implement capability construction; the [role examples](causal-audience.examples.ts) show consumption |
| The owning Graph and a running instance | [Inspect one instance in a shared graph](#inspect-one-instance-in-a-shared-graph): full structure plus that instance's host and retained evidence | You are tracing a specific readiness, admission or outcome dependency |

Using an existing view does not require reconstructing its input facts, permission
sources or host. Using prepared inputs does not require implementing their
creation. A capability validation failure must be handled before passing the
capabilities to a recipient; a structural copy is not an issued object. The
[observation meanings below](#interpret-observations-accurately) apply to all of
these roles, including unavailable values and the limits of lifecycle readiness.

The complete demo below is for application ownership and lifecycle tracing. Its
fixture setup and simulated writer are not prerequisites for displaying a view
or consuming already-issued capabilities.

### Run the complete application demo

Run from the repository root:

```sh
node --import tsx examples/spending-alerts/causal-graded-demo.ts
```

The output contains the complete graph plus a `composition` summary. It runs two
instances, A and B, in the same Graph: A waits for its simulated result while the
panel switches to B; B succeeds without settling A; A then completes while its
panel is detached, and reconnecting does not write again. Expect
`aPendingAfterB: 1`, `bSucceededWhileAPending: "succeeded"` and
`writes: { "a": 1, "b": 1 }`. `evidenceNavigation` connects each actual publication
to its request, admission, outcome and fixture verification reference. These are
executed assertions, not a human usability experiment.

These are consumer-private source imports, **not published package subpaths**.
The fixture oracle supplies independent expected results for this finite example;
it is not a production verification service. The writer simulates completion in
memory. Input messages in the demo are test-boundary facts, not new public
feed/publish/approve methods.

The application creates five actual input Nodes in four groups:

| Input group | Explicit source responsibility |
|---|---|
| evaluations | Immutable evaluation pack, arrivals and current input/policy facts |
| verification | Receipt from the independent fixture verifier, bound to the evaluated material |
| localAuthority | Permission grants, logical tick and stop facts; no default approval |
| inbox | The separately prepared `OfflineAlertResource` with its exact binding |

It then calls `spendingAlertsFor(graph, { name: "alerts" }).compose(inputs)`.
Configuration allocates no graph nodes; compose creates a complete runtime.
Defaults are immutable, diagnostics defaults to off, and local overrides only
select name/diagnostics. Distinct instances use distinct names, input Nodes and
resource bindings. A name is not an authorization token. Changing `name` does not
clone input Nodes, create an independent resource or rewrite its binding; the
application prepares and supplies those separately. Sharing immutable defaults
does not imply sharing a running instance or its resource.

Display components receive only the original `.view`; frameworks pass the original
identity/execution/retained capabilities; maintainers inspect the same Graph.
Showing an identity subset does not remove lifecycle or retained-evidence nodes.
Capabilities have no arbitrary I/O execution method. The application keeps the
original owner and diagnostics. Fixed wiring passes the intended instance's
original references without introducing another identity registry.

## Inspect one instance in a shared graph

Keep the owning Graph and the original composed instance together. Start with
`renderSnapshot(graph)` without an explain-path filter; inspect the intended instance
through its own `inspect()`, view and capability references. The existing
[demo's evidence navigation](causal-graded-demo.ts) joins each publication to that
instance's retained request and outcome.

For an existing `graph` and its composed `app`, the read-only observations are:

```ts
const fullGraph = renderSnapshot(graph);
const host = app.inspect();
const publication = app.view.publication.cache;
const retainedQuiescence = app.capabilities.retained.retainedQuiescence.cache;
const authorityId = publication?.authorityId;
const authority = authorityId === undefined ? undefined : graph.find(authorityId);
```

Keep `fullGraph` when passing this inspection onward; counts alone discard the
nodes and edges needed to investigate it. In a graph containing several instances,
do not select the first node ending in `/causal/authority`: it may belong to a
different instance. Here the exact ID comes from this instance's publication.
Before that publication exists, this navigation has no authority ID; leave it
unavailable rather than selecting another instance's node. Structural presence
alone does not establish permission, current evidence or successful completion.

The [host](causal-focused-host.ts) retains request/admission/outcome records and
publishes outcome facts into the graph. Its diagnostics are therefore not the
only place a result can appear: the [publication](causal-publication.ts) also
projects graph-held evidence. Keep the request references when correlating these
views. These separate reads are not an atomic graph-and-host snapshot, and a
missing publication does not mean that no request was submitted. Readiness and
unknown outcomes have the meanings below; inspecting them does not invoke
transport, close the instance or recover an outstanding obligation.

## Interpret observations accurately

| Observation | Meaning |
|---|---|
| Missing value or ERROR/INVALIDATE | No current usable fact on that port; do not retain the old displayed value |
| Startup says started | The instance started; it does not prove authorization, success or run completion |
| Assessment flags a transaction | The business condition is met; evidence and permission are still required |
| Publication says succeeded | That exact request reports success in the simulated writer; other obligations and coverage remain separate |
| Coverage/issues | Facts for their associated scope; the five latest port values are not an atomic snapshot |
| Panel detach | Observation stops; the running instance retains outstanding obligations |
| Application `runEndReady` / `inspect().normalEndReady` | Current graph/host readiness conditions, not proof that lifecycle termination or resource release occurred |

For integrators, this host supports at most 64 retained distinct request records
per owned epoch, including refusals, and one in-flight write. A busy or exhausted
write budget produces an exact cancelled/no-submit result; there is no queue or
automatic retry. An unknown or reconciliation-required outcome is not success or
proof of no submission, and it prevents normal-end readiness. The application
must preserve those records instead of treating panel cleanup as recovery.

The ordinary panel does not poll diagnostics or claim that the whole run ended.
The protocol has no END message: business stop, node COMPLETE and run termination
are distinct. Retention remains bounded by the existing contract, not by whether
someone is viewing the graph. The demo's final forced test cleanup does not prove
normal lifecycle completion.

The private value binding clears stale values on INVALIDATE and ERROR. The existing
public `subscribeNodeValues` adapter currently ignores INVALIDATE, so it is not a
direct substitute for this particular view contract.

## Inspect code changes and evidence

Follow the actual request, admission and outcome references in the demo output to
the running graph. Then distinguish these three questions:

| Question | Evidence required |
|---|---|
| Did this node's implementation change despite unchanged ID/edges? | Revision-bound source mapping within its declared coverage |
| Who changed it? | Separate provenance; an implementation digest alone gives no attribution |
| Which consequences remain unchanged? | Independent verification bound to the current revision and inputs |

Missing source binding means uncovered; missing provenance means unknown.
The demo does not attest the loaded production source.

The example and offline tests demonstrate available composition paths, not a
human usability result or superiority to a complete plain-code host. B121's real
inbox qualification, independent human/agent comparisons and aggregate acceptance
remain separate.
