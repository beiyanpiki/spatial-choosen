# Code Review 报告：`agent/built-in-admin` 分支全量审查

- **日期**: 2026-08-18
- **分支**: `agent/built-in-admin`（对比 `main`）
- **审查范围**: `src/app/built-in-admin/**`（页面与组件, 约 1 万行）、`src/lib/built-in-admin/**`（配套库, 50 个文件约 2 万行）、`src/types/built-in-admin.ts`。全部为本分支新增代码。
- **审查角度**: 功能性、可读性、可维护性、数据安全、持久层一致性。

## 流程

16 个独立查找角度（逐行扫描 ×4、fork 漂移审计、跨文件追踪、语言陷阱、持久层/包装层审计、复用/简化/效率/分层/规范、补漏扫描）→ 约 70 个候选问题 → 30 个进入一对一验证（28 个 CONFIRMED / 6 个 PLAUSIBLE / 3 个 REFUTED）→ 按严重度取前 15。

## 验证后被否决的候选（供参考）

- "CSV 上传会把 sourceAssets 标记为 stale" — 实际 `invalidateOnSourceAssetsChange` 只标记下游 slice, 不成立。
- "fire-and-forget CSV payload 写入导致数据丢失" — full 模式在 `storage.ts:1471` 有 awaited 写入兜底, 不成立。

---

## 最终 Findings（按严重度排序, Top 15）

### 1. 导入项目包会静默覆盖同 id 的现有项目

- **文件**: `src/app/built-in-admin/page.client.tsx:544`
- **问题**: 导入保留了打包时的项目 id 并原样 upsert。若导入的包的 id 已存在, 会静默用包里的旧状态替换该项目（元数据 + 所有 IndexedDB payload store）— 无重复检查、无副本、无警告。
- **失败场景**: 用户导出项目 P（id X）后继续工作一小时, 再导入 P.zip 想对比: `storage.ts:1241-1243` 原地替换 metas[index], `storage.ts:1466-1472` 覆盖 id X 的 source/working/crop/tissue/chip-config store — 当前所有编辑被销毁, 仅有一条 "imported" 成功 toast, 落地页仍只显示一个项目。

### 2. full 模式先写元数据后写 payload, 失败无回滚 → 项目永久无法打开

- **文件**: `src/lib/built-in-admin/storage.ts:1460`
- **问题**: full 模式 `upsertPreprocessProject` 在 payload store 之前持久化项目元数据且无回滚（只有 'tissue' 模式有回滚）。payload 同步失败后, 元数据声明的图片 blob 缺失, `hydrateProject` 从此永远返回 undefined。
- **失败场景**: 上传大图后的首次 full 保存: `upsertPreprocessProjectMetadata` 在 1460 行提交, 随后 `syncImageStores`/`syncCropQcDerivedImageStores` 抛错（QuotaExceededError 或事务中止）; `storage.ts:1075` 的 `if (repairedMeta.sourceAssets.images.eosin && !eosin) return undefined` 在此后每次加载都触发 — 项目仍显示在落地页（`readPreprocessProjectSummaries` 跳过 hydration）但永远无法打开, 唯一恢复方式是删除。

### 3. 接受裸 .json 包导入 → 产生永远打不开的"幽灵项目"

- **文件**: `src/lib/built-in-admin/package.ts:1144`
- **问题**: `deserializePreprocessImport` 接受裸 .json 包（落地页输入框声明 `accept='.json,...'`）, 而 v2+ 时 `assertSourceImage` 只在 `version===1`（1108 行）才要求图片 dataUrl — 应用自己 `serializePreprocessProject` 产出的 v2+ json（dataUrl 已剥离）能"成功"导入为一个有图片元数据但无二进制 payload 的项目。
- **失败场景**: 用户从应用自己的 zip 导出中取出 project.json 并导入: 校验通过, `page.client.tsx:544` full 保存, `syncImageStores` 找不到 sourceBlob/dataUrl 什么都不写, 之后每次 `getPreprocessProject` 都命中 `storage.ts:1075-1076` 的 hydration 门槛返回 undefined — 成功 toast 之后是一个永久打不开的幽灵项目。

### 4. 缺失 store 的修复路径会把 DB 版本顶高 → 存储永久损坏（VersionError）

