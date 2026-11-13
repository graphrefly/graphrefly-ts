# D809 generated node and group names

Authority: graphrefly R-naming@1, D809 / C-49. Root fixture pin: `f2e23490bafe94745f720da3ced5f0fff6fccd65` (local; publication pending).

## Contract and compatibility

Local node/id, module scope, group and mount names reject `::` with `name must not contain '::'`; otherwise leading/trailing `:` rejects with `name must not start or end with ':'`. Internal lone `:` and arbitrary caller spelling remain valid. Generated fixed segments use camelCase with `/` for composition. Defaults allocate the first available scope (`module`, `module1`, …), considering reserved, registered and retired namespaces. The mount separator remains `::`.

Function names, factory labels, recipe references and eligibility, wire identities, emitted measurement target/source defaults and persistence storage keys remain unchanged. Checkpoint format remains unchanged; there is no compatibility alias for previous generated ids. Core anonymous `factory#N` and graph-discovered `~factory#N` routes are outside this module naming contract.

## Verification receipt

Final source: `4082075438b7cbb0ddafffb1b817845c51490a647cfab4ec630a26932869ad6e` (291 non-test TS files, algorithm and per-file hashes in [the receipt](node-naming-d809-evidence.json)). Final full suite: 178 files / 2,915 tests passed, 1 file / 4 tests skipped; 14.55 s, load average 6.10 → 19.81. The admission-only staged snapshot separately passed 37 tests.

Final lint (including 15 package/example typechecks and test typecheck), build, generated-doc freshness, both shared runtime probes and the 325-test boundary slice passed. Nine source mutants fail their intended assertions, with controls passing; the late-restore mutant observes one validation and one factory call instead of zero. Full docs build (693 pages), missing-doc check, informational B49 correctness counters and Hermes bytecode/semantics passed immediately before the final edge-refusal ordering fix; those unaffected artifacts were reused. Final full tests and build were repeated after that fix.

No push was performed. The workflow pins the local root fixture commit above; hosted CI awaits publication. Full command, duration, load, mutation and diagnostic-attempt records are in [the structured receipt](node-naming-d809-evidence.json).

## Complete observed inventory

The same cold constructor catalogue was run against baseline `bb4fb462dc952941450f4347788db1228dce00ca` and the final local source. All 147 cases constructed successfully: 949 observed nodes, 254 renamed IDs. Every paired case retains node count, kind, quiet flag, factory label, full recipe object and dependency vector after mapping ids by construction order. Groups retain count. Explicit named prerequisite inputs are excluded; nested prerequisites constructed inside a fixture (for example a bridge used by an adapter) remain listed for transparent composition context.

The catalogue includes lazy collection binding/views and message-bus projections, so this table is not restricted to eager bundle construction. Raw captures and commands are recorded in the build receipt; the names below are observations, not a fixture echoed back as output.

The sole repeated-word qualifier retained by the scan is `runtimeStatus` under runtime prefixes: the same modules also expose distinct request `/status` and `/runStatus` roles. The causal fact projection `/quiescence` and branded lifecycle `/capability` are different nodes. No nodes are merged or removed.

## Deferred structure analysis

TS wireBridge has 11 graph nodes; Python keeps its distinct core/bytes/frame/value layout. TS ackDriver has events/commands/issues/status and a private ownership group; Python has core/timeouts/issues/status, Rust has no separate driver. Rust cascading cache includes an additional explicit ledger whereas TS stores driver state within the events node; Python lacks that module. Work-item seeds and causal occurrence are TS-only. These differences require ownership, scheduling and checkpoint analysis before structural unification.

TS collection tail/slice/scan/byPrimary and mergeReactiveLogs return core helper nodes discovered as synthetic graph routes; Rust registers equivalent helper nodes explicitly. Registering TS helpers would change graph structure and lifecycle behavior, so this change does not do so. Causal `/quiescence` is retained domain evidence projected from authority; `/capability` brands that stream with graph/binding ownership for lifecycle helpers. Any future merging must account for that semantic boundary.

## Per-module before/after mapping

### lazyCollectionMethods

| Kind | Before | After |
|---|---|---|
| Node | `reactiveList.delta#0` | `reactiveList/delta` |
| Node | `reactiveList.request#1` | `reactiveList/request` |
| Node | `reactiveList.snapshot#2` | `reactiveList/snapshot` |
| Node | `reactiveList.bindSource#3` | `reactiveList/bind0` |
| Node | `reactiveList.capacityPolicy#4` | `reactiveList/capacityPolicy` |
| Node | `reactiveMap.intent#5` | `reactiveMap/intent` |
| Node | `reactiveMap.apply#6` | `reactiveMap/apply` |
| Node | `reactiveMap.request#7` | `reactiveMap/request` |
| Node | `reactiveMap.snapshotPrep#8` | `reactiveMap/snapshotPrep` |
| Node | `reactiveMap.delta#9` | `reactiveMap/delta` |
| Node | `reactiveMap.snapshot#10` | `reactiveMap/snapshot` |
| Node | `reactiveMap.select.delta#11` | `reactiveMap/select0/delta` |
| Node | `reactiveMap.select.request#12` | `reactiveMap/select0/request` |
| Node | `reactiveMap.select.snapshot#13` | `reactiveMap/select0/snapshot` |
| Node | `reactiveMap.select.delta#14` | `reactiveMap/select1/delta` |
| Node | `reactiveMap.select.request#15` | `reactiveMap/select1/request` |
| Node | `reactiveMap.select.snapshot#16` | `reactiveMap/select1/snapshot` |
| Node | `reactiveIndex.delta#17` | `reactiveIndex/delta` |
| Node | `reactiveIndex.request#18` | `reactiveIndex/request` |
| Node | `reactiveIndex.snapshot#19` | `reactiveIndex/snapshot` |
| Node | `reactiveIndex.range.delta#20` | `reactiveIndex/range0/delta` |
| Node | `reactiveIndex.range.request#21` | `reactiveIndex/range0/request` |
| Node | `reactiveIndex.range.snapshot#22` | `reactiveIndex/range0/snapshot` |
| Node | `reactiveIndex.range.delta#23` | `reactiveIndex/range1/delta` |
| Node | `reactiveIndex.range.request#24` | `reactiveIndex/range1/request` |
| Node | `reactiveIndex.range.snapshot#25` | `reactiveIndex/range1/snapshot` |
| Node | `reactiveLog.delta#26` | `reactiveLog/delta` |
| Node | `reactiveLog.request#27` | `reactiveLog/request` |
| Node | `reactiveLog.snapshot#28` | `reactiveLog/snapshot` |
| Node | `reactiveLog.page.delta#29` | `reactiveLog/page0/delta` |
| Node | `reactiveLog.page.request#30` | `reactiveLog/page0/request` |
| Node | `reactiveLog.page.snapshot#31` | `reactiveLog/page0/snapshot` |
| Node | `reactiveLog.page.delta#32` | `reactiveLog/page1/delta` |
| Node | `reactiveLog.page.request#33` | `reactiveLog/page1/request` |
| Node | `reactiveLog.page.snapshot#34` | `reactiveLog/page1/snapshot` |
| Group | `reactiveMap.select` | `reactiveMap/select0` |
| Group | `reactiveMap.select` | `reactiveMap/select1` |
| Group | `reactiveIndex.range` | `reactiveIndex/range0` |
| Group | `reactiveIndex.range` | `reactiveIndex/range1` |
| Group | `reactiveLog.page` | `reactiveLog/page0` |
| Group | `reactiveLog.page` | `reactiveLog/page1` |

### lazyMessageBusProjections

| Kind | Before | After |
|---|---|---|
| Node | `messageBus/publish` | `messageBus/publish` |
| Node | `messageBus/commands` | `messageBus/commands` |
| Node | `messageBus/runtime` | `messageBus/runtime` |
| Node | `messageBus/messages` | `messageBus/messages` |
| Node | `messageBus/status` | `messageBus/status` |
| Node | `messageBus/issues` | `messageBus/issues` |
| Node | `messageBus/jobs/topic/request` | `messageBus/topics/jobs/request` |
| Node | `messageBus/jobs/topic` | `messageBus/topics/jobs` |
| Node | `messageBus/catalog/request` | `messageBus/catalog/request` |
| Node | `messageBus/catalog` | `messageBus/catalog` |
| Node | `messageBus/deadLetter/request` | `messageBus/deadLetter/request` |
| Node | `messageBus/deadLetter` | `messageBus/deadLetter` |
| Node | `messageBus/jobs/worker/available/request` | `messageBus/subscriptions/jobs/worker/available/request` |
| Node | `messageBus/jobs/worker/available` | `messageBus/subscriptions/jobs/worker/available` |
| Node | `messageBus/jobs/worker/cursor` | `messageBus/subscriptions/jobs/worker/cursor` |
| Node | `messageBus/jobs/toTopic` | `messageBus/topics/jobs/toTopic` |

### nodeCanvasTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-node-canvas-measure-capability` | `text/context` |
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### causalOccurrenceBundle

| Kind | Before | After |
|---|---|---|
| Node | `causalOccurrence/startup` | `causalOccurrence/startup` |
| Node | `causalOccurrence/input/occurrences` | `causalOccurrence/input/occurrences` |
| Node | `causalOccurrence/input/admissions` | `causalOccurrence/input/admissions` |
| Node | `causalOccurrence/input/branch-terminals` | `causalOccurrence/input/branchTerminals` |
| Node | `causalOccurrence/input/effect-proposals` | `causalOccurrence/input/effectProposals` |
| Node | `causalOccurrence/input/effect-admissions` | `causalOccurrence/input/effectAdmissions` |
| Node | `causalOccurrence/input/effect-outcomes` | `causalOccurrence/input/effectOutcomes` |
| Node | `causalOccurrence/input/evidence` | `causalOccurrence/input/evidence` |
| Node | `causalOccurrence/input/watermarks` | `causalOccurrence/input/watermarks` |
| Node | `causalOccurrence/arrivals` | `causalOccurrence/arrivals` |
| Node | `causalOccurrence/authority` | `causalOccurrence/authority` |
| Node | `causalOccurrence/release-candidates` | `causalOccurrence/releaseCandidates` |
| Node | `causalOccurrence/released` | `causalOccurrence/released` |
| Node | `causalOccurrence/currentness` | `causalOccurrence/currentness` |
| Node | `causalOccurrence/terminals` | `causalOccurrence/terminals` |
| Node | `causalOccurrence/conservation` | `causalOccurrence/conservation` |
| Node | `causalOccurrence/coverage` | `causalOccurrence/coverage` |
| Node | `causalOccurrence/quiescence` | `causalOccurrence/quiescence` |
| Node | `causalOccurrence/issues` | `causalOccurrence/issues` |
| Node | `causalOccurrence/committed-effects` | `causalOccurrence/committedEffects` |
| Node | `causalOccurrence/causal-quiescence` | `causalOccurrence/capability` |

### admissionHandoff

| Kind | Before | After |
|---|---|---|
| Node | `admissionHandoff/correlation` | `admissionHandoff/correlation` |
| Node | `admissionHandoff/admitted` | `admissionHandoff/admitted` |
| Node | `admissionHandoff/accepted` | `admissionHandoff/accepted` |
| Node | `admissionHandoff/rejected` | `admissionHandoff/rejected` |
| Node | `admissionHandoff/status` | `admissionHandoff/status` |
| Node | `admissionHandoff/issues` | `admissionHandoff/issues` |
| Node | `admissionHandoff/cursor` | `admissionHandoff/cursor` |

### agenticMemoryApplicationEvidenceStoreFrameBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryApplicationEvidenceStoreFrame/projection` | `agenticMemoryApplicationEvidenceStoreFrame/projection` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/priorEvidence` | `agenticMemoryApplicationEvidenceStoreFrame/prior` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/evidenceFacts` | `agenticMemoryApplicationEvidenceStoreFrame/facts` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/status` | `agenticMemoryApplicationEvidenceStoreFrame/status` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/issues` | `agenticMemoryApplicationEvidenceStoreFrame/issues` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/audit` | `agenticMemoryApplicationEvidenceStoreFrame/audit` |
| Node | `agenticMemoryApplicationEvidenceStoreFrame/cursor` | `agenticMemoryApplicationEvidenceStoreFrame/cursor` |

### agenticMemoryBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemory/projection` | `agenticMemory/projection` |
| Node | `agenticMemory/records` | `agenticMemory/records` |
| Node | `agenticMemory/fragments` | `agenticMemory/fragments` |
| Node | `agenticMemory/status` | `agenticMemory/status` |
| Node | `agenticMemory/errors` | `agenticMemory/errors` |
| Node | `agenticMemory/retrieval/snapshot` | `agenticMemory/retrieval/snapshot` |
| Node | `agenticMemory/retrieval/fragments` | `agenticMemory/retrieval/fragments` |
| Node | `agenticMemory/retrieval/indexed` | `agenticMemory/retrieval/indexed` |
| Node | `agenticMemory/retrieval/ranked` | `agenticMemory/retrieval/ranked` |
| Node | `agenticMemory/retrieval/status` | `agenticMemory/retrieval/status` |
| Node | `agenticMemory/retrieval/errors` | `agenticMemory/retrieval/errors` |
| Node | `agenticMemory/retrieval/cursor` | `agenticMemory/retrieval/cursor` |
| Node | `agenticMemory/sources` | `agenticMemory/sources` |
| Node | `agenticMemory/context` | `agenticMemory/context` |

### agenticMemoryCommittedFactReadMaterializationBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryCommittedFactReadMaterialization/projection` | `agenticMemoryCommittedFactReadMaterialization/projection` |
| Node | `agenticMemoryCommittedFactReadMaterialization/records` | `agenticMemoryCommittedFactReadMaterialization/records` |
| Node | `agenticMemoryCommittedFactReadMaterialization/priorEvidence` | `agenticMemoryCommittedFactReadMaterialization/priorEvidence` |
| Node | `agenticMemoryCommittedFactReadMaterialization/evidence` | `agenticMemoryCommittedFactReadMaterialization/evidence` |
| Node | `agenticMemoryCommittedFactReadMaterialization/status` | `agenticMemoryCommittedFactReadMaterialization/status` |
| Node | `agenticMemoryCommittedFactReadMaterialization/issues` | `agenticMemoryCommittedFactReadMaterialization/issues` |
| Node | `agenticMemoryCommittedFactReadMaterialization/audit` | `agenticMemoryCommittedFactReadMaterialization/audit` |
| Node | `agenticMemoryCommittedFactReadMaterialization/cursor` | `agenticMemoryCommittedFactReadMaterialization/cursor` |

### agenticMemoryConsolidationApplicationBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryConsolidationApplication/input` | `agenticMemoryPipeline/input` |
| Node | `agenticMemoryConsolidationApplication/consolidation/projection` | `agenticMemoryPipeline/consolidation/projection` |
| Node | `agenticMemoryConsolidationApplication/consolidation/results` | `agenticMemoryPipeline/consolidation/results` |
| Node | `agenticMemoryConsolidationApplication/consolidation/proposedRecordDrafts` | `agenticMemoryPipeline/consolidation/drafts` |
| Node | `agenticMemoryConsolidationApplication/consolidation/recordProposals` | `agenticMemoryPipeline/consolidation/proposals` |
| Node | `agenticMemoryConsolidationApplication/consolidation/commands` | `agenticMemoryPipeline/consolidation/commands` |
| Node | `agenticMemoryConsolidationApplication/consolidation/status` | `agenticMemoryPipeline/consolidation/status` |
| Node | `agenticMemoryConsolidationApplication/consolidation/errors` | `agenticMemoryPipeline/consolidation/errors` |
| Node | `agenticMemoryConsolidationApplication/consolidation/cursor` | `agenticMemoryPipeline/consolidation/cursor` |
| Node | `agenticMemoryConsolidationApplication/admission-input/left` | `agenticMemoryPipeline/admissionInput/left` |
| Node | `agenticMemoryConsolidationApplication/admission-input/right` | `agenticMemoryPipeline/admissionInput/right` |
| Node | `agenticMemoryConsolidationApplication/admission-input/arrivals` | `agenticMemoryPipeline/admissionInput/arrivals` |
| Node | `agenticMemoryConsolidationApplication/admission-input/matched` | `agenticMemoryPipeline/admissionInput/matched` |
| Node | `agenticMemoryConsolidationApplication/admission-input` | `agenticMemoryPipeline/admissionInput` |
| Node | `agenticMemoryConsolidationApplication/admission/projection` | `agenticMemoryPipeline/admission/projection` |
| Node | `agenticMemoryConsolidationApplication/admission/admissions` | `agenticMemoryPipeline/admission/admissions` |
| Node | `agenticMemoryConsolidationApplication/admission/admitted` | `agenticMemoryPipeline/admission/admitted` |
| Node | `agenticMemoryConsolidationApplication/admission/rejected` | `agenticMemoryPipeline/admission/rejected` |
| Node | `agenticMemoryConsolidationApplication/admission/needsReview` | `agenticMemoryPipeline/admission/needsReview` |
| Node | `agenticMemoryConsolidationApplication/admission/status` | `agenticMemoryPipeline/admission/status` |
| Node | `agenticMemoryConsolidationApplication/admission/issues` | `agenticMemoryPipeline/admission/issues` |
| Node | `agenticMemoryConsolidationApplication/admission/audit` | `agenticMemoryPipeline/admission/audit` |
| Node | `agenticMemoryConsolidationApplication/admission/cursor` | `agenticMemoryPipeline/admission/cursor` |
| Node | `agenticMemoryConsolidationApplication/application-input/left` | `agenticMemoryPipeline/applicationInput/left` |
| Node | `agenticMemoryConsolidationApplication/application-input/right` | `agenticMemoryPipeline/applicationInput/right` |
| Node | `agenticMemoryConsolidationApplication/application-input/arrivals` | `agenticMemoryPipeline/applicationInput/arrivals` |
| Node | `agenticMemoryConsolidationApplication/application-input/matched` | `agenticMemoryPipeline/applicationInput/matched` |
| Node | `agenticMemoryConsolidationApplication/application-input` | `agenticMemoryPipeline/applicationInput` |
| Node | `agenticMemoryConsolidationApplication/application/projection` | `agenticMemoryPipeline/application/projection` |
| Node | `agenticMemoryConsolidationApplication/application/records` | `agenticMemoryPipeline/application/records` |
| Node | `agenticMemoryConsolidationApplication/application/appliedRecords` | `agenticMemoryPipeline/application/appliedRecords` |
| Node | `agenticMemoryConsolidationApplication/application/applicationDecisions` | `agenticMemoryPipeline/application/decisions` |
| Node | `agenticMemoryConsolidationApplication/application/status` | `agenticMemoryPipeline/application/status` |
| Node | `agenticMemoryConsolidationApplication/application/operationStatuses` | `agenticMemoryPipeline/application/operationStatuses` |
| Node | `agenticMemoryConsolidationApplication/application/issues` | `agenticMemoryPipeline/application/issues` |
| Node | `agenticMemoryConsolidationApplication/application/audit` | `agenticMemoryPipeline/application/audit` |
| Node | `agenticMemoryConsolidationApplication/application/cursor` | `agenticMemoryPipeline/application/cursor` |

### agenticMemoryConsolidationBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryConsolidation/projection` | `agenticMemoryConsolidation/projection` |
| Node | `agenticMemoryConsolidation/results` | `agenticMemoryConsolidation/results` |
| Node | `agenticMemoryConsolidation/proposedRecordDrafts` | `agenticMemoryConsolidation/drafts` |
| Node | `agenticMemoryConsolidation/recordProposals` | `agenticMemoryConsolidation/proposals` |
| Node | `agenticMemoryConsolidation/commands` | `agenticMemoryConsolidation/commands` |
| Node | `agenticMemoryConsolidation/status` | `agenticMemoryConsolidation/status` |
| Node | `agenticMemoryConsolidation/errors` | `agenticMemoryConsolidation/errors` |
| Node | `agenticMemoryConsolidation/cursor` | `agenticMemoryConsolidation/cursor` |

### agenticMemoryContextPackingBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryContextPacking/projection` | `agenticMemoryPacking/projection` |
| Node | `agenticMemoryContextPacking/packedContext` | `agenticMemoryPacking/context` |
| Node | `agenticMemoryContextPacking/status` | `agenticMemoryPacking/status` |
| Node | `agenticMemoryContextPacking/errors` | `agenticMemoryPacking/errors` |
| Node | `agenticMemoryContextPacking/cursor` | `agenticMemoryPacking/cursor` |

### agenticMemoryDurabilityGateBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryDurabilityGate/projection` | `agenticMemoryDurabilityGate/projection` |
| Node | `agenticMemoryDurabilityGate/result` | `agenticMemoryDurabilityGate/result` |
| Node | `agenticMemoryDurabilityGate/status` | `agenticMemoryDurabilityGate/status` |
| Node | `agenticMemoryDurabilityGate/downstreamAdvance` | `agenticMemoryDurabilityGate/downstreamAdvance` |
| Node | `agenticMemoryDurabilityGate/issues` | `agenticMemoryDurabilityGate/issues` |
| Node | `agenticMemoryDurabilityGate/audit` | `agenticMemoryDurabilityGate/audit` |
| Node | `agenticMemoryDurabilityGate/cursor` | `agenticMemoryDurabilityGate/cursor` |

### agenticMemoryKgProjectionBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryKgProjection/projection` | `agenticMemoryKgProjection` |
| Node | `agenticMemoryKgProjection/assertions` | `agenticMemoryKgProjection/assertions` |
| Node | `agenticMemoryKgProjection/status` | `agenticMemoryKgProjection/status` |
| Node | `agenticMemoryKgProjection/errors` | `agenticMemoryKgProjection/errors` |
| Node | `agenticMemoryKgProjection/cursor` | `agenticMemoryKgProjection/cursor` |

### agenticMemoryMaterializedFactLogBootstrapBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryMaterializedFactLogBootstrap/projection` | `agenticMemoryMaterializedFactLogBootstrap/projection` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/bootstrapInput` | `agenticMemoryMaterializedFactLogBootstrap/input` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/records` | `agenticMemoryMaterializedFactLogBootstrap/records` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/priorEvidence` | `agenticMemoryMaterializedFactLogBootstrap/priorEvidence` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/evidence` | `agenticMemoryMaterializedFactLogBootstrap/evidence` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/status` | `agenticMemoryMaterializedFactLogBootstrap/status` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/issues` | `agenticMemoryMaterializedFactLogBootstrap/issues` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/audit` | `agenticMemoryMaterializedFactLogBootstrap/audit` |
| Node | `agenticMemoryMaterializedFactLogBootstrap/cursor` | `agenticMemoryMaterializedFactLogBootstrap/cursor` |

### agenticMemoryRecordAdmissionBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordAdmission/projection` | `agenticMemoryRecordAdmission/projection` |
| Node | `agenticMemoryRecordAdmission/admissions` | `agenticMemoryRecordAdmission/admissions` |
| Node | `agenticMemoryRecordAdmission/admitted` | `agenticMemoryRecordAdmission/admitted` |
| Node | `agenticMemoryRecordAdmission/rejected` | `agenticMemoryRecordAdmission/rejected` |
| Node | `agenticMemoryRecordAdmission/needsReview` | `agenticMemoryRecordAdmission/needsReview` |
| Node | `agenticMemoryRecordAdmission/status` | `agenticMemoryRecordAdmission/status` |
| Node | `agenticMemoryRecordAdmission/issues` | `agenticMemoryRecordAdmission/issues` |
| Node | `agenticMemoryRecordAdmission/audit` | `agenticMemoryRecordAdmission/audit` |
| Node | `agenticMemoryRecordAdmission/cursor` | `agenticMemoryRecordAdmission/cursor` |

### agenticMemoryRecordAdmissionPolicySourceBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordAdmissionPolicySource/projection` | `agenticMemoryRecordAdmissionSource/projection` |
| Node | `agenticMemoryRecordAdmissionPolicySource/admissionPolicy` | `agenticMemoryRecordAdmissionSource/policy` |
| Node | `agenticMemoryRecordAdmissionPolicySource/status` | `agenticMemoryRecordAdmissionSource/status` |
| Node | `agenticMemoryRecordAdmissionPolicySource/issues` | `agenticMemoryRecordAdmissionSource/issues` |
| Node | `agenticMemoryRecordAdmissionPolicySource/audit` | `agenticMemoryRecordAdmissionSource/audit` |
| Node | `agenticMemoryRecordAdmissionPolicySource/cursor` | `agenticMemoryRecordAdmissionSource/cursor` |

### agenticMemoryRecordApplicationBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordApplication/projection` | `agenticMemoryRecordApplication/projection` |
| Node | `agenticMemoryRecordApplication/records` | `agenticMemoryRecordApplication/records` |
| Node | `agenticMemoryRecordApplication/appliedRecords` | `agenticMemoryRecordApplication/appliedRecords` |
| Node | `agenticMemoryRecordApplication/applicationDecisions` | `agenticMemoryRecordApplication/decisions` |
| Node | `agenticMemoryRecordApplication/status` | `agenticMemoryRecordApplication/status` |
| Node | `agenticMemoryRecordApplication/operationStatuses` | `agenticMemoryRecordApplication/operationStatuses` |
| Node | `agenticMemoryRecordApplication/issues` | `agenticMemoryRecordApplication/issues` |
| Node | `agenticMemoryRecordApplication/audit` | `agenticMemoryRecordApplication/audit` |
| Node | `agenticMemoryRecordApplication/cursor` | `agenticMemoryRecordApplication/cursor` |

