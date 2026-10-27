# 回退 / 修改 方案（按 m02113 的五条需求）

> 需求原文：「回退就是撤回更改，修改是标注放到后续的对话中继续修改。在确认之前可以作为内存缓存存储，可以单独退回一个文件或者整个更改，可以在撤回来，内存保留三到五轮的更改。」

## 0. 一句话结论

**不需要保存两侧全文，也不需要新的持久化存储 —— 保存 patch 就够了。**

因为 diff 满足「hunk 之外两侧相同」，所以：

- 回退 = 把 patch **反向**应用到当前磁盘内容；
- 再撤回 = 把同一个 patch **正向**应用回去。

两个方向都由现有的 `hunks` 算出来，`workspaceChanges` 不暴露原文这一限制因此不成立。
连"最近 5 轮 patch 缓存"都不用新加 —— 那一份记录本来就存在 `workspaceChanges` 里（见 §4）。

**状态：P1–P5 全部完成，`npm test` 三套绿，并已逐项在 DSH 页面上真机点通。**

## 1. 关键前提：往返校验

反向应用前必须确认「当前磁盘内容 == patch 的 after 侧」。否则用户在本轮之后又改过文件，回退会写坏。

做法（纯函数，可单测）：

```
before = reverseApply(hunks, current)      // 由 hunk 反推
forwardApply(hunks, before) === current    // 自洽校验，必须逐字节相等
```

第二步是关键安全阀：它同时验证了换行符（CRLF）、末尾无换行、coarse patch（超时降级成整文件 `-全部/+全部`）这几种容易漂移的情况。校验不过就**拒绝写入**，返回可读原因，绝不半信半疑地写。

哈希用于「打开审阅时」和「点回退时」之间的时间差检测：审阅时记 `sha256(current)`，回退前重算，不等则返回 `STALE`。

**实现时的取舍**：没有再单独存 hash，改为直接用上面的往返自洽校验 + `stat` 拿到的 `version` 做乐观锁（§3）。两个机制覆盖面重叠，`version` 是文件系统给的真值，比自算的哈希更可靠，也少一处要维护的字段。

## 2. 五种文件状态与回退动作

`recorder.diff()` 已经返回 `before: boolean` / `after: boolean`，直接用来判定：

| 状态 | before | after | 回退动作 |
| --- | --- | --- | --- |
| 普通修改 | true | true | `reverseApply` → `writeText(replaceIfVersion)`，`shape: 'rewrite'` |
| 本轮新增 | **false** | true | 无法删除（`ctx.fs` 没有 remove）→ 写空文件，`shape: 'empty'`，见 §6 |
| 本轮删除 | true | **false** | `reverseApply(hunks, '')` → `writeText(createIfAbsent)`，`shape: 'restore'` |
| 改名 | true | true | 两个路径分别处理（各自是一次普通修改） |
| 二进制/超大 | — | — | 一开始就不给回退按钮（`disabled`） |

`coarse === true`（对比超时，整文件一个 hunk）单独拒绝，`code: 'COARSE'`：那种 patch 精度不足以安全反向应用。

## 3. 写入安全

每次写都走乐观锁，不用无条件覆盖：

```
const info = await fs.stat(target)            // undefined = 不存在
const intent = info ? { kind: 'replaceIfVersion', version: info.version }
                    : { kind: 'createIfAbsent' }
await fs.writeText(target, next, intent, undefined, policy)
```

第 5 个参数 `policy` 是**必须给**的：`dsh-fs-sandbox` 在 `sandboxPolicy === undefined` 时回退到部署默认模式（通常比会话自己的窄），写盘会被拒。正确来源是 `sandboxPolicy.resolve({ session })`，与会话自己的工具用同一套策略 —— 回退是撤销 agent 自己做过的写入，本来就该被同一策略审，不该更松也不该更紧。

冲突（`FS_STALE_VERSION`）不重试、不吞掉，逐个文件回报给前端：
`{ path, ok: false, code: 'STALE', message: '…' }`。**Host 只回 code 与英文 message，展示用的措辞由浏览器按 `refusalKey(code)` 选**，翻译不用改 Host。

批量回退的语义：**先把全部目标内容算完（纯函数，失败都不写），再逐个落盘**。允许部分成功，结果按文件列表回报。
整轮请求带 `Accept: application/x-ndjson` 时，返回 `ReadableStream`，每个文件一条 JSON 行（`{step:'plan'|'write'}`，最后 `{step:'done'}`），前端据此显示进度；不带该头时仍是普通 JSON，向后兼容。

## 4. 最近几轮从哪来（最终做法：不新建缓存）

原方案打算在插件里再放一个 5 轮的 LRU，存 `{ seq, turn, files: [...hunks] }`。**实现时没这么做**，理由是它和 `workspaceChanges` 自己的记录重复：