- **文件**: `src/lib/built-in-admin/storage.ts:334`
- **问题**: missing-store 修复路径以 `PREPROCESS_DB_VERSION+1`（332-335 行）重开 DB, 但从不记录被顶高的版本。此后每次 `openDb`（请求 version 8）打开的都是 version-9 数据库, 以 VersionError 拒绝 — 全代码没有任何 deleteDatabase/VersionError 恢复路径。
- **失败场景**: 升级被中断（正是修复代码注释里预期的场景: 热重载与版本提升竞态）: store 在 version 9 创建, 修复成功 resolve; 下一次 `saveStoreValue`/`readStoreValue`（每次操作都调用 openDb, 549/556/568 行）对 version-9 DB 执行 `indexedDB.open('spatial-builtin-admin', 8)` → VersionError — 之后所有读/写/删全部 reject, `/built-in-admin` 路由下所有项目不可访问, 直到用户手动清除站点数据。

### 5. 迁移/导入不回填 chipConfig 必填字段 → Step 2/Step 6 白屏

- **文件**: `src/lib/built-in-admin/migrations.ts:745`
- **问题**: `normalizeChipConfigSlice` 只回填 `removeExcludedRowsFromExport`, 留下 `excludedRows`/`excludedColumns`（以及 `barcodesByPosition`、`log2nGeneByPosition`、`csvFileName`、`spotDiameter`）在迁移/导入项目中为 undefined, 而类型声明它们是必填; `package.ts` 的 `assertChipConfigSlice`（843-860 行）一个都不校验 — 消费方随后无守卫地解引用 `.length`。
- **失败场景**: 导入来自 `/preprocess` 孪生页面的 v4 project.json, 或打开 pre-97a6caa 保存的旧项目（`?? false` 回填的存在证明预期会有旧 payload）: 一旦设置了 rows/columns, `ExclusionControls.tsx:82` 的 `{excluded.length} excluded` 在渲染期间抛 TypeError, `PreprocessWorkspace.tsx:1481` 的 `config.excludedRows.length === 0` 使工作区崩溃 — 该项目 Step 2 与 Step 6 白屏。

### 6. 页面隐藏/卸载时丢弃 pending 的 tissue 模式自动保存

- **文件**: `src/app/built-in-admin/page.client.tsx:383`
- **问题**: `flushPendingProjectSnapshot(synchronousMetadata=true)` 清除了 pending snapshot 但只持久化 'metadata' 模式, 因此 300ms 防抖的 'tissue' 模式保存（`PreprocessWorkspace.tsx:2368/3348` 为每次手动 tissue 编辑调度）在 visibilitychange-hidden、pagehide、beforeunload、项目切换和卸载时被静默丢弃。
- **失败场景**: 用户切换/刷选 tissue spots 或点 Invert selection 后 300ms 内切换标签页或点"返回项目列表": 377 行将 `pendingSnapshotRef` 置 null, `mode==='tissue'` 分支跳过写入直接返回, 定时器被取消 — 编辑只存在于内存中, 页面关闭即丢失; `autosaveStatus` 也永远卡在 'saving…'（427 行设置, 再无 resolve）。

### 7. chip manifest 拉取失败持久化 error 状态且重试被守卫挡死

- **文件**: `src/app/built-in-admin/components/PreprocessWorkspace.tsx:1921`
- **问题**: chip-manifest effect 服务的是死状态（chip 类型改为 CSV 固定后 chipManifests 从不渲染）, 但拉取失败时会把 chipConfig 变更为 `status:'error'` 并以默认 full 模式持久化, 且 effect 自身的守卫（1906 行）随后挡住一切重试 — 包括 reload 之后 — 永久卡死导出与 tissue 自动检测。
- **失败场景**: 在 Step 5/6 时 `/built-in-admin-chip-configs/{50um,15um}/manifest.json` 一次瞬时失败（离线、dev-server 抖动）: 即使 chipConfig 已经 complete, 也会写入持久的 error 状态; `exportBundle.ts:337-341` 随后返回 `canExport:false`（"Spot projection is stale or incomplete"）, `runTissueAutoDetection` 同样被挡 — 导出和检测保持 blocked, 直到用户重做整个 crop-QC 链或重新导入 CSV。

### 8. normalizeCropQcSlice 在 stale 时清空显式几何且每次自动保存回写

- **文件**: `src/app/built-in-admin/projectState.ts:122`
- **问题**: `normalizeCropQcSlice` 在 `status==='stale'` 时把显式存储的 `eosinReferenceGeometry`/`heQcGeometry` 置 null（守卫 `canUseLegacyGeometryFallback` 可证明是被反转的死代码）, 而 `storage.ts` 的 `repairCurrentSchemaCropGeometry` 刻意为 stale slice 保留显式几何 — 且 `normalizeProjectForPersistence` 在每次自动保存时运行, null 结果被永久写回存储。
- **失败场景**: 用户在 CropQcPanel 点 "Reject to alignment"（置 `status:'stale'` 但内存中保留几何）: 下一次自动保存持久化被清空的 `eosinReferenceGeometry`/`heQcGeometry`/`cropRect`; reload 后 canonical crop 几何消失且无法恢复 — 119-120 行永远为真的死条件 `!isStale || hasExplicitEosinReferenceGeometry` 表明显式几何的例外本来是有意设计, 只是被写反了。