### agenticMemoryRecordApplicationEvidenceFactsBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordApplicationEvidenceFacts/projection` | `agenticMemoryRecordApplicationEvidenceFacts/projection` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/evidenceFacts` | `agenticMemoryRecordApplicationEvidenceFacts` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/priorEvidence` | `agenticMemoryRecordApplicationEvidenceFacts/prior` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/status` | `agenticMemoryRecordApplicationEvidenceFacts/status` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/issues` | `agenticMemoryRecordApplicationEvidenceFacts/issues` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/audit` | `agenticMemoryRecordApplicationEvidenceFacts/audit` |
| Node | `agenticMemoryRecordApplicationEvidenceFacts/cursor` | `agenticMemoryRecordApplicationEvidenceFacts/cursor` |

### agenticMemoryRecordApplicationPriorEvidenceBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordApplicationPriorEvidence/projection` | `agenticMemoryRecordApplicationPriorEvidence/projection` |
| Node | `agenticMemoryRecordApplicationPriorEvidence/priorEvidence` | `agenticMemoryRecordApplicationPriorEvidence` |
| Node | `agenticMemoryRecordApplicationPriorEvidence/status` | `agenticMemoryRecordApplicationPriorEvidence/status` |
| Node | `agenticMemoryRecordApplicationPriorEvidence/issues` | `agenticMemoryRecordApplicationPriorEvidence/issues` |
| Node | `agenticMemoryRecordApplicationPriorEvidence/audit` | `agenticMemoryRecordApplicationPriorEvidence/audit` |
| Node | `agenticMemoryRecordApplicationPriorEvidence/cursor` | `agenticMemoryRecordApplicationPriorEvidence/cursor` |

### agenticMemoryRecordMaterializerBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordMaterializer/projection` | `agenticMemoryRecordMaterializer/projection` |
| Node | `agenticMemoryRecordMaterializer/proposals` | `agenticMemoryRecordMaterializer/proposals` |
| Node | `agenticMemoryRecordMaterializer/candidateMaterials` | `agenticMemoryRecordMaterializer/candidateMaterials` |
| Node | `agenticMemoryRecordMaterializer/status` | `agenticMemoryRecordMaterializer/status` |
| Node | `agenticMemoryRecordMaterializer/issues` | `agenticMemoryRecordMaterializer/issues` |
| Node | `agenticMemoryRecordMaterializer/audit` | `agenticMemoryRecordMaterializer/audit` |
| Node | `agenticMemoryRecordMaterializer/cursor` | `agenticMemoryRecordMaterializer/cursor` |

### agenticMemoryRecordStoreFrameBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordStoreFrame/projection` | `agenticMemoryRecordStoreFrame/projection` |
| Node | `agenticMemoryRecordStoreFrame/records` | `agenticMemoryRecordStoreFrame/records` |
| Node | `agenticMemoryRecordStoreFrame/status` | `agenticMemoryRecordStoreFrame/status` |
| Node | `agenticMemoryRecordStoreFrame/issues` | `agenticMemoryRecordStoreFrame/issues` |
| Node | `agenticMemoryRecordStoreFrame/audit` | `agenticMemoryRecordStoreFrame/audit` |
| Node | `agenticMemoryRecordStoreFrame/cursor` | `agenticMemoryRecordStoreFrame/cursor` |

### agenticMemoryRecordUseGateBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecordUseGate/snapshot` | `agenticMemoryRecordUseGate/snapshot` |
| Node | `agenticMemoryRecordUseGate/allowedRecords` | `agenticMemoryRecordUseGate/allowedRecords` |
| Node | `agenticMemoryRecordUseGate/exclusions` | `agenticMemoryRecordUseGate/exclusions` |
| Node | `agenticMemoryRecordUseGate/status` | `agenticMemoryRecordUseGate/status` |
| Node | `agenticMemoryRecordUseGate/issues` | `agenticMemoryRecordUseGate/issues` |
| Node | `agenticMemoryRecordUseGate/audit` | `agenticMemoryRecordUseGate/audit` |
| Node | `agenticMemoryRecordUseGate/cursor` | `agenticMemoryRecordUseGate/cursor` |

### agenticMemoryRetentionBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRetention/projection` | `agenticMemoryRetention/projection` |
| Node | `agenticMemoryRetention/activeRecords` | `agenticMemoryRetention/activeRecords` |
| Node | `agenticMemoryRetention/archivedRecords` | `agenticMemoryRetention/archivedRecords` |
| Node | `agenticMemoryRetention/consolidationRequests` | `agenticMemoryRetention/requests` |
| Node | `agenticMemoryRetention/status` | `agenticMemoryRetention/status` |
| Node | `agenticMemoryRetention/errors` | `agenticMemoryRetention/errors` |
| Node | `agenticMemoryRetention/cursor` | `agenticMemoryRetention/cursor` |

### agenticWorkItemMemoryApplicationRecipeBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticWorkItemMemoryApplicationRecipe/input` | `agenticWorkItemMemoryRecipe/input` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/projection` | `agenticWorkItemMemoryRecipe/bridge/projection` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/scoreSignals` | `agenticWorkItemMemoryRecipe/bridge/scoreSignals` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/proposals` | `agenticWorkItemMemoryRecipe/bridge/proposals` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/status` | `agenticWorkItemMemoryRecipe/bridge/status` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/issues` | `agenticWorkItemMemoryRecipe/bridge/issues` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/audit` | `agenticWorkItemMemoryRecipe/bridge/audit` |
| Node | `agenticWorkItemMemoryApplicationRecipe/bridge/cursor` | `agenticWorkItemMemoryRecipe/bridge/cursor` |

### agenticWorkItemMemoryBridgeBundle

| Kind | Before | After |
|---|---|---|
| Node | `agenticWorkItemMemoryBridge/projection` | `agenticWorkItemMemoryBridge/projection` |
| Node | `agenticWorkItemMemoryBridge/scoreSignals` | `agenticWorkItemMemoryBridge/scoreSignals` |
| Node | `agenticWorkItemMemoryBridge/proposals` | `agenticWorkItemMemoryBridge/proposals` |
| Node | `agenticWorkItemMemoryBridge/status` | `agenticWorkItemMemoryBridge/status` |
| Node | `agenticWorkItemMemoryBridge/issues` | `agenticWorkItemMemoryBridge/issues` |
| Node | `agenticWorkItemMemoryBridge/audit` | `agenticWorkItemMemoryBridge/audit` |
| Node | `agenticWorkItemMemoryBridge/cursor` | `agenticWorkItemMemoryBridge/cursor` |

### agentRequestLedgerViews

| Kind | Before | After |
|---|---|---|
| Node | `agentRequests/views` | `agentRequests/views` |
| Node | `agentRequests/issues` | `agentRequests/issues` |
| Node | `agentRequests/audit` | `agentRequests/audit` |

### attachKeyedRateLimitAuthority

| Kind | Before | After |
|---|---|---|
| Node | `keyedRateLimitAuthority/events` | `keyedRateLimitAuthority/events` |
| Node | `keyedRateLimitAuthority/correlation-facts` | `keyedRateLimitAuthority/correlation` |
| Node | `keyedRateLimitAuthority/authority-requests` | `keyedRateLimitAuthority/requests` |
| Node | `keyedRateLimitAuthority/outcomes` | `keyedRateLimitAuthority/outcomes` |
| Node | `keyedRateLimitAuthority/status` | `keyedRateLimitAuthority/status` |
| Node | `keyedRateLimitAuthority/errors` | `keyedRateLimitAuthority/errors` |
| Node | `keyedRateLimitAuthority/cursor` | `keyedRateLimitAuthority/cursor` |
| Node | `keyedRateLimitAuthority/admission/ledger` | `keyedRateLimitAuthority/admission/ledger` |
| Node | `keyedRateLimitAuthority/admission/runtime` | `keyedRateLimitAuthority/admission/runtime` |
| Node | `keyedRateLimitAuthority/admission/admissions` | `keyedRateLimitAuthority/admission/admissions` |
| Node | `keyedRateLimitAuthority/admission/denials` | `keyedRateLimitAuthority/admission/denials` |
| Node | `keyedRateLimitAuthority/admission/status` | `keyedRateLimitAuthority/admission/status` |
| Node | `keyedRateLimitAuthority/admission/issues` | `keyedRateLimitAuthority/admission/issues` |
| Node | `keyedRateLimitAuthority/admission/audit` | `keyedRateLimitAuthority/admission/audit` |
| Node | `keyedRateLimitAuthority/admission/cursor` | `keyedRateLimitAuthority/admission/cursor` |

### attachToolProviderAdapterRuntime

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderAdapterRuntime/retentionPolicy` | `toolProviderAdapterRuntime/retentionPolicy` |
| Node | `toolProviderAdapterRuntime/outcomes` | `toolProviderAdapterRuntime/outcomes` |
| Node | `toolProviderAdapterRuntime/runStatus` | `toolProviderAdapterRuntime/runStatus` |
| Node | `toolProviderAdapterRuntime/status` | `toolProviderAdapterRuntime/status` |
| Node | `toolProviderAdapterRuntime/runtimeStatus` | `toolProviderAdapterRuntime/runtimeStatus` |
| Node | `toolProviderAdapterRuntime/issues` | `toolProviderAdapterRuntime/issues` |
| Node | `toolProviderAdapterRuntime/audit` | `toolProviderAdapterRuntime/audit` |
| Node | `toolProviderAdapterRuntime/runs/runtime` | `toolProviderAdapterRuntime/runs/runtime` |
| Node | `toolProviderAdapterRuntime/runs/requests` | `toolProviderAdapterRuntime/runs/requests` |
| Node | `toolProviderAdapterRuntime/runs/status` | `toolProviderAdapterRuntime/runs/status` |
| Node | `toolProviderAdapterRuntime/runs/issues` | `toolProviderAdapterRuntime/runs/issues` |
| Node | `toolProviderAdapterRuntime/runs/audit` | `toolProviderAdapterRuntime/runs/audit` |

### blockAdaptersProvider

| Kind | Before | After |
|---|---|---|
| Node | `block-adapters` | `blockAdapters` |

### blockMeasurementProvider

| Kind | Before | After |
|---|---|---|
| Node | `blocks-measurements` | `blocks/measurements` |

### breakerBundle

| Kind | Before | After |
|---|---|---|
| Node | `breaker/status` | `breaker/status` |
| Node | `breaker/allowed` | `breaker/allowed` |

### canvasTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-canvas-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### capabilityAdmissionProjector

| Kind | Before | After |
|---|---|---|
| Node | `capabilityAdmissions/runtime` | `capabilityAdmissions/runtime` |
| Node | `capabilityAdmissions/admissions` | `capabilityAdmissions` |
| Node | `capabilityAdmissions/status` | `capabilityAdmissions/status` |
| Node | `capabilityAdmissions/issues` | `capabilityAdmissions/issues` |
| Node | `capabilityAdmissions/audit` | `capabilityAdmissions/audit` |
| Node | `capabilityAdmissions/views` | `capabilityAdmissions/views` |

### capabilityTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### cellTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### clickHouseTrustedQueryRuntime

| Kind | Before | After |
|---|---|---|
| Node | `clickhouseTrustedQueryEvaluationRuntime/outcomes` | `clickhouseTrustedQueryEvaluationRuntime/outcomes` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/runStatus` | `clickhouseTrustedQueryEvaluationRuntime/runStatus` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/status` | `clickhouseTrustedQueryEvaluationRuntime/status` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/issues` | `clickhouseTrustedQueryEvaluationRuntime/issues` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/audit` | `clickhouseTrustedQueryEvaluationRuntime/audit` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/cancellationProposals` | `clickhouseTrustedQueryEvaluationRuntime/cancellationProposals` |
| Node | `clickhouseTrustedQueryEvaluationRuntime/cancellationAdmissions` | `clickhouseTrustedQueryEvaluationRuntime/cancellationAdmissions` |
| Group | `clickhouseTrustedQueryEvaluationRuntime` | `clickhouseTrustedQueryEvaluationRuntime` |

### cqrs

| Kind | Before | After |
|---|---|---|
| Node | `cqrs/command` | `cqrs/command` |
| Node | `cqrs/runtime` | `cqrs/runtime` |
| Node | `cqrs/events` | `cqrs/events` |
| Node | `cqrs/status` | `cqrs/status` |
| Node | `cqrs/errors` | `cqrs/errors` |
| Node | `cqrs/audit` | `cqrs/audit` |
| Node | `cqrs/cursor` | `cqrs/cursor` |

### cqrsEventOutboxCommands

