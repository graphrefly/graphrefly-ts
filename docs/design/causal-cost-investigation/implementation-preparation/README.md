# currentness 最小实现批次：准备完成，未实现

Owner：`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。用户授权按候选排序完成实施准备；本记录不把准备授权解释为 library 实现或性能采集授权。沿用原 work，无新 D#。本稿收窄 comparison-proof/review.md 的通用 metadata 快速路径；历史证据不改写。

## 证据与恢复边界

源码的唯一 byRevision 写入点为 transition.ts:172 的 acceptOccurrence；receiveOccurrences 在 :237 先 canonicalSnapshot，然后进入 byRevision 或 pending。pending 提升复用该 entry。cloneState 只复制 Map 容器，entry.value 保持原引用。identity.ts:127–135 的 canonicalSnapshot 通过 dataKey 验证、JSON.parse 复制、递归 freeze。recomputeCurrentness 从这些 retained entries 取 occurrence，写入 currentness。

一个单独、无修改 bundle 的有限探针验证：深冻结的 retained occurrence 与 currentness.occurrence 同一对象；duplicate 后 state 和 byRevision Map 改变、occurrence 引用不变；展示 disconnect/connect 仍保留该 occurrence；cleanup 后 membership 为空。仅1个 consumer，无性能样本、无重试。shallow freeze 负对照不能满足深冻结检查。

三种路径必须分开：

- 同实例展示重新订阅：原 authority 继续拥有 canonical occurrence，属于已核实路径。
- 通用 restoreGraph：prepareCheckpoint 严格 JSON 校验；prepareRuntime/nodeRestoreState 不执行 causal canonicalSnapshot，也不重建 causal Map/Set。不能把通用 restore 视为 canonical provenance 的来源。
- 当前真实 consumer 的完整 checkpoint：探针首先在 spending/anomalyScore.ctxState 的 Map 处拒绝。这只证明当前完整 consumer 不能由该 checkpoint 原样往返，不能伪称探针已经到达 authority。authority 自身 RuntimeState 使用 Map/Set，源码显示同样不符合 strict-JSON ctxState；本批不引入其编码/恢复能力。

内部 runtime-accessors 和直接伪造 RuntimeState 不属于新增的受信来源。不能用“从某个 Map 读出来”独立证明 canonical。首批证明依赖现有 factory 的封闭写入链；将来若增加 causal 状态导入/恢复，必须审查这个调用点。不存在可用持久恢复 fast-path 承诺。本批保留通用 restore 的原有拒绝/接受语义。

## 明确实现范围

生产代码只改 `packages/ts/src/solutions/causal-occurrence/identity.ts`：一个不导出的 private 比较 helper，以及 recomputeCurrentness 内的比较调用点。其余 authority 写入、有限推进、ctx.state.set、发布对象与顺序、maybeRelease、lifecycle/evidence/retention 均不动。无需类型新增、公有 export、注册表、WeakMap 或任何跨调用缓存。

快速路径的全部条件：

1. 比较位于已核实的 recomputeCurrentness retained-entry 路径，当前 occurrence 来自上述 canonical ownership 链；root freeze 检查只能用于拒绝明显异常，不代替该来源证明。
2. 两个外层记录均为普通对象；通过 own descriptor 安全读取，恰好有 kind、occurrence、evaluatedThroughRevision、state 四个可枚举 data properties，无 symbol、accessor、non-enumerable 或额外属性。不得先读取 getter 再决定回退。
3. kind 为 causal-currentness，state 仅为 current 或 stale；水位符合生成路径的合法数值要求。任何不满足者原样调用旧完整 dataKey 比较。
4. 两个 occurrence property 都精确引用当前 canonical occurrence；等值但不同对象也回退。禁止只比较 digest 或 ref。

条件成立后，仅在两个短小的临时比较对象中把 occurrence 同时替换为 null，其余三个字段保持原值；调用原 dataKey 判断相等。保留旧 codec 的数值/排序语义。不要改实际输出记录，不保存临时对象，不在本批顺便优化 supersededBy 或 quiescence。

相等性证明：在 guard 的闭合输入域，完整 canonical record 中唯一被省略的是两边同一、不可变且已合法化的 subtree；其 canonical bytes 必定相同。两边替换同一常量不改变相等性。外层只允许这四个字段，不遗漏可选字段，因为存在任何可选/额外字段就回退。current↔stale 与水位变化仍可被剩余 metadata 检出。

比上一稿更小的地方：superseded/unverifiable、gap/missingRevision、所有额外字段全部回退，不要求通用 metadata parser 证明任意嵌套结构安全。收益可能比理论热点总量小，这是有意的风险约束。

## 实施验收清单

### 差分 oracle 与受信边界

旧 `dataKey(prior) !== dataKey(next)` 是独立行为 oracle。要求比较结果或应抛错误与旧逻辑一致：

- 四种 current/stale 组合；水位相同、不同、数字边界；property 插入顺序变化；prior 缺失。
- 同一 canonical occurrence 的小/大 payload；等值不同对象；同 id/digest 但内容不同；sourceRefs 变化。
- superseded/unverifiable、supersededBy/missingRevision/gapRef 所有分支及内容变化，证明走回退且变化未漏掉。
- 外层额外/缺失字段、symbol、getter/setter、non-enumerable、非普通 prototype、非法数字；getter 不因 fast-path guard 被额外调用。
- canonicalSnapshot 生成的真正深冻结数据与 shallow-frozen 假输入区分。直接测试 helper 的受信参数不可被当成公有输入准入；真实非法 occurrence 必须从实际输入 lane 检验，不能伪造 ctxState 后宣称属于支持的恢复接口。

### 真实运行与 mutations

既有独立业务 oracle + plain/reference：新 occurrence、重复同对象、重复等值对象、合法新 revision、replay conflict、错误/过期 admission、fan-out/fan-in。当前 admitted-no-outcome 遇到展示退订或 local stop 不得被结算；精确 outcome/terminal 才推进。验证输出 trace/order、authority 单次提交、清理和重新订阅。

至少包括真实加载变异：只比较 state、漏水位、只比较 digest、把不同 occurrence 对象误当可信、接受有额外字段的外层、跳过旧 fallback；以及沿用误结算义务/错误 admission 的既有 runtime mutations。修改后必须由独立预期拒绝这些变异，不能只测 helper 自身。

### 离线资格与成本

按用户要求完成全部离线测试和项目所需 lint/build/export/artifact/workspace/dashboard gates；历史失败按当前文件重新核实，不删除冻结证据或宣称不存在的全绿。QA 检查比较分支的覆盖、错误路径及潜在小对象新增开销。

本实现批次可证明 old/new semantic equivalence 和重复 payload traversal 被跳过的行为事实。并不自动授权新的性能 capture。集中成本复验方案需单独给出匹配 before/after 的分配、post-GC 存活堆、自然GC RSS、无插桩耗时预算；旧60-child grant不重用。不承诺解决256MiB上限或达到正式1.20/1.10门槛。

## Q5–Q9 复核

Q5：局部 identity 派生记录比较；不扩大 substrate/shared codec。Q6：closed factory provenance 是明确前提，任何状态导入变化触发复核；不把 shallow freeze 当证明。Q7：用户无新概念，graph数据与生命周期不变，临时数据只存在于一次调用。Q8：相比跨transition缓存/通用serializer重写，本方案更小且可回退；相比digest-only，保留完整语义。Q9：已满足值得进入实施验证的条件，尚未证明实现正确或成本改善；剩余条件全部列在验收中。

## 供批准的一个批次

仅上述 private helper/调用点、对应测试和真实 mutations、完整离线资格、QA、证据与 commit。若实际实现需要额外持久状态、修改 checkpoint、扩大 fast-path 到其他分支或放宽验证，停止该扩展并提交具体取舍。常规修复/测试在批准批次内连续完成，不拆成逐文件确认。