### 9. lockTissueSelectionSlice 破坏性且不可逆

- **文件**: `src/lib/built-in-admin/exclusion.ts:124`
- **问题**: 剔除行列会把矩阵单元置零并从 `selectedSpotIds`/`autoSelectedSpotIds` 剥离 id, 而取消剔除原样返回 slice（112-114 行）, 被销毁的选择永远无法恢复。
- **失败场景**: 用户完成 tissue 选择后在 Step 2 剔除第 10 行（`PreprocessWorkspace.tsx:1486` 的 effect 提交 locked slice）, 再取消勾选第 10 行: 矩阵保持为零, 导出永远为所有第 10 行 spot 派生 `in_tissue=0`; 即使部分取消（[3,5] → [3]）也无法让第 5 行回来, 唯一恢复方式 — 重跑自动检测 — 会抹掉所有手动修正（与头注释 "the grid stays in place everywhere" 矛盾）。

### 10. 导出只剔除行不剔除列, 与 Step 2 预览不一致

- **文件**: `src/lib/built-in-admin/exportBundle.ts:151`
- **问题**: 开启 "Remove excluded rows from export" 后, `compressExcludedRows` 只剔除被剔除的**行** — `excludedColumns` 在 exportBundle.ts 中从未被引用 — 而 Step 2 预览（`compactSpotGridForDisplay`, `spotGridTile.ts:153-160`）同时移除行和列, 导出的 CSV 与用户在屏幕上验证过的网格不一致。
- **失败场景**: 用户剔除 2 列, 打开预览开关 "Remove excluded rows/columns"（`PreprocessWorkspace.tsx:2749`）验证压缩后的网格, 然后开着导出开关导出: tissue_positions.csv 仍包含所有被剔除列的 spot（`in_tissue=0` + 模板占位条形码）, tissue_matrix.csv 保留全部 64 列（被 `exportBundle.test.ts:750` 固化）— 下游消费者收到了策展人以为已移除的行。

### 11. 两个导出文件的行方向相反

- **文件**: `src/lib/built-in-admin/exportBundle.ts:274`
- **问题**: tissue_positions.csv 的 `array_row` 自下而上编号（`rows + 1 - spot.arrayRow`, 242 行, 升序排列）, 而 tissue_matrix.csv 按内存顺序输出行（第 1 行 = 图像顶部行, 274-276 行）, 两个导出文件以相反的物理方向遍历行, 且矩阵无表头消歧。
- **失败场景**: 导出任意项目并按位置把矩阵第 i 行 join 到 `array_row=i`: 矩阵第 1 行（图像顶部的激活行）与 `array_row=1`（图像底部的 spot 行）配对 — 一张垂直翻转的激活网格挂到了错误的条形码上, 零剔除时也会发生; 仓库自己的测试把两种顺序并排固化（`exportBundle.test.ts:729-730` vs `751-755`）。

### 12. CSV 重导入无条件重置定位框, 手动摆位丢失

- **文件**: `src/app/built-in-admin/components/PreprocessWorkspace.tsx:1345`
- **问题**: `handleUploadCsv` 在每次 CSV（重）导入时无条件用 `createDefaultChipBounds` + 默认图像 transform 重建定位, 即使芯片类型和图像都没变也丢弃用户手动放置/旋转/缩放的捕获框（不存在 same-chipType 分支）。
- **失败场景**: 用户在 Step 2 精确定位并旋转了组织上方的捕获框, 然后为同一芯片重导入一份修正过的 tissue activation CSV（上传器在 748-750 行明确提供 "re-upload" 变体）: chipBounds 跳回居中默认值（`localization.ts:39-49`）, 摆位工作静默丢失, heFocus/alignment/cropQc/tissueSelection 全部被重置（1359-1366 行）— 尽管只把下游标 stale 即可保留摆位。

### 13. 项目删除无任何确认

- **文件**: `src/app/built-in-admin/components/PreprocessLanding.tsx:195`
- **问题**: 卡片上的删除是单击一个小型 ghost X IconButton — 路径上没有任何 AlertDialog 或 window.confirm — 而 `deletePreprocessProject` 不可逆地移除元数据行加每一个 IndexedDB payload store（source/working/crop 资产、tissue 矩阵、CSV 条形码）。
- **失败场景**: 用户瞄准相邻的 "Open workspace" 按钮却点中小 X: 数小时的对齐地标、crop QC 和 tissue 标注瞬间销毁且无撤销 — `page.client.tsx:512-516` 直接调用 `deletePreprocessProject`, 仅有一条事后 toast 确认删除。

