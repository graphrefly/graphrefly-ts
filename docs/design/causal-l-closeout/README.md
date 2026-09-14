# L-B 离线 lint 收尾

已实施批准的 H/L 设计中 L-B；基线 `922a7586`，唯一工作 owner 为
`graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS`。本批是开发工具及证据边界修复，
不修改 library、公共 API、wave、authority 语义或性能预算，不新增资格。

原清单 324 个文件全部处理；另处理 H 收尾清单自身的格式，共 325 个文件：

- 253 个冻结文件按精确路径排除。103 个原文件在 54 个已提交归档中找到相同成员；
  工具原版、旧 index/receipt/owner hash 绑定另外经基线 Git 字节核实后保存归档。
  `frozen-files.json` 逐项绑定 archive hash/member/hash；`preservation-index.json` 保留出处。
  253 项包括 26 个工具原版、一个引用的 Node 源码片段、一个生成 bundle 及证据 JSON。
- 4 个未提交展开副本可缺失：三个 latency inputs 和 count-worker bundle。
  若存在仍验字节，归档始终必需。已验证不含这四个文件的干净临时副本。
- 72 个未找到字节绑定的 JSON 仅格式修复，逐个与基线解析值深比较相等。
  检索覆盖本仓 tracked 文本及 root authority/plan/decision；不改字段、测量值或状态。
- 26 个工具创建同目录 `-lint-v1.mjs` 维护版，原名仍指历史版本；映射见
  `maintenance.json`。新的调用者应显式选择维护版，不能用它替代旧收据中的工具摘要。
  23 个非 fixture 工具做规范化源码比较；唯一非格式局部编辑是一个无重赋值变量
  `let → const`。child 使用维护版 driver；三个 fake-host fixture 实际执行维护版。
  verifier 的固定输出另命名 `verification-lint-v1.json`，避免覆盖旧验证报告。

这是源码维护验证，不是旧实验重放或新的性能验收。导入声明排序、格式、维护版相对路径和
上述局部 const 编辑在比较中显式处理；归档内工具仍保留原始字节。维护版 builder/probe
本轮没有运行真实 consumer 性能 capture，也未产生可继承的旧资格。

`lint` 现在先执行 `scripts/check-causal-lint-evidence.py`，再运行原 Biome/async/type gates。
已有排除列表由独立固定摘要锚定；新增排除只能是 manifest 中的字面文件路径。
不排除整个 docs/design，也不泛化所有 raw 目录。本 worktree 没有设计中提及的
aligned-capture/raw，因此未加入一个无法逐成员核对的空目录豁免。
Python 检查使用自身离线测试，未声称 Biome 检查 Python。

验证结果：

- 253 文件 / 24 归档完整性通过；旧文件未变。11 个边界测试通过，包括文件/归档损坏、
  错误成员、丢失必需文件、symlink、config 与 manifest 同时扩大排除、glob 注入，
  以及真实 Biome 对新维护工具错误的拒绝。
- 72 JSON 解析值比较、23 规范化源码比较、3 fake-host fixture 通过。
  每个 fixture 121 次 fake 构造与释放，拒绝第二模块；真实 consumer 执行次数为 0。
- 默认离线测试 **2571 passed / 4 skipped**；完整 Biome（0 errors、0 warnings）、
  async/typecheck/test typecheck、runner build、package build/export 均通过。
  Biome 仍有 20 条 informational useTemplate 提示，未当成错误，也没有关闭其规则。
- H 历史完整性命令通过；原严格 artifact regeneration 仍以 implementation manifest drift
  拒绝当前源码。这是保留资格边界，不能写成当前 D159 或正式性能已合格。
- 两位独立只读 reviewer 审查边界和证据。已修复首次审查提出的基线排除自证、干净 checkout
  缺展开文件、glob 注入三个问题；对应负对照均通过。

可复核命令（仓库根目录）：

```sh
python3 scripts/check-causal-lint-evidence.py
python3 scripts/test-causal-lint-evidence.py
node scripts/check-causal-lint-maintenance.mjs
pnpm run lint
pnpm test
```

本批没有新增性能优化或测量，不能从 lint 通过推导内存/延迟改善。
H/L 收尾完成；当前 D159 资格与 D169 正式性能资格仍未恢复，assembly 和渐进披露验收
也未因此完成。下一步可恢复剩余产品/分层验收讨论，不需继续为本批重复跑性能诊断。