`dsh-workspace-changes` 已经把每一轮的 summary 与两侧快照留在内存里（`records: Map<sessionId, Recorder>`，快照落在 `mkdtemp` 的临时目录），`summary(sessionId, seq)` / `diff(sessionId, seq, index, signal)` 就能按 seq 取回任何一轮。再存一份只会多一处会走味的副本。

所以只加了 `RECENT_TURNS = 5` 这一个上限，由 `recentTurns(sessionId)` 实现：

```js
const RECENT_TURNS = 5
// 倒序扫 session.ownEvents()，取 type === 'workspace/changes' 的 seq，
// 要求 changes()?.summary(sessionId, seq) !== undefined（记录已被回收的轮次不列出，
// 否则点开会得到一个只会说"不可用"的面板），按 turn 去重，最多 5 条。
```

返回 `{ turn, seq, files, added, deleted }`，**不含 cwd**（cwd 只在 Host 内用）。
配套路由：`GET /api/diff-review.turns?sessionId=`。前端顶栏的轮次下拉按**轮次号**记选择，不是按位置 —— 新轮次从前面插进来，位置会指向别的轮次。

语义上仍是"内存里保留最近几轮"（重启即丢），与需求一致，只是这份内存本来就有。

## 5. 路由清单

已实现 12 条（`npm test` 的 host contract 逐一断言）：

| 路由 | 方法 | Body / Query | 用途 |
| --- | --- | --- | --- |
| `diff-review.latest` | GET | `?sessionId=` | 最新一轮的坐标，带 `state: recorded / running / empty` |
| `diff-review.turns` | GET | `?sessionId=` | 最近 5 轮列表（只列记录仍有效的轮次） |
| `diff-review.summary` | GET | `?sessionId=&seq=` | 一轮的文件清单与合计 |
| `diff-review.diff` | GET | `?sessionId=&seq=&index=` | 单个文件的逐段对比 |
| `diff-review.state` | GET | `?sessionId=&seq=` | 这一轮已记录的决策 |
| `diff-review.confirm` | POST | `{ sessionId, seq, path?, all?, undo? }` | 记一条决策 / 撤销 / 批量 |
| `diff-review.revert` | POST | `{ sessionId, seq, path? | all? }` | 反向应用，真实写盘；`Accept: application/x-ndjson` 时流式回报 |
| `diff-review.restore` | POST | 同上 | 正向应用，撤销回退 |
| `diff-review.note` | POST | `{ sessionId, seq, path, text, hunk? }` | 新增一条审阅意见 |
| `diff-review.enote` | POST | `{ sessionId, seq, path, at, text }` | 改写一条已有的意见（键不变） |
| `diff-review.unote` | POST | `{ sessionId, seq, path, at }` | 删掉一条意见（最后一条删完同时回收 `edited` 标记） |
| `diff-review.notes` | GET | `?sessionId=&seq=` | 这一轮的全部意见 |

回退成功后在 decisions 表里把该文件记为 `reverted`，`restore` 成功后删掉那条记录（`pending` 就是"没有记录"）。
`revert` / `restore` 的每个结果都带 `shape`：`rewrite`（普通改写）、`empty`（本轮新建，清空）、`restore`（本轮删除，重建）。

## 6. 本轮新增的文件：删除怎么办

`ctx.fs` 只有 `readText / writeText / editText / stat / lstat / listDir`，**没有删除**；`dsh-tool-fs` 也只暴露 read/write/edit/read_image。

已按 **A** 实现（写空文件），并把这条限制如实告诉审阅者：

- 文件列表行带一个「新增」标记（`createdFiles`，来自对比的 `before === false`），悬浮提示说明"回退会把它清空，而不是删除"，让审阅者在点之前就知道。
- 回退后的提示换成专门的文案（`review.emptiedOne` / `review.emptiedAll`），说明文件还在磁盘上、只是 0 字节，要删请自己删。
- Host 侧把 `shape: 'empty'` 随结果回报，浏览器据此选文案；措辞归浏览器，翻译不用改 Host。

**B（通过 `ctx.shell` 真删）没做**：`dsh-shell` 是 abstract `ShellExecutor`（`resolve()` / `execute()`），能删干净，但沙箱可能拒绝，失败路径要另做一套，收益不值得这份复杂度。

## 7. 修改 = 标注（送进后续对话）

数据放新表 `notes`（**版本保持 1**，理由见下）：

```
{ sessionId, seq, path, hunk?, text, at }
```

**为什么不升版本**：DSH profile 里的 `<dshHome>/storages/diff_review.json` 是 `single` 布局。`dsh-storage-json` 的 `openSingleUnit` 走 `parse(text, descriptor)`，版本不严格相等就抛 `version-mismatch`；`compatibleVersions` 只在 `per-record` 布局里生效。升到 2 会让既有 decisions 全部打不开。加一张未声明的表是安全的：加载为空。

