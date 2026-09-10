# D167：按 owner 收敛登记与失败收尾

2026-09-10 · `graphrefly-ts:LIBRARY-REGISTRATION-TS` · 实现基线 `8e13d831`。
批准依据为 [具体设计](../library-registration-consolidation-v1.md) 与 [本批批准](approval.json)。
原设计文件保留当时的 proposal 文字；当前生效状态由 TS owner 的 D167 表示。

## 交付边界

Node 现在用一份 exact-identity 记录承载内部访问、Graph attachment、可选 backend
contributor 和退休后的失败证据。共享操作直接访问原 runtime，不复制 cache/deps/state。
Graph 的 restore/lifecycle 操作共用一个登记和原有索引；construction owners 按需创建。

普通 Node、Graph 工厂、operator initNode、fresh restore 和 D161 scope 复用有限取得记录。
新 handle 和部分 slot 在实际取得点记录；Graph 在发布前重验名字和依赖。用户 getter
先完成，再做最终校验和发布。失败只收尾未转交的资源；原异常与残余 locator 一起保留。

MessageBus 的已提交成员关系来自实际 deps，command body 读取当前 Ctx 的 depCount。
add/remove 操作进入原 batch boundary，执行时才计算实际下一份 deps。重复 add 不取得
第二份租约，rollback 后同一 disposer 仍能移除；已移除后 bus 终止也不影响 disposer 幂等。

没有新增公共 export、动词、用户选项或 wave protocol。collection bind disposal、Ctx
wave origins、WireEdgeGroup ack、外部 registry 和 capability issued 表不在本批。

## 可组合性、分级隐藏与 lifecycle

调用路径仍是用户已有的 graph/node、core/patterns/solutions 入口；本批内部登记不成为
用户需要学习的新概念。普通用户继续使用 business 投影，框架作者使用其 capability，
维护者检查实际 Graph。接口字段与 original identity 的测试只能证明分级访问机制仍在，
不能代替真实 human/agent 学习成本研究。

展示退订不结束运行实例。开始释放、关闭内部访问、runtime 静止、精确 terminal outcome
和 retained evidence 结束分别处理。既有 cold-assembly、committed-view、publication 和
preset/reference 测试继续检查退订/重订、错误 outcome、replay 和未结义务保留。

## 审查与证明

三个静态审查发现均已修复：发布后的 getter 重入窗口、重复 disposer 在终止后抛错，
以及 ConstructionScope 对尚未持久化的 runtime cleanup exception 遗失诊断。
回归测试实际触发这些路径；D161 原“晚期同名失败”测试改为 register 中重入，避免新
早期校验让该测试再也到不了它要验证的失败位置。

新的 D167 mutation 工具构建并加载真正修改的 runtime bundle，分别删除身份、handle/
slot 清理、访问关闭、batch cancellation、实际 deps 和租约保护。先验证模块可加载，再要求行为
断言检出。首轮 early-close mutant 只产生运行异常，明确记为未合格；补上“不应抛错”
断言后重跑，保留各轮原始 bundle 与日志，不把加载失败或编译失败当 mutation 通过。
复审还将原 ignore-batch-fate 标签校正为移除 adapter 操作延后，另加真正破坏原 batch
取消的 mutant；最终 11 个 mutation 均由行为断言检出。

旧构造诊断的工具测试现在绑定原冻结 archive，检查完整性和插桩前后字节还原，并验证
旧工具对 D167 Graph 形状 fail closed。未修改旧测量、阈值或 frozen source。D161/D162
资格脚本只更新已移动操作的源码定位，原行为断言与验收保持。旧 registration audit 是
带 hash 的历史证据，Biome 将它与其他 archive 一样排除格式改写；当前生产代码和测试
仍经过完整 lint/typecheck。

具体命令、结果、源码绑定、性能原始样本及已知失败见本目录的 `receipt.json`，原始产物
封装于 `archive/evals/library-registration-v1/evidence.tar.gz`，逐条文件 hash 在同目录 index。D159 的既有 manifest 不一致保持可见；未重写
其冻结收据。原 Causal 正式性能矩阵的 1.211671 拒绝和 80 行未运行状态保持不变。

## 用户复述与后续界线

本批复用此前 OWN/PREDICT：依赖不能悄悄丢失，运行实例掌握完整 lifecycle，入口按用户
等级隐藏。源码、测试和 trace 是工程验证；用户 teach-back 尚未验证。下一批工作不自动
启动，正式性能重试或剩余 package design 仍须按既有范围审阅。

供下次不看代码时回忆：入口在哪里？构造到发布的三个步骤是什么？谁可以释放资源？
哪种失败仍保留责任？测试已经证明什么、尚未证明什么？

## 最终结果

| 验证 | 结果 |
| --- | --- |
| D167 + D161 专项回归 | 30 + 28 通过 |
| 登记 / construction / cold assembly / occurrence runtime mutations | 11 / 25 / 16 / 73 检出 |
| 全量默认 suite | 2545 通过；2 个既有 D159 manifest 失败；4 跳过 |
| TS conformance | 77 通过，包含在全量 suite |
| 离线 root soak | 221 通过，1066.23 秒 |
| 诊断工具测试 | 21 通过 |
| lint/typecheck、browser、build/export | 通过 |
| frozen artifact gate | 保持拒绝既有 D159 manifest drift |

私有对照保留 6400 次构造（1600 warmup、4800 measured），无样本剔除。
四组修改前后拓扑各自一致：off 为 59 nodes / 89 edges，summary 为 60 / 93。
summary candidate 的 p95 从 287.792 → 313.916 微秒，以及 275.917 → 303.125 微秒，
即增加 9.08% / 9.86%。off 无一致增幅；reference 也使用相同底层修复，全部对照保留。
这说明本次有限样本存在额外冷构造成本，不能宣称“合表必然更快”或零性能负担。
稳态、内存、用户学习成本未由这个构造计时证明；原正式性能资格依然未通过。

本批结束于正确性修复、可审查的成本证据与 commit，不启动成本优化或正式矩阵重试。
人工无 AI 工时与返工时间未独立计量，不据此声称生产率提高；下次闭卷理解检查仍 pending。