| Kind | Before | After |
|---|---|---|
| Node | `cqrsMessaging/outboxCommands` | `cqrsMessaging/outboxCommands` |

### cqrsMessageAckCommands

| Kind | Before | After |
|---|---|---|
| Node | `cqrsMessaging/ackCommands` | `cqrsMessaging/ackCommands` |

### cqrsMessagingRecipe

| Kind | Before | After |
|---|---|---|
| Node | `cqrsMessaging/runtime` | `cqrsMessaging/runtime` |
| Node | `cqrsMessaging/issues` | `cqrsMessaging/issues` |
| Node | `cqrsMessaging/commands` | `cqrsMessaging/commands` |
| Node | `cqrsMessaging/ackCommands` | `cqrsMessaging/ackCommands` |

### cqrsProjection

| Kind | Before | After |
|---|---|---|
| Node | `cqrsProjection` | `cqrsProjection` |
| Node | `cqrsProjection/value` | `cqrsProjection/value` |
| Node | `cqrsProjection/errors` | `cqrsProjection/errors` |
| Node | `cqrsProjection/status` | `cqrsProjection/status` |

### cqrsWorkQueueRecipe

| Kind | Before | After |
|---|---|---|
| Node | `cqrsWorkQueue/runtime` | `cqrsWorkQueue/runtime` |
| Node | `cqrsWorkQueue/attempts` | `cqrsWorkQueue/attempts` |
| Node | `cqrsWorkQueue/dispatches` | `cqrsWorkQueue/dispatches` |
| Node | `cqrsWorkQueue/commands` | `cqrsWorkQueue/commands` |
| Node | `cqrsWorkQueue/issues` | `cqrsWorkQueue/issues` |

### customerHostedPostgresqlRuntime

| Kind | Before | After |
|---|---|---|
| Node | `customerHostedPostgresql/lifecycle` | `customerHostedPostgresql/lifecycle` |
| Node | `customerHostedPostgresql/admittedEnvelopes` | `customerHostedPostgresql/admittedEnvelopes` |
| Node | `customerHostedPostgresql/cancellations` | `customerHostedPostgresql/cancellations` |
| Node | `customerHostedPostgresql/outcomes` | `customerHostedPostgresql/outcomes` |
| Node | `customerHostedPostgresql/issues` | `customerHostedPostgresql/issues` |
| Node | `customerHostedPostgresql/audit` | `customerHostedPostgresql/audit` |
| Group | `customerHostedPostgresql` | `customerHostedPostgresql` |

### effectRunCompletionProjector

| Kind | Before | After |
|---|---|---|
| Node | `effectRunCompletion/runtime` | `effectRunCompletion/runtime` |
| Node | `effectRunCompletion/results` | `effectRunCompletion/results` |
| Node | `effectRunCompletion/status` | `effectRunCompletion/status` |
| Node | `effectRunCompletion/issues` | `effectRunCompletion/issues` |
| Node | `effectRunCompletion/audit` | `effectRunCompletion/audit` |

### eventFlow

| Kind | Before | After |
|---|---|---|
| Node | `eventFlow/ledger` | `eventFlow/ledger` |
| Node | `eventFlow/runtime` | `eventFlow/runtime` |
| Node | `eventFlow/records` | `eventFlow/records` |
| Node | `eventFlow/status` | `eventFlow/status` |
| Node | `eventFlow/issues` | `eventFlow/issues` |
| Node | `eventFlow/audit` | `eventFlow/audit` |
| Node | `eventFlow/highWater` | `eventFlow/highWater` |

### eventFlowProjection

| Kind | Before | After |
|---|---|---|
| Node | `eventFlowProjection/ledger` | `eventFlowProjection/ledger` |
| Node | `eventFlowProjection/runtime` | `eventFlowProjection/runtime` |
| Node | `eventFlowProjection/frames` | `eventFlowProjection/frames` |
| Node | `eventFlowProjection/snapshot` | `eventFlowProjection/snapshot` |
| Node | `eventFlowProjection/status` | `eventFlowProjection/status` |
| Node | `eventFlowProjection/issues` | `eventFlowProjection/issues` |
| Node | `eventFlowProjection/highWater` | `eventFlowProjection/highWater` |

### executorOutcomeViewProjector

| Kind | Before | After |
|---|---|---|
| Node | `executorOutcomeViews/runtime` | `executorOutcomeViews/runtime` |
| Node | `executorOutcomeViews/views` | `executorOutcomeViews` |
| Node | `executorOutcomeViews/issues` | `executorOutcomeViews/issues` |
| Node | `executorOutcomeViews/audit` | `executorOutcomeViews/audit` |

### executorWorkQueueRecipe

| Kind | Before | After |
|---|---|---|
| Node | `executorWorkQueue/runtime` | `executorWorkQueue/runtime` |
| Node | `executorWorkQueue/attempts` | `executorWorkQueue/attempts` |
| Node | `executorWorkQueue/commands` | `executorWorkQueue/commands` |
| Node | `executorWorkQueue/issues` | `executorWorkQueue/issues` |

### frameSource

| Kind | Before | After |
|---|---|---|
| Node | `frameSource` | `frameSource` |

### httpToolProviderRuntime

| Kind | Before | After |
|---|---|---|
| Node | `httpToolProviderRuntime/outcomes` | `httpToolProviderRuntime/outcomes` |
| Node | `httpToolProviderRuntime/runStatus` | `httpToolProviderRuntime/runStatus` |
| Node | `httpToolProviderRuntime/status` | `httpToolProviderRuntime/status` |
| Node | `httpToolProviderRuntime/issues` | `httpToolProviderRuntime/issues` |
| Node | `httpToolProviderRuntime/audit` | `httpToolProviderRuntime/audit` |
| Node | `httpToolProviderRuntime/runs/runtime` | `httpToolProviderRuntime/runs/runtime` |
| Node | `httpToolProviderRuntime/runs/requests` | `httpToolProviderRuntime/runs/requests` |
| Node | `httpToolProviderRuntime/runs/status` | `httpToolProviderRuntime/runs/status` |
| Node | `httpToolProviderRuntime/runs/issues` | `httpToolProviderRuntime/runs/issues` |
| Node | `httpToolProviderRuntime/runs/audit` | `httpToolProviderRuntime/runs/audit` |

### imageSizeMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `image-size-measurements` | `imageMeasurements` |

### injectedTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### keyedRateLimitAdmissionBundle

| Kind | Before | After |
|---|---|---|
| Node | `keyedRateLimit/ledger` | `keyedRateLimit/ledger` |
| Node | `keyedRateLimit/runtime` | `keyedRateLimit/runtime` |
| Node | `keyedRateLimit/admissions` | `keyedRateLimit/admissions` |
| Node | `keyedRateLimit/denials` | `keyedRateLimit/denials` |
| Node | `keyedRateLimit/status` | `keyedRateLimit/status` |
| Node | `keyedRateLimit/issues` | `keyedRateLimit/issues` |
| Node | `keyedRateLimit/audit` | `keyedRateLimit/audit` |
| Node | `keyedRateLimit/cursor` | `keyedRateLimit/cursor` |

### knowledgeGraphReducerBundle

| Kind | Before | After |
|---|---|---|
| Node | `knowledgeGraph/snapshot` | `knowledgeGraph/snapshot` |
| Node | `knowledgeGraph/assertions` | `knowledgeGraph/assertions` |
| Node | `knowledgeGraph/entities` | `knowledgeGraph/entities` |
| Node | `knowledgeGraph/relations` | `knowledgeGraph/relations` |
| Node | `knowledgeGraph/topics` | `knowledgeGraph/topics` |
| Node | `knowledgeGraph/index` | `knowledgeGraph/index` |
| Node | `knowledgeGraph/status` | `knowledgeGraph/status` |
| Node | `knowledgeGraph/errors` | `knowledgeGraph/errors` |
| Node | `knowledgeGraph/cursor` | `knowledgeGraph/cursor` |

### localContainerPostgresqlRuntime

| Kind | Before | After |
|---|---|---|
| Node | `localContainerPostgresqlRuntime/admittedRunRequests` | `localContainerPostgresqlRuntime/admittedRunRequests` |
| Node | `localContainerPostgresqlRuntime/runStatus` | `localContainerPostgresqlRuntime/runStatus` |
| Node | `localContainerPostgresqlRuntime/outcomes` | `localContainerPostgresqlRuntime/outcomes` |
| Node | `localContainerPostgresqlRuntime/phases` | `localContainerPostgresqlRuntime/phases` |
| Node | `localContainerPostgresqlRuntime/cleanup` | `localContainerPostgresqlRuntime/cleanup` |
| Node | `localContainerPostgresqlRuntime/issues` | `localContainerPostgresqlRuntime/issues` |
| Node | `localContainerPostgresqlRuntime/audit` | `localContainerPostgresqlRuntime/audit` |
| Node | `localContainerPostgresqlRuntime/usage` | `localContainerPostgresqlRuntime/usage` |
| Node | `localContainerPostgresqlRuntime/movement` | `localContainerPostgresqlRuntime/movement` |
| Node | `localContainerPostgresqlRuntime/cancellationProposals` | `localContainerPostgresqlRuntime/cancellationProposals` |
| Node | `localContainerPostgresqlRuntime/cancellationAdmissions` | `localContainerPostgresqlRuntime/cancellationAdmissions` |
| Node | `localContainerPostgresqlRuntime/cancellationAcknowledgements` | `localContainerPostgresqlRuntime/cancellationAcknowledgements` |
| Group | `localContainerPostgresqlRuntime` | `localContainerPostgresqlRuntime` |

### localFixedWindowRateLimitBundle

| Kind | Before | After |
|---|---|---|
| Node | `localFixedWindowRateLimit/events` | `localFixedWindowRateLimit/events` |
| Node | `localFixedWindowRateLimit/allowed` | `localFixedWindowRateLimit/allowed` |
| Node | `localFixedWindowRateLimit/dropped` | `localFixedWindowRateLimit/dropped` |
| Node | `localFixedWindowRateLimit/status` | `localFixedWindowRateLimit/status` |

### localHostExecutionGate

| Kind | Before | After |
|---|---|---|
| Node | `localHostExecutionGate/runtime` | `localHostExecutionGate/runtime` |
| Node | `localHostExecutionGate/admittedRunRequests` | `localHostExecutionGate/admittedRunRequests` |
| Node | `localHostExecutionGate/status` | `localHostExecutionGate/status` |
| Node | `localHostExecutionGate/issues` | `localHostExecutionGate/issues` |
| Node | `localHostExecutionGate/audit` | `localHostExecutionGate/audit` |
| Group | `localHostExecutionGate` | `localHostExecutionGate` |

### localUntrustedJsComputeRuntime

| Kind | Before | After |
|---|---|---|
| Node | `localUntrustedJsCompute/admittedRunRequests` | `localUntrustedJsCompute/admittedRunRequests` |
| Node | `localUntrustedJsCompute/runStatus` | `localUntrustedJsCompute/runStatus` |
| Node | `localUntrustedJsCompute/lifecycle` | `localUntrustedJsCompute/lifecycle` |
| Node | `localUntrustedJsCompute/cleanup` | `localUntrustedJsCompute/cleanup` |
| Node | `localUntrustedJsCompute/outcomes` | `localUntrustedJsCompute/outcomes` |
| Node | `localUntrustedJsCompute/usage` | `localUntrustedJsCompute/usage` |
| Node | `localUntrustedJsCompute/cancellations` | `localUntrustedJsCompute/cancellations` |
| Node | `localUntrustedJsCompute/issues` | `localUntrustedJsCompute/issues` |
| Node | `localUntrustedJsCompute/audit` | `localUntrustedJsCompute/audit` |
| Group | `localUntrustedJsCompute` | `localUntrustedJsCompute` |

### managedCloudPostgresqlRuntime

| Kind | Before | After |
|---|---|---|
| Node | `managedCloudPostgresql/admittedEnvelopes` | `managedCloudPostgresql/admittedEnvelopes` |
| Node | `managedCloudPostgresql/lifecycle` | `managedCloudPostgresql/lifecycle` |
| Node | `managedCloudPostgresql/credentialLifecycle` | `managedCloudPostgresql/credentialLifecycle` |
| Node | `managedCloudPostgresql/runStatus` | `managedCloudPostgresql/runStatus` |
| Node | `managedCloudPostgresql/outcomes` | `managedCloudPostgresql/outcomes` |
| Node | `managedCloudPostgresql/cancellations` | `managedCloudPostgresql/cancellations` |
| Node | `managedCloudPostgresql/issues` | `managedCloudPostgresql/issues` |
| Node | `managedCloudPostgresql/audit` | `managedCloudPostgresql/audit` |
| Group | `managedCloudPostgresql` | `managedCloudPostgresql` |

### managedUntrustedJsComputeRuntime