点击「修改」展开输入框，回车/Ctrl+Enter 保存。多个意见汇总成一段 Markdown：

```
请按这些审阅意见修改本轮改动的文件：
- D:\…\src\a.ts
  - 这里的错误分支要保留原异常
- D:\…\src\b.ts
  - 函数名改成 readSummary
```

**送达对话的通道**（已实现，最终方案）：

`lib/client.js` 的 `apply(ctx)` 里加 `composerFor(sessionId)`，`inject` 增加 `sessions` 与 `conversation`：

```js
const composerFor = (sessionId) => {
  const actx = ctx.sessions.scope(sessionId)          // 拿到 session 作用域
  const conversation = actx.get('conversation')       // root singleton，但 for() 要 actx
  const input = conversation.input.for(actx)          // 不传 actx 会抛
  return { draft: () => input.state.getSnapshot().draft, setDraft: (text) => input.setDraft(text) }
}
```

- `mergeDraft(existing, text)`：输入框里已有草稿时保留它，再换行接上汇总；空的就直接放汇总。**不覆盖用户正在写的东西**。
- `sidebar.right.pane.tab` 的 `inject` 回调签名是 `(sessionId, actions?) => I`（`dsh-cordis-client-runner` 的 `ScopeOf<K> === 'session'`），所以能拿到 sessionId。
- 底线：`composer` 拿不到时按钮照样工作，只是没有"放进输入框"这一步，意见仍在面板里可读可复制。

## 8. UI 变化（已完成）

- 顶栏三按钮全部可用：`确认` / `回退` / `修改`。
- 已回退状态时 `回退` 变 `撤销回退`、整轮按钮变 `撤销整轮回退`；pill 显示「已回退」。
- 回退的拒绝原因按 code 本地化（`refusalKey`）：`STALE` / `COARSE` / `UNSUPPORTED` / `MISSING` / 其他。
- 底栏：`已确认 2 / 7` + `全部确认` + `回退整轮`。
- 详情页顶部：轮次选择器（最近 5 轮，按轮次号记选择）。
- 意见行：`✎ 文件名 · 文本` + 改（✎）+ 删（×）。
- 新增文件在列表里带「新增」标记。
- 字体跟随「外观 → 字体」设置：正文用 `var(--dsw-font-family)` + `--dsh-content-font-delta`，代码区用 `var(--ds-font-family-code)` + `--dsh-code-font-delta`。

## 9. 阶段划分（全部完成）

| 阶段 | 内容 | 是否碰磁盘 | 状态 |
| --- | --- | --- | --- |
| P1 | 撤销确认、`已确认 X/N`、全部确认、列表 ↑/↓ + Enter | 否 | 完成 |
| P2 | `reverseApply` / `forwardApply` 纯函数 + 单文件回退 + 往返校验 + 撤销回退 | 是 | 完成 |
| P3 | 整 turn 回退（先算后写，NDJSON 流式进度）+ 最近 5 轮切换 | 是 | 完成 |
| P4 | 标注：`notes` 表 + 汇总 + 写进输入框 + 改 / 删 | 否 | 完成 |
| P5 | 新增文件策略：写空文件 + UI 明示 | 是 | 完成 |

P2 的纯函数可以完全单测：`forwardApply(hunks, reverseApply(hunks, after)) === after`，`test/patch.mjs` 用 14 个用例跑真实 `structuredPatch` 输出。

## 10. 风险与踩过的坑

- **换行细节**：靠 §1 的往返校验兜住，校验不过就拒绝，不猜。
- **`AbortSignal.any` 拒绝 undefined**：`recorder.diff()` 内部 `AbortSignal.any([signal, lifetime])`，不传信号会抛 `signals[0] is not of type AbortSignal`。必须传一个真信号。
- **沙箱策略要显式传**：`dsh-fs-sandbox` 在 `sandboxPolicy === undefined` 时回退到**部署默认模式**（通常比会话自己的窄），于是写盘被拒。正确做法是 `sandboxPolicy.resolve({ session })`，与会话自己的工具用同一套策略。
- **`ctx.fs` 没有删除**：新增文件回退只能清空。
- **`single` 布局不认 `compatibleVersions`**：加表但别升版本。
- **hooks 顺序**：`ReviewBody` 在 `if (summary === 'loading') return …` 之后不能再有 `useEffect`，加过又删了。
- **测试替身缺 `KvTable.get`**：真实接口有，替身漏了会 `TypeError`。
- **重启后记录丢失**：`workspaceChanges` 的记录在内存里，重启后 `latest` 会回 `running`/`empty` 而不是报错；decisions 与 notes 落在 `<dshHome>/storages/diff_review.json`，重启后仍在。
- **HMR 直连源码**：`cordis.hmr.patch.yml` 的 base 指向 `D:/Origin/Desktop/re/dsh-diff-review`，改完 `ctrl+r` 即生效，不用重启 DSH。