### 14. 未检测时 "Invert selection" 生成全选矩阵

- **文件**: `src/app/built-in-admin/projectUpdates.ts:165`
- **问题**: `buildInvertedTissueSelectionState` 在 `current.matrix` 为 null 时创建全零矩阵再反转成全 1 并置 `status:'complete'`, 而 "Invert selection" 按钮只被 `isUnsupported || isDetecting` 禁用（`TissueSelectionControls.tsx:231`）— 不要求检测已运行。
- **失败场景**: Step 1 的 CSV 刚固定 chipConfig（complete、supported）后, 用户到达 tissue 步骤并在点 "Detect Tissue Spots" 之前点了 "Invert selection": 每个 spot 都被选中, tissueSelection 被标记为 complete 并持久化, 导出的 tissue_positions.csv 对整个芯片携带 `in_tissue=1` — 从未检测过组织且无任何警告。

### 15. 单击 spot 忽略激活/失活工具, 退化为纯 toggle

- **文件**: `src/app/built-in-admin/components/PreprocessWorkspace.tsx:2337`
- **问题**: `commitManualTissueSelection` 的 spotId 分支丢弃了由 tissueTool 推导的 nextValue（2331 行构建）, 导致 `buildManualTissueSelectionState` 退回纯 toggle 语义, 单击 spot 忽略所选的 activate/deactivate 工具（只有刷选编辑遵守它）。
- **失败场景**: 用户选择 "Mark as background"（失活）工具后点击一个已失活的 spot（例如边界附近的误点）: `projectUpdates.ts:87-104` 将其 toggle — 该 spot 被**加入** `selectedSpotIds` 且矩阵单元置 1, 与所选工具恰好相反 — 错误单元经防抖的 tissue 模式保存持久化进导出矩阵。

---

## 次级清单（受 15 条上限被裁掉的已确认问题, 建议一并修复）

| # | 位置 | 问题 |
|---|------|------|
| 1 | `tissueCsvImport.ts:143` | 芯片类型仅凭最大行列推断: 裁剪过的 CSV（如 63×64）直接报错拒绝; 开启"导出剔除行"后的产物（如 92×96）无法再次导入, 特性无法自回环。 |
| 2 | `PreprocessWorkspace.tsx:265` | 检测阈值静默钳制到 0.3（输入框允许 0..1）, 且 0.3 会被写回状态覆盖用户输入。 |
| 3 | `PreprocessWorkspace.tsx:3455` | `revokeObjectURL` 在 `anchor.click()` 后同步调用, Safari/Firefox 下载可能中断。 |
| 4 | `storage.ts:1241` | metas 整体读-改-写无跨 tab 串行化: 多 tab 并发可丢失更新或"复活"已删除项目。 |
| 5 | `safety.ts:10` | 图片入库仅有 512MB 字节上限, 无像素上限; 接受 .tif 且全尺寸解码, 20000×20000 压缩 TIFF 可直接 OOM; `oversizedImageWarning` 为死代码。 |
| 6 | `page.client.tsx:39` | `workingObjectUrl`（单张最高 10MB 代理）从未 revoke, 长会话内存泄漏。 |
| 7 | `exclusion.ts:81` | 列剔除写入无越界检查, 导入的非法 `excludedColumns` 会破坏矩阵长度, 之后每次 tissue 操作都抛错。 |
| 8 | `PreprocessWorkspace.tsx:1440-1514` | 剔除/导出开关变更不失效 exportState, 绿色"已完成"状态与实际导出内容不符。 |
| 9 | `tissueCsvImport.ts:118/161` + `exportBundle.ts:259` | `Number('')===0` 绕过整数校验（0 基 CSV 静默丢行列）; 重复 row:col/条形码后写覆盖; 导出/导入均无 CSV 引号转义。 |

### 可维护性（复用/简化/规范）

- `src/lib/built-in` 与 `src/lib/built-in-admin` 八个文件逐字节相同且已发生漂移（a53afd2 修复只落在一边）。
- 3 份手写 base64 解码; `spotGridTile` 本地重写 `isSpotExcluded`。
- 死代码: `ChipConfigPanel`、chipManifests 状态、legacy localStorage 迁移。
- 200 余行重复的 transform/threshold 处理块。
- 相对路径导入违反 AGENTS.md 的 `@/` 别名约定等。

---

## `--comment` 说明

审查目标为分支 `agent/built-in-admin`, 该分支没有对应的 GitHub PR（`gh pr list --head agent/built-in-admin` 为空）, 因此无法以 inline comment 形式提交, findings 已完整记录于本报告。如需 inline 评论, 请先创建 PR 后重跑 `/code-review --comment`。