| Kind | Before | After |
|---|---|---|
| Node | `managedUntrustedJsCompute/admittedRunRequests` | `managedUntrustedJsCompute/admittedRunRequests` |
| Node | `managedUntrustedJsCompute/runStatus` | `managedUntrustedJsCompute/runStatus` |
| Node | `managedUntrustedJsCompute/lifecycle` | `managedUntrustedJsCompute/lifecycle` |
| Node | `managedUntrustedJsCompute/cleanup` | `managedUntrustedJsCompute/cleanup` |
| Node | `managedUntrustedJsCompute/movement` | `managedUntrustedJsCompute/movement` |
| Node | `managedUntrustedJsCompute/outcomes` | `managedUntrustedJsCompute/outcomes` |
| Node | `managedUntrustedJsCompute/cancellationProposals` | `managedUntrustedJsCompute/cancellationProposals` |
| Node | `managedUntrustedJsCompute/cancellationAdmissions` | `managedUntrustedJsCompute/cancellationAdmissions` |
| Node | `managedUntrustedJsCompute/cancellations` | `managedUntrustedJsCompute/cancellations` |
| Node | `managedUntrustedJsCompute/issues` | `managedUntrustedJsCompute/issues` |
| Node | `managedUntrustedJsCompute/audit` | `managedUntrustedJsCompute/audit` |
| Group | `managedUntrustedJsCompute` | `managedUntrustedJsCompute` |

### memoryRetrievalBundle

| Kind | Before | After |
|---|---|---|
| Node | `memoryRetrieval/snapshot` | `memoryRetrieval/snapshot` |
| Node | `memoryRetrieval/fragments` | `memoryRetrieval/fragments` |
| Node | `memoryRetrieval/indexed` | `memoryRetrieval/indexed` |
| Node | `memoryRetrieval/ranked` | `memoryRetrieval/ranked` |
| Node | `memoryRetrieval/status` | `memoryRetrieval/status` |
| Node | `memoryRetrieval/errors` | `memoryRetrieval/errors` |
| Node | `memoryRetrieval/cursor` | `memoryRetrieval/cursor` |

### mergeMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `measurements` | `measurements` |

### messageBus

| Kind | Before | After |
|---|---|---|
| Node | `messageBus/publish` | `messageBus/publish` |
| Node | `messageBus/commands` | `messageBus/commands` |
| Node | `messageBus/runtime` | `messageBus/runtime` |
| Node | `messageBus/messages` | `messageBus/messages` |
| Node | `messageBus/status` | `messageBus/status` |
| Node | `messageBus/issues` | `messageBus/issues` |

### openPersistentAgenticMemoryRecords

| Kind | Before | After |
|---|---|---|
| Node | `state#0` | `agenticMemoryRecords` |
| Node | `agenticMemoryRecords.persistence/ready` | `agenticMemoryRecords/persistence/ready` |
| Node | `agenticMemoryRecords.persistence/status` | `agenticMemoryRecords/persistence/status` |
| Node | `agenticMemoryRecords.persistence/error` | `agenticMemoryRecords/persistence/error` |
| Node | `agenticMemoryRecords.persistence/cursor` | `agenticMemoryRecords/persistence/cursor` |

### openPersistentReactiveIndex

| Kind | Before | After |
|---|---|---|
| Node | `reactiveIndex.delta#0` | `reactiveIndex/delta` |
| Node | `reactiveIndex.request#1` | `reactiveIndex/request` |
| Node | `reactiveIndex.snapshot#2` | `reactiveIndex/snapshot` |
| Node | `reactiveIndex.persistence/ready` | `reactiveIndex/persistence/ready` |
| Node | `reactiveIndex.persistence/status` | `reactiveIndex/persistence/status` |
| Node | `reactiveIndex.persistence/error` | `reactiveIndex/persistence/error` |
| Node | `reactiveIndex.persistence/cursor` | `reactiveIndex/persistence/cursor` |

### openPersistentReactiveList

| Kind | Before | After |
|---|---|---|
| Node | `reactiveList.delta#0` | `reactiveList/delta` |
| Node | `reactiveList.request#1` | `reactiveList/request` |
| Node | `reactiveList.snapshot#2` | `reactiveList/snapshot` |
| Node | `reactiveList.persistence/ready` | `reactiveList/persistence/ready` |
| Node | `reactiveList.persistence/status` | `reactiveList/persistence/status` |
| Node | `reactiveList.persistence/error` | `reactiveList/persistence/error` |
| Node | `reactiveList.persistence/cursor` | `reactiveList/persistence/cursor` |

### openPersistentReactiveLog

| Kind | Before | After |
|---|---|---|
| Node | `reactiveLog.delta#0` | `reactiveLog/delta` |
| Node | `reactiveLog.request#1` | `reactiveLog/request` |
| Node | `reactiveLog.snapshot#2` | `reactiveLog/snapshot` |
| Node | `reactiveLog.persistence/ready` | `reactiveLog/persistence/ready` |
| Node | `reactiveLog.persistence/status` | `reactiveLog/persistence/status` |
| Node | `reactiveLog.persistence/error` | `reactiveLog/persistence/error` |
| Node | `reactiveLog.persistence/cursor` | `reactiveLog/persistence/cursor` |

### openPersistentReactiveMap

| Kind | Before | After |
|---|---|---|
| Node | `reactiveMap.intent#0` | `reactiveMap/intent` |
| Node | `reactiveMap.apply#1` | `reactiveMap/apply` |
| Node | `reactiveMap.request#2` | `reactiveMap/request` |
| Node | `reactiveMap.snapshotPrep#3` | `reactiveMap/snapshotPrep` |
| Node | `reactiveMap.delta#4` | `reactiveMap/delta` |
| Node | `reactiveMap.snapshot#5` | `reactiveMap/snapshot` |
| Node | `reactiveMap.persistence/ready` | `reactiveMap/persistence/ready` |
| Node | `reactiveMap.persistence/status` | `reactiveMap/persistence/status` |
| Node | `reactiveMap.persistence/error` | `reactiveMap/persistence/error` |
| Node | `reactiveMap.persistence/cursor` | `reactiveMap/persistence/cursor` |

### orchestrationMessageAckCommands

| Kind | Before | After |
|---|---|---|
| Node | `orchestrationMessaging/ackCommands` | `orchestrationMessaging/ackCommands` |

### orchestrationMessagingRecipe

| Kind | Before | After |
|---|---|---|
| Node | `orchestrationMessaging/runtime` | `orchestrationMessaging/runtime` |
| Node | `orchestrationMessaging/issues` | `orchestrationMessaging/issues` |
| Node | `orchestrationMessaging/commands` | `orchestrationMessaging/commands` |
| Node | `orchestrationMessaging/ackCommands` | `orchestrationMessaging/ackCommands` |

### orchestrationWorkQueueRecipe

| Kind | Before | After |
|---|---|---|
| Node | `orchestrationWorkQueue/runtime` | `orchestrationWorkQueue/runtime` |
| Node | `orchestrationWorkQueue/evidence` | `orchestrationWorkQueue/evidence` |
| Node | `orchestrationWorkQueue/status` | `orchestrationWorkQueue/status` |
| Node | `orchestrationWorkQueue/issues` | `orchestrationWorkQueue/issues` |
| Node | `orchestrationWorkQueue/audit` | `orchestrationWorkQueue/audit` |

### persistAgenticMemoryRecords

| Kind | Before | After |
|---|---|---|
| Node | `agenticMemoryRecords.persistence/ready` | `agenticMemoryRecords/persistence/ready` |
| Node | `agenticMemoryRecords.persistence/status` | `agenticMemoryRecords/persistence/status` |
| Node | `agenticMemoryRecords.persistence/error` | `agenticMemoryRecords/persistence/error` |
| Node | `agenticMemoryRecords.persistence/cursor` | `agenticMemoryRecords/persistence/cursor` |

### persistReactiveCollection

| Kind | Before | After |
|---|---|---|
| Node | `reactiveList.delta#0` | `reactiveList/delta` |
| Node | `reactiveList.request#1` | `reactiveList/request` |
| Node | `reactiveList.snapshot#2` | `reactiveList/snapshot` |
| Node | `reactiveList.persistence/ready` | `reactiveList/persistence/ready` |
| Node | `reactiveList.persistence/status` | `reactiveList/persistence/status` |
| Node | `reactiveList.persistence/error` | `reactiveList/persistence/error` |
| Node | `reactiveList.persistence/cursor` | `reactiveList/persistence/cursor` |

### postgresqlToolProviderRuntime

| Kind | Before | After |
|---|---|---|
| Node | `postgresqlToolProviderRuntime/outcomes` | `postgresqlToolProviderRuntime/outcomes` |
| Node | `postgresqlToolProviderRuntime/runStatus` | `postgresqlToolProviderRuntime/runStatus` |
| Node | `postgresqlToolProviderRuntime/status` | `postgresqlToolProviderRuntime/status` |
| Node | `postgresqlToolProviderRuntime/issues` | `postgresqlToolProviderRuntime/issues` |
| Node | `postgresqlToolProviderRuntime/audit` | `postgresqlToolProviderRuntime/audit` |
| Node | `postgresqlToolProviderRuntime/cancellationProposals` | `postgresqlToolProviderRuntime/cancellationProposals` |
| Node | `postgresqlToolProviderRuntime/cancellationAdmissions` | `postgresqlToolProviderRuntime/cancellationAdmissions` |
| Group | `postgresqlToolProviderRuntime` | `postgresqlToolProviderRuntime` |

### precomputedTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### processBundle

| Kind | Before | After |
|---|---|---|
| Node | `process/dispatch` | `process/dispatch` |
| Node | `process/command` | `process/command` |
| Node | `process/runtime` | `process/runtime` |
| Node | `process/events` | `process/events` |
| Node | `process/state` | `process/state` |
| Node | `process/audit` | `process/audit` |
| Node | `process/effectRequests` | `process/effectRequests` |
| Node | `process/status` | `process/status` |
| Node | `process/errors` | `process/errors` |
| Node | `process/cursor` | `process/cursor` |
| Group | `process.process` | `process` |

### processEffectRunner

| Kind | Before | After |
|---|---|---|
| Node | `process/dispatch` | `process/dispatch` |
| Node | `process/command` | `process/command` |
| Node | `process/runtime` | `process/runtime` |
| Node | `process/events` | `process/events` |
| Node | `process/state` | `process/state` |
| Node | `process/audit` | `process/audit` |
| Node | `process/effectRequests` | `process/effectRequests` |
| Node | `process/status` | `process/status` |
| Node | `process/errors` | `process/errors` |
| Node | `process/cursor` | `process/cursor` |
| Node | `processEffectRunner/requests` | `processEffectRunner/requests` |
| Node | `processEffectRunner/runtime` | `processEffectRunner/runtime` |
| Node | `processEffectRunner/outcomes` | `processEffectRunner/outcomes` |
| Node | `processEffectRunner/commands` | `processEffectRunner/commands` |
| Node | `processEffectRunner/errors` | `processEffectRunner/errors` |
| Node | `processEffectRunner/status` | `processEffectRunner/status` |
| Group | `process.process` | `process` |
| Group | `processEffectRunner.effectRunner` | `processEffectRunner` |

### processEventOutboxCommands

| Kind | Before | After |
|---|---|---|
| Node | `orchestrationMessaging/outboxCommands` | `orchestrationMessaging/outboxCommands` |

### reactiveBlockLayout

| Kind | Before | After |
|---|---|---|
| Node | `reactive-block-layout:gap` | `reactiveBlockLayout/gap` |
| Node | `reactive-block-layout:measured-blocks` | `reactiveBlockLayout/measuredBlocks` |
| Node | `reactive-block-layout:block-flow` | `reactiveBlockLayout/flow` |
| Node | `reactive-block-layout:total-height` | `reactiveBlockLayout/height` |

### reactiveCascadingCache

| Kind | Before | After |
|---|---|---|
| Node | `reactiveCascadingCache.events` | `reactiveCascadingCache/events` |
| Node | `reactiveCascadingCache.status` | `reactiveCascadingCache/status` |
| Node | `reactiveCascadingCache.value` | `reactiveCascadingCache/value` |

### reactiveFlowLayout

| Kind | Before | After |
|---|---|---|
| Node | `reactive-flow-layout:line-height` | `reactiveFlowLayout/lineHeight` |
| Node | `reactive-flow-layout:container` | `reactiveFlowLayout/container` |
| Node | `reactive-flow-layout:columns` | `reactiveFlowLayout/columns` |
| Node | `reactive-flow-layout:obstacles` | `reactiveFlowLayout/obstacles` |
| Node | `reactive-flow-layout:segments` | `reactiveFlowLayout/segments` |
| Node | `reactive-flow-layout:flow-lines` | `reactiveFlowLayout/lines` |

### reactiveIndex

| Kind | Before | After |
|---|---|---|
| Node | `reactiveIndex.delta#0` | `reactiveIndex/delta` |
| Node | `reactiveIndex.request#1` | `reactiveIndex/request` |
| Node | `reactiveIndex.snapshot#2` | `reactiveIndex/snapshot` |

### reactiveLayout

| Kind | Before | After |
|---|---|---|
| Node | `reactive-layout:line-height` | `reactiveLayout/lineHeight` |
| Node | `reactive-layout:max-width` | `reactiveLayout/maxWidth` |
| Node | `reactive-layout:segments` | `reactiveLayout/segments` |
| Node | `reactive-layout:line-breaks` | `reactiveLayout/lineBreaks` |
| Node | `reactive-layout:height` | `reactiveLayout/height` |
| Node | `reactive-layout:char-positions` | `reactiveLayout/charPositions` |

### reactiveList

| Kind | Before | After |
|---|---|---|
| Node | `reactiveList.delta#0` | `reactiveList/delta` |
| Node | `reactiveList.request#1` | `reactiveList/request` |
| Node | `reactiveList.snapshot#2` | `reactiveList/snapshot` |

### reactiveLog

| Kind | Before | After |
|---|---|---|
| Node | `reactiveLog.delta#0` | `reactiveLog/delta` |
| Node | `reactiveLog.request#1` | `reactiveLog/request` |
| Node | `reactiveLog.snapshot#2` | `reactiveLog/snapshot` |

### reactiveMap

| Kind | Before | After |
|---|---|---|
| Node | `reactiveMap.intent#0` | `reactiveMap/intent` |
| Node | `reactiveMap.apply#1` | `reactiveMap/apply` |
| Node | `reactiveMap.request#2` | `reactiveMap/request` |
| Node | `reactiveMap.snapshotPrep#3` | `reactiveMap/snapshotPrep` |
| Node | `reactiveMap.delta#4` | `reactiveMap/delta` |
| Node | `reactiveMap.snapshot#5` | `reactiveMap/snapshot` |

### reactNativeLayoutMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `react-native-layout-measurements` | `reactNativeMeasurements` |

### readinessMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `measurement-readiness-measurements` | `readiness/measurements` |

### readinessTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measurements` | `text/measurements` |

### remoteCall

| Kind | Before | After |
|---|---|---|
| Node | `wireBridge/command` | `wireBridge/command` |
| Node | `wireBridge/inbound` | `wireBridge/inbound` |
| Node | `wireBridge/events` | `wireBridge/events` |
| Node | `wireBridge/outbound` | `wireBridge/outbound` |
| Node | `wireBridge/acks` | `wireBridge/acks` |
| Node | `wireBridge/nacks` | `wireBridge/nacks` |
| Node | `wireBridge/statusLedger` | `wireBridge/statusLedger` |
| Node | `wireBridge/status` | `wireBridge/status` |
| Node | `wireBridge/errors` | `wireBridge/errors` |
| Node | `wireBridge/cursor` | `wireBridge/cursor` |
| Node | `wireBridge/attempts` | `wireBridge/attempts` |
| Node | `remoteCall/timeouts` | `remoteCall/timeouts` |
| Node | `remoteCall/responses` | `remoteCall/responses` |
| Node | `remoteCall/results` | `remoteCall/results` |
| Node | `remoteCall/status` | `remoteCall/status` |
| Node | `remoteCall/errors` | `remoteCall/errors` |

### remoteResponder

| Kind | Before | After |
|---|---|---|
| Node | `wireBridge/command` | `wireBridge/command` |
| Node | `wireBridge/inbound` | `wireBridge/inbound` |
| Node | `wireBridge/events` | `wireBridge/events` |
| Node | `wireBridge/outbound` | `wireBridge/outbound` |
| Node | `wireBridge/acks` | `wireBridge/acks` |
| Node | `wireBridge/nacks` | `wireBridge/nacks` |
| Node | `wireBridge/statusLedger` | `wireBridge/statusLedger` |
| Node | `wireBridge/status` | `wireBridge/status` |
| Node | `wireBridge/errors` | `wireBridge/errors` |
| Node | `wireBridge/cursor` | `wireBridge/cursor` |
| Node | `wireBridge/attempts` | `wireBridge/attempts` |
| Node | `remoteResponder/events` | `remoteResponder/events` |
| Node | `remoteResponder/responseCommands` | `remoteResponder/responseCommands` |
| Node | `remoteResponder/requests` | `remoteResponder/requests` |
| Node | `remoteResponder/status` | `remoteResponder/status` |
| Node | `remoteResponder/errors` | `remoteResponder/errors` |
| Group | `remoteResponder.remoteResponder` | `remoteResponder` |

### requestSatisfactionProjector

| Kind | Before | After |
|---|---|---|
| Node | `requestSatisfaction/runtime` | `requestSatisfaction/runtime` |
| Node | `requestSatisfaction/status` | `requestSatisfaction/status` |
| Node | `requestSatisfaction/issues` | `requestSatisfaction/issues` |
| Node | `requestSatisfaction/audit` | `requestSatisfaction/audit` |

### retryStatusBundle

| Kind | Before | After |
|---|---|---|
| Node | `retry/status` | `retry/status` |
| Node | `retry/errors` | `retry/errors` |

### scheduledReadinessProjector

| Kind | Before | After |
|---|---|---|
| Node | `scheduledReadiness/runtime` | `scheduledReadiness/runtime` |
| Node | `scheduledReadiness/pending` | `scheduledReadiness/pending` |
| Node | `scheduledReadiness/ready` | `scheduledReadiness/ready` |
| Node | `scheduledReadiness/overdue` | `scheduledReadiness/overdue` |
| Node | `scheduledReadiness/status` | `scheduledReadiness/status` |
| Node | `scheduledReadiness/issues` | `scheduledReadiness/issues` |
| Node | `scheduledReadiness/audit` | `scheduledReadiness/audit` |
| Node | `scheduledReadiness/views` | `scheduledReadiness/views` |

### skiaTextMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `text-measure-capability` | `text/capability` |
| Node | `text-measurements` | `text/measurements` |

### structuredAgentDecisionInterpreter

| Kind | Before | After |
|---|---|---|
| Node | `structuredAgentDecisionInterpreter/runtime` | `structuredAgentDecisionInterpreter/runtime` |
| Node | `structuredAgentDecisionInterpreter/decisions` | `structuredAgentDecisionInterpreter/decisions` |
| Node | `structuredAgentDecisionInterpreter/issues` | `structuredAgentDecisionInterpreter/issues` |
| Node | `structuredAgentDecisionInterpreter/audit` | `structuredAgentDecisionInterpreter/audit` |

### svgBoundsMeasurements

| Kind | Before | After |
|---|---|---|
| Node | `svg-bounds-measurements` | `svgMeasurements` |

### textMeasurementProvider

| Kind | Before | After |
|---|---|---|
| Node | `text-measurements` | `text/measurements` |

### timeoutBundle

| Kind | Before | After |
|---|---|---|
| Node | `~timer#0` | `~timer#0` |
| Node | `~timeout#1` | `~timeout#1` |
| Node | `timeout/status` | `timeout/status` |
| Node | `timeout/errors` | `timeout/errors` |

### toHttp

| Kind | Before | After |
|---|---|---|
| Node | `toHttp` | `toHttp` |
| Node | `toHttp/status` | `toHttp/status` |
| Node | `toHttp/attempts` | `toHttp/attempts` |
| Node | `toHttp/errors` | `toHttp/errors` |

### toolProviderAdapterInputProjector

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderAdapterInput/runtime` | `toolProviderAdapterInput/runtime` |
| Node | `toolProviderAdapterInput/inputs` | `toolProviderAdapterInput/inputs` |
| Node | `toolProviderAdapterInput/issues` | `toolProviderAdapterInput/issues` |
| Node | `toolProviderAdapterInput/audit` | `toolProviderAdapterInput/audit` |

### toolProviderExecutionRecipe

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderExecution/policy/runtime` | `toolProviderExecution/policy/runtime` |
| Node | `toolProviderExecution/policy/resolutions` | `toolProviderExecution/policy/resolutions` |
| Node | `toolProviderExecution/policy/issues` | `toolProviderExecution/policy/issues` |
| Node | `toolProviderExecution/policy/audit` | `toolProviderExecution/policy/audit` |
| Node | `toolProviderExecution/adapterInput/runtime` | `toolProviderExecution/adapterInput/runtime` |
| Node | `toolProviderExecution/adapterInput/inputs` | `toolProviderExecution/adapterInput/inputs` |
| Node | `toolProviderExecution/adapterInput/issues` | `toolProviderExecution/adapterInput/issues` |
| Node | `toolProviderExecution/adapterInput/audit` | `toolProviderExecution/adapterInput/audit` |
| Node | `toolProviderExecution/runtime/retentionPolicy` | `toolProviderExecution/runtime/retentionPolicy` |
| Node | `toolProviderExecution/runtime/outcomes` | `toolProviderExecution/runtime/outcomes` |
| Node | `toolProviderExecution/runtime/runStatus` | `toolProviderExecution/runtime/runStatus` |
| Node | `toolProviderExecution/runtime/status` | `toolProviderExecution/runtime/status` |
| Node | `toolProviderExecution/runtime/runtimeStatus` | `toolProviderExecution/runtime/runtimeStatus` |
| Node | `toolProviderExecution/runtime/issues` | `toolProviderExecution/runtime/issues` |
| Node | `toolProviderExecution/runtime/audit` | `toolProviderExecution/runtime/audit` |
| Node | `toolProviderExecution/runtime/runs/runtime` | `toolProviderExecution/runtime/runs/runtime` |
| Node | `toolProviderExecution/runtime/runs/requests` | `toolProviderExecution/runtime/runs/requests` |
| Node | `toolProviderExecution/runtime/runs/status` | `toolProviderExecution/runtime/runs/status` |
| Node | `toolProviderExecution/runtime/runs/issues` | `toolProviderExecution/runtime/runs/issues` |
| Node | `toolProviderExecution/runtime/runs/audit` | `toolProviderExecution/runtime/runs/audit` |
| Node | `toolProviderExecution/outcomeView/runtime` | `toolProviderExecution/outcomeView/runtime` |
| Node | `toolProviderExecution/outcomeView/views` | `toolProviderExecution/outcomeView` |
| Node | `toolProviderExecution/outcomeView/issues` | `toolProviderExecution/outcomeView/issues` |
| Node | `toolProviderExecution/outcomeView/audit` | `toolProviderExecution/outcomeView/audit` |

### toolProviderPolicyResolutionProjector

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderPolicyResolution/runtime` | `toolProviderPolicyResolution/runtime` |
| Node | `toolProviderPolicyResolution/resolutions` | `toolProviderPolicyResolution/resolutions` |
| Node | `toolProviderPolicyResolution/issues` | `toolProviderPolicyResolution/issues` |
| Node | `toolProviderPolicyResolution/audit` | `toolProviderPolicyResolution/audit` |

### toolProviderRunAdmissionProjector

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderRunAdmission/runtime` | `toolProviderRunAdmission/runtime` |
| Node | `toolProviderRunAdmission/handoffCandidates` | `toolProviderRunAdmission/handoffCandidates` |
| Node | `toolProviderRunAdmission/handoffDecisions` | `toolProviderRunAdmission/handoffDecisions` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/correlation` | `toolProviderRunAdmission/handoff/correlation` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/admitted` | `toolProviderRunAdmission/handoff/admitted` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/accepted` | `toolProviderRunAdmission/handoff/accepted` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/rejected` | `toolProviderRunAdmission/handoff/rejected` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/status` | `toolProviderRunAdmission/handoff/status` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/issues` | `toolProviderRunAdmission/handoff/issues` |
| Node | `toolProviderRunAdmission/approvedRunHandoff/cursor` | `toolProviderRunAdmission/handoff/cursor` |
| Node | `toolProviderRunAdmission/approvedRunRequests` | `toolProviderRunAdmission/requests` |
| Node | `toolProviderRunAdmission/proposals` | `toolProviderRunAdmission/proposals` |
| Node | `toolProviderRunAdmission/admissions` | `toolProviderRunAdmission/admissions` |
| Node | `toolProviderRunAdmission/status` | `toolProviderRunAdmission/status` |
| Node | `toolProviderRunAdmission/issues` | `toolProviderRunAdmission/issues` |
| Node | `toolProviderRunAdmission/audit` | `toolProviderRunAdmission/audit` |
| Node | `toolProviderRunAdmission/views` | `toolProviderRunAdmission/views` |

### toolProviderRunRetryProjector

| Kind | Before | After |
|---|---|---|
| Node | `toolProviderRunRetry/runtime` | `toolProviderRunRetry/runtime` |
| Node | `toolProviderRunRetry/proposals` | `toolProviderRunRetry/proposals` |
| Node | `toolProviderRunRetry/scheduled` | `toolProviderRunRetry/scheduled` |
| Node | `toolProviderRunRetry/readinessSchedules` | `toolProviderRunRetry/readinessSchedules` |
| Node | `toolProviderRunRetry/runRequests` | `toolProviderRunRetry/requests` |
| Node | `toolProviderRunRetry/status` | `toolProviderRunRetry/status` |
| Node | `toolProviderRunRetry/issues` | `toolProviderRunRetry/issues` |
| Node | `toolProviderRunRetry/audit` | `toolProviderRunRetry/audit` |
| Node | `toolProviderRunRetry/views` | `toolProviderRunRetry/views` |

### toProcess

| Kind | Before | After |
|---|---|---|
| Node | `toProcess` | `toProcess` |
| Node | `toProcess/status` | `toProcess/status` |
| Node | `toProcess/attempts` | `toProcess/attempts` |
| Node | `toProcess/errors` | `toProcess/errors` |

### toTopic

| Kind | Before | After |
|---|---|---|
| Node | `messageBus/publish` | `messageBus/publish` |
| Node | `messageBus/commands` | `messageBus/commands` |
| Node | `messageBus/runtime` | `messageBus/runtime` |
| Node | `messageBus/messages` | `messageBus/messages` |
| Node | `messageBus/status` | `messageBus/status` |
| Node | `messageBus/issues` | `messageBus/issues` |
| Node | `messageBus/jobs/toTopic` | `messageBus/topics/jobs/toTopic` |

### toWebSocket

| Kind | Before | After |
|---|---|---|
| Node | `toWebSocket` | `toWebSocket` |
| Node | `toWebSocket/status` | `toWebSocket/status` |
| Node | `toWebSocket/attempts` | `toWebSocket/attempts` |
| Node | `toWebSocket/errors` | `toWebSocket/errors` |

### webSocketSession

| Kind | Before | After |
|---|---|---|
| Node | `webSocketSession/command` | `webSocketSession/command` |
| Node | `webSocketSession/events` | `webSocketSession/events` |
| Node | `webSocketSession/inbound` | `webSocketSession/inbound` |
| Node | `webSocketSession/lifecycle` | `webSocketSession/lifecycle` |
| Node | `webSocketSession/outbound` | `webSocketSession/outbound` |
| Node | `webSocketSession/status` | `webSocketSession/status` |
| Node | `webSocketSession/errors` | `webSocketSession/errors` |
| Node | `webSocketSession/attempts` | `webSocketSession/attempts` |

### wireBridge

| Kind | Before | After |
|---|---|---|
| Node | `wireBridge/command` | `wireBridge/command` |
| Node | `wireBridge/inbound` | `wireBridge/inbound` |
| Node | `wireBridge/events` | `wireBridge/events` |
| Node | `wireBridge/outbound` | `wireBridge/outbound` |
| Node | `wireBridge/acks` | `wireBridge/acks` |
| Node | `wireBridge/nacks` | `wireBridge/nacks` |
| Node | `wireBridge/statusLedger` | `wireBridge/statusLedger` |
| Node | `wireBridge/status` | `wireBridge/status` |
| Node | `wireBridge/errors` | `wireBridge/errors` |
| Node | `wireBridge/cursor` | `wireBridge/cursor` |
| Node | `wireBridge/attempts` | `wireBridge/attempts` |

### wireBridgeAckDriver

| Kind | Before | After |
|---|---|---|
| Node | `wireBridge/command` | `wireBridge/command` |
| Node | `wireBridge/inbound` | `wireBridge/inbound` |
| Node | `wireBridge/events` | `wireBridge/events` |
| Node | `wireBridge/outbound` | `wireBridge/outbound` |
| Node | `wireBridge/acks` | `wireBridge/acks` |
| Node | `wireBridge/nacks` | `wireBridge/nacks` |
| Node | `wireBridge/statusLedger` | `wireBridge/statusLedger` |
| Node | `wireBridge/status` | `wireBridge/status` |
| Node | `wireBridge/errors` | `wireBridge/errors` |
| Node | `wireBridge/cursor` | `wireBridge/cursor` |
| Node | `wireBridge/attempts` | `wireBridge/attempts` |
| Node | `s1/wireBridgeAckDriver/events` | `s1/ackDriver/events` |
| Node | `s1/wireBridgeAckDriver/commands` | `s1/ackDriver/commands` |
| Node | `s1/wireBridgeAckDriver/issues` | `s1/ackDriver/issues` |
| Node | `s1/wireBridgeAckDriver/status` | `s1/ackDriver/status` |
| Group | `s1/wireBridgeAckDriver.wireBridgeAckDriver` | `s1/ackDriver` |

### wireBridgeProtobuf

| Kind | Before | After |
|---|---|---|
| Node | `wireBridge/command` | `wireBridge/command` |
| Node | `wireBridge/inbound` | `wireBridge/inbound` |
| Node | `wireBridge/events` | `wireBridge/events` |
| Node | `wireBridge/outbound` | `wireBridge/outbound` |
| Node | `wireBridge/acks` | `wireBridge/acks` |
| Node | `wireBridge/nacks` | `wireBridge/nacks` |
| Node | `wireBridge/statusLedger` | `wireBridge/statusLedger` |
| Node | `wireBridge/status` | `wireBridge/status` |
| Node | `wireBridge/errors` | `wireBridge/errors` |
| Node | `wireBridge/cursor` | `wireBridge/cursor` |
| Node | `wireBridge/attempts` | `wireBridge/attempts` |
| Node | `wireBridgeProtobuf/inboundBytes` | `wireBridgeProtobuf/inboundBytes` |
| Node | `wireBridgeProtobuf/inboundResults` | `wireBridgeProtobuf/inboundResults` |
| Node | `wireBridgeProtobuf/outboundResults` | `wireBridgeProtobuf/outboundResults` |
| Node | `wireBridgeProtobuf/inboundEvents` | `wireBridgeProtobuf/inboundEvents` |
| Node | `wireBridgeProtobuf/outboundEvents` | `wireBridgeProtobuf/outboundEvents` |
| Node | `wireBridgeProtobuf/inboundDecoded` | `wireBridgeProtobuf/inboundDecoded` |
| Node | `wireBridgeProtobuf/outboundBytes` | `wireBridgeProtobuf/outboundBytes` |
| Node | `wireBridgeProtobuf/issues` | `wireBridgeProtobuf/issues` |
| Node | `wireBridgeProtobuf/status` | `wireBridgeProtobuf/status` |
| Group | `wireBridgeProtobuf.wireBridgeProtobuf` | `wireBridgeProtobuf` |

### wireEdgeGroupIn

| Kind | Before | After |
|---|---|---|
| Node | `g/in` | `g/in` |
| Node | `g/in/x` | `g/in/edges/x` |
| Node | `g/in/issues` | `g/in/edges/issues` |
| Node | `g/in.issues` | `g/in/issues` |

### wireEdgeGroupOut

| Kind | Before | After |
|---|---|---|
| Node | `g/out` | `g/out` |

### workerDerived

| Kind | Before | After |
|---|---|---|
| Node | `workerDerived` | `workerDerived` |

### workItemAuthoringProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemAuthoring/runtime` | `workItemAuthoring/runtime` |
| Node | `workItemAuthoring/workItems` | `workItemAuthoring/items` |
| Node | `workItemAuthoring/status` | `workItemAuthoring/status` |
| Node | `workItemAuthoring/issues` | `workItemAuthoring/issues` |
| Node | `workItemAuthoring/audit` | `workItemAuthoring/audit` |

### workItemDomainActionAdmissionProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemDomainActionAdmissions/runtime` | `workItemDomainActionAdmissions/runtime` |
| Node | `workItemDomainActionAdmissions/admissions` | `workItemDomainActionAdmissions` |
| Node | `workItemDomainActionAdmissions/status` | `workItemDomainActionAdmissions/status` |
| Node | `workItemDomainActionAdmissions/issues` | `workItemDomainActionAdmissions/issues` |
| Node | `workItemDomainActionAdmissions/audit` | `workItemDomainActionAdmissions/audit` |
| Node | `workItemDomainActionAdmissions/views` | `workItemDomainActionAdmissions/views` |

### workItemDomainActionApplicationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemDomainActionApplication/runtime` | `workItemDomainActionApplication/runtime` |
| Node | `workItemDomainActionApplication/authoringFacts` | `workItemDomainActionApplication/authoringFacts` |
| Node | `workItemDomainActionApplication/applications` | `workItemDomainActionApplication/applications` |
| Node | `workItemDomainActionApplication/status` | `workItemDomainActionApplication/status` |
| Node | `workItemDomainActionApplication/issues` | `workItemDomainActionApplication/issues` |
| Node | `workItemDomainActionApplication/audit` | `workItemDomainActionApplication/audit` |

### workItemDomainActionCapabilityGuardProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemDomainActionCapabilityGuard/runtime` | `workItemDomainActionCapabilityGuard/runtime` |
| Node | `workItemDomainActionCapabilityGuard/decisions` | `workItemDomainActionCapabilityGuard/decisions` |
| Node | `workItemDomainActionCapabilityGuard/status` | `workItemDomainActionCapabilityGuard/status` |
| Node | `workItemDomainActionCapabilityGuard/issues` | `workItemDomainActionCapabilityGuard/issues` |
| Node | `workItemDomainActionCapabilityGuard/audit` | `workItemDomainActionCapabilityGuard/audit` |

### workItemDomainActionProposalIntakeProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemDomainActionIntake/runtime` | `workItemDomainActionIntake/runtime` |
| Node | `workItemDomainActionIntake/proposals` | `workItemDomainActionIntake/proposals` |
| Node | `workItemDomainActionIntake/status` | `workItemDomainActionIntake/status` |
| Node | `workItemDomainActionIntake/issues` | `workItemDomainActionIntake/issues` |
| Node | `workItemDomainActionIntake/audit` | `workItemDomainActionIntake/audit` |

### workItemEffectPlanProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemEffectPlans/runtime` | `workItemEffectPlans/runtime` |
| Node | `workItemEffectPlans/admitted` | `workItemEffectPlans/admitted` |
| Node | `workItemEffectPlans/rejected` | `workItemEffectPlans/rejected` |
| Node | `workItemEffectPlans/effectRequests` | `workItemEffectPlans/requests` |
| Node | `workItemEffectPlans/results` | `workItemEffectPlans/results` |
| Node | `workItemEffectPlans/status` | `workItemEffectPlans/status` |
| Node | `workItemEffectPlans/issues` | `workItemEffectPlans/issues` |
| Node | `workItemEffectPlans/audit` | `workItemEffectPlans/audit` |

### workItemExecutionRecipe

| Kind | Before | After |
|---|---|---|
| Node | `workItemExecution/workItemSeeds` | `workItemExecution/seeds` |
| Node | `workItemExecution/plan/runtime` | `workItemExecution/plan/runtime` |
| Node | `workItemExecution/plan/admitted` | `workItemExecution/plan/admitted` |
| Node | `workItemExecution/plan/rejected` | `workItemExecution/plan/rejected` |
| Node | `workItemExecution/plan/effectRequests` | `workItemExecution/plan/requests` |
| Node | `workItemExecution/plan/results` | `workItemExecution/plan/results` |
| Node | `workItemExecution/plan/status` | `workItemExecution/plan/status` |
| Node | `workItemExecution/plan/issues` | `workItemExecution/plan/issues` |
| Node | `workItemExecution/plan/audit` | `workItemExecution/plan/audit` |
| Node | `workItemExecution/effectRuns/runtime` | `workItemExecution/effectRuns/runtime` |
| Node | `workItemExecution/effectRuns/effectRuns` | `workItemExecution/effectRuns` |
| Node | `workItemExecution/effectRuns/status` | `workItemExecution/effectRuns/status` |
| Node | `workItemExecution/effectRuns/issues` | `workItemExecution/effectRuns/issues` |
| Node | `workItemExecution/effectRuns/audit` | `workItemExecution/effectRuns/audit` |
| Node | `workItemExecution/effectRuns/views` | `workItemExecution/effectRuns/views` |
| Node | `workItemExecution/requestFacts` | `workItemExecution/requestFacts` |
| Node | `workItemExecution/requests` | `workItemExecution/requests` |
| Node | `workItemExecution/requestLedger/views` | `workItemExecution/requestLedger/views` |
| Node | `workItemExecution/requestLedger/issues` | `workItemExecution/requestLedger/issues` |
| Node | `workItemExecution/requestLedger/audit` | `workItemExecution/requestLedger/audit` |

### workItemSeedProjector

| Kind | Before | After |
|---|---|---|
| Node | `workItemSeeds` | `workItemSeeds` |

### workItemVerificationRequestLowerer

| Kind | Before | After |
|---|---|---|
| Node | `workItemVerificationRequests/runtime` | `workItemVerificationRequests/runtime` |
| Node | `workItemVerificationRequests/effectRequests` | `workItemVerificationRequests/effects` |
| Node | `workItemVerificationRequests/status` | `workItemVerificationRequests/status` |
| Node | `workItemVerificationRequests/issues` | `workItemVerificationRequests/issues` |
| Node | `workItemVerificationRequests/audit` | `workItemVerificationRequests/audit` |

### workItemVerificationResultMapper

| Kind | Before | After |
|---|---|---|
| Node | `workItemVerificationResults/runtime` | `workItemVerificationResults/runtime` |
| Node | `workItemVerificationResults/results` | `workItemVerificationResults` |
| Node | `workItemVerificationResults/proposals` | `workItemVerificationResults/proposals` |
| Node | `workItemVerificationResults/status` | `workItemVerificationResults/status` |
| Node | `workItemVerificationResults/issues` | `workItemVerificationResults/issues` |
| Node | `workItemVerificationResults/audit` | `workItemVerificationResults/audit` |

### workItemWorkQueueRecipe

| Kind | Before | After |
|---|---|---|
| Node | `workItemWorkQueue/submitCommands` | `workItemWorkQueue/submitCommands` |
| Node | `workItemWorkQueue/runtime` | `workItemWorkQueue/runtime` |
| Node | `workItemWorkQueue/evidence` | `workItemWorkQueue/evidence` |
| Node | `workItemWorkQueue/status` | `workItemWorkQueue/status` |
| Node | `workItemWorkQueue/issues` | `workItemWorkQueue/issues` |
| Node | `workItemWorkQueue/audit` | `workItemWorkQueue/audit` |

### workQueue

| Kind | Before | After |
|---|---|---|
| Node | `messageBus/publish` | `messageBus/publish` |
| Node | `messageBus/commands` | `messageBus/commands` |
| Node | `messageBus/runtime` | `messageBus/runtime` |
| Node | `messageBus/messages` | `messageBus/messages` |
| Node | `messageBus/status` | `messageBus/status` |
| Node | `messageBus/issues` | `messageBus/issues` |
| Node | `workQueue/jobs/admission/available/request` | `workQueue/jobs/admission/available/request` |
| Node | `workQueue/jobs/admission/available` | `workQueue/jobs/admission/available` |
| Node | `workQueue/jobs/admission/cursor` | `workQueue/jobs/admission/cursor` |
| Node | `workQueue/jobs/commands` | `workQueue/jobs/commands` |
| Node | `workQueue/jobs/admissionKick` | `workQueue/jobs/admissionKick` |
| Node | `workQueue/jobs/admissionPages` | `workQueue/jobs/admissionPages` |
| Node | `workQueue/jobs/runtime` | `workQueue/jobs/runtime` |
| Node | `workQueue/jobs/records` | `workQueue/jobs/records` |
| Node | `workQueue/jobs/status` | `workQueue/jobs/status` |
| Node | `workQueue/jobs/issues` | `workQueue/jobs/issues` |
| Node | `workQueue/jobs/admissionAckCommands` | `workQueue/jobs/admissionAckCommands` |

### workQueueLeaseExpirationCommandProjector

| Kind | Before | After |
|---|---|---|
| Node | `workQueueLeaseExpirationCommands/runtime` | `workQueueLeaseExpirationCommands/runtime` |
| Node | `workQueueLeaseExpirationCommands/commands` | `workQueueLeaseExpirationCommands` |
| Node | `workQueueLeaseExpirationCommands/status` | `workQueueLeaseExpirationCommands/status` |
| Node | `workQueueLeaseExpirationCommands/views` | `workQueueLeaseExpirationCommands/views` |

### workQueueReadinessHandoffProjector

| Kind | Before | After |
|---|---|---|
| Node | `workQueueReadinessHandoff/runtime` | `workQueueReadinessHandoff/runtime` |
| Node | `workQueueReadinessHandoff/candidates` | `workQueueReadinessHandoff/candidates` |
| Node | `workQueueReadinessHandoff/status` | `workQueueReadinessHandoff/status` |
| Node | `workQueueReadinessHandoff/issues` | `workQueueReadinessHandoff/issues` |
| Node | `workQueueReadinessHandoff/audit` | `workQueueReadinessHandoff/audit` |
| Node | `workQueueReadinessHandoff/views` | `workQueueReadinessHandoff/views` |

### workQueueScheduledReadinessProjector

| Kind | Before | After |
|---|---|---|
| Node | `workQueueScheduledReadiness/runtime` | `workQueueScheduledReadiness/runtime` |
| Node | `workQueueScheduledReadiness/readinessSchedules` | `workQueueScheduledReadiness/schedules` |
| Node | `workQueueScheduledReadiness/status` | `workQueueScheduledReadiness/status` |
| Node | `workQueueScheduledReadiness/issues` | `workQueueScheduledReadiness/issues` |
| Node | `workQueueScheduledReadiness/audit` | `workQueueScheduledReadiness/audit` |
| Node | `workQueueScheduledReadiness/views` | `workQueueScheduledReadiness/views` |

### workspaceProposalDomainActionApplicationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalDomainActionApplication/runtime` | `workspaceProposalDomainActionApplication/runtime` |
| Node | `workspaceProposalDomainActionApplication/status` | `workspaceProposalDomainActionApplication/status` |
| Node | `workspaceProposalDomainActionApplication/recorded` | `workspaceProposalDomainActionApplication/recorded` |
| Node | `workspaceProposalDomainActionApplication/issues` | `workspaceProposalDomainActionApplication/issues` |
| Node | `workspaceProposalDomainActionApplication/audit` | `workspaceProposalDomainActionApplication/audit` |

### workspaceProposalFamilyApplicationDiagnosticProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalFamilyApplicationDiagnostic/runtime` | `workspaceProposalFamilyApplicationDiagnostic/runtime` |
| Node | `workspaceProposalFamilyApplicationDiagnostic/diagnostics` | `workspaceProposalFamilyApplicationDiagnostic/diagnostics` |

### workspaceProposalFamilyApplicationReadModelProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalFamilyApplicationReadModel/runtime` | `workspaceProposalFamilyApplicationReadModel/runtime` |
| Node | `workspaceProposalFamilyApplicationReadModel/readModels` | `workspaceProposalFamilyApplicationReadModel` |

### workspaceProposalFamilyApplicationReadModelsProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalFamilyApplicationReadModels/runtime` | `workspaceProposalFamilyApplicationReadModels/runtime` |
| Node | `workspaceProposalFamilyApplicationReadModels/readModels` | `workspaceProposalFamilyApplicationReadModels` |

### workspaceProposalFamilyOutcomeDetailSupplyProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalFamilyOutcomeDetailSupply/runtime` | `workspaceProposalFamilyOutcomeDetailSupply/runtime` |
| Node | `workspaceProposalFamilyOutcomeDetailSupply/results` | `workspaceProposalFamilyOutcomeDetailSupply/results` |

### workspaceProposalProjectionReleaseDiagnosticProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalProjectionReleaseDiagnostic/runtime` | `workspaceProposalProjectionReleaseDiagnostic/runtime` |
| Node | `workspaceProposalProjectionReleaseDiagnostic/diagnostics` | `workspaceProposalProjectionReleaseDiagnostic/diagnostics` |

### workspaceProposalRepairActionDescriptorProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairActionDescriptor/runtime` | `workspaceProposalRepairActionDescriptor/runtime` |
| Node | `workspaceProposalRepairActionDescriptor/descriptors` | `workspaceProposalRepairActionDescriptor/descriptors` |

### workspaceProposalRepairActionDisplayPolicyAdvisoryProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairActionDisplayPolicyAdvisory/runtime` | `workspaceProposalRepairActionDisplayPolicyAdvisory/runtime` |
| Node | `workspaceProposalRepairActionDisplayPolicyAdvisory/advisories` | `workspaceProposalRepairActionDisplayPolicyAdvisory/advisories` |

### workspaceProposalRepairActionIntentProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairActionIntent/runtime` | `workspaceProposalRepairActionIntent/runtime` |
| Node | `workspaceProposalRepairActionIntent/results` | `workspaceProposalRepairActionIntent/results` |

### workspaceProposalRepairReviewDecisionRecordingProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairReviewDecisionRecording/runtime` | `workspaceProposalRepairReviewDecisionRecording/runtime` |
| Node | `workspaceProposalRepairReviewDecisionRecording/results` | `workspaceProposalRepairReviewDecisionRecording/results` |
| Node | `workspaceProposalRepairReviewDecisionRecording/decisions` | `workspaceProposalRepairReviewDecisionRecording/decisions` |
| Node | `workspaceProposalRepairReviewDecisionRecording/issues` | `workspaceProposalRepairReviewDecisionRecording/issues` |

### workspaceProposalRepairReviewProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairReview/runtime` | `workspaceProposalRepairReview/runtime` |
| Node | `workspaceProposalRepairReview/requests` | `workspaceProposalRepairReview/requests` |

### workspaceProposalRepairReviewStatusProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairReviewStatus/runtime` | `workspaceProposalRepairReviewStatus/runtime` |
| Node | `workspaceProposalRepairReviewStatus/statuses` | `workspaceProposalRepairReviewStatus/statuses` |

### workspaceProposalRepairSuccessorProposalIntakePreviewProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairSuccessorProposalIntakePreview/runtime` | `workspaceProposalRepairSuccessorProposalIntakePreview/runtime` |
| Node | `workspaceProposalRepairSuccessorProposalIntakePreview/previews` | `workspaceProposalRepairSuccessorProposalIntakePreview/previews` |

### workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/runtime` | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/runtime` |
| Node | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/results` | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/results` |
| Node | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/readyRequests` | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/requests` |
| Node | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/issues` | `workspaceProposalRepairSuccessorProposalReadyRequestPreparation/issues` |

### workspaceProposalRequiredInputResponseApplicationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalRequiredInputResponseApplication/runtime` | `workspaceProposalRequiredInputResponseApplication/runtime` |
| Node | `workspaceProposalRequiredInputResponseApplication/status` | `workspaceProposalRequiredInputResponseApplication/status` |
| Node | `workspaceProposalRequiredInputResponseApplication/recorded` | `workspaceProposalRequiredInputResponseApplication/recorded` |
| Node | `workspaceProposalRequiredInputResponseApplication/issues` | `workspaceProposalRequiredInputResponseApplication/issues` |
| Node | `workspaceProposalRequiredInputResponseApplication/audit` | `workspaceProposalRequiredInputResponseApplication/audit` |
| Node | `workspaceProposalRequiredInputResponseApplication/applied` | `workspaceProposalRequiredInputResponseApplication/applied` |

### workspaceProposalWorkItemLinkApplicationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalWorkItemLinkApplication/runtime` | `workspaceProposalWorkItemLinkApplication/runtime` |
| Node | `workspaceProposalWorkItemLinkApplication/status` | `workspaceProposalWorkItemLinkApplication/status` |
| Node | `workspaceProposalWorkItemLinkApplication/recorded` | `workspaceProposalWorkItemLinkApplication/recorded` |
| Node | `workspaceProposalWorkItemLinkApplication/issues` | `workspaceProposalWorkItemLinkApplication/issues` |
| Node | `workspaceProposalWorkItemLinkApplication/audit` | `workspaceProposalWorkItemLinkApplication/audit` |
| Node | `workspaceProposalWorkItemLinkApplication/linked` | `workspaceProposalWorkItemLinkApplication/linked` |
| Node | `workspaceProposalWorkItemLinkApplication/unlinked` | `workspaceProposalWorkItemLinkApplication/unlinked` |

### workspaceProposalWorkItemSpawnApplicationProjector

| Kind | Before | After |
|---|---|---|
| Node | `workspaceProposalWorkItemSpawnApplication/runtime` | `workspaceProposalWorkItemSpawnApplication/runtime` |
| Node | `workspaceProposalWorkItemSpawnApplication/status` | `workspaceProposalWorkItemSpawnApplication/status` |
| Node | `workspaceProposalWorkItemSpawnApplication/recorded` | `workspaceProposalWorkItemSpawnApplication/recorded` |
| Node | `workspaceProposalWorkItemSpawnApplication/issues` | `workspaceProposalWorkItemSpawnApplication/issues` |
| Node | `workspaceProposalWorkItemSpawnApplication/audit` | `workspaceProposalWorkItemSpawnApplication/audit` |
| Node | `workspaceProposalWorkItemSpawnApplication/created` | `workspaceProposalWorkItemSpawnApplication/created` |
| Node | `workspaceProposalWorkItemSpawnApplication/linked` | `workspaceProposalWorkItemSpawnApplication/linked` |
