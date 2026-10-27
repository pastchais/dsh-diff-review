# dsh-diff-review

[English](README.md) | 中文

DSH 的改动审阅面板：按单个文件读本轮差异，逐个确认；把某个文件（或整轮）退回改动之前；把修改意见留给下一轮对话。

DSH 自带的改动查看器只能看。这个插件补的是另一半——**能写**的那一半。

![审阅面板：轮次选择、单文件动作、词级差异、意见与进度](docs/assets/screenshot.png)

## 目录

- [能做什么](#能做什么)
- [安装](#安装)
- [怎么用](#怎么用)
- [为什么不会写坏你的文件](#为什么不会写坏你的文件)
- [它会产生哪些文件](#它会产生哪些文件)
- [外观：字体、字号、颜色](#外观字体字号颜色)
- [开发](#开发)
- [设计记录](#设计记录)
- [限制](#限制)
- [许可](#许可)

## 能做什么

| 动作 | 粒度 | 是否写磁盘 |
| --- | --- | --- |
| 确认 | 单文件 / 整轮 | 否，只记一条决策 |
| 回退 | 单文件 / 整轮 | 是，把文件写回改动之前 |
| 撤销回退 | 单文件 / 整轮 | 是，把改动再写回去 |
| 修改（意见） | 单文件 | 否，变成输入框里的文字 |

其余都是只读：轮次列表、文件列表、逐段差异（带词级高亮）、决策状态。「本轮还在跑」和「本轮结束但没改动」被区分成两种状态，所以面板不会永远停在「还在进行」。

整轮回退是流式的：Host 先把每个文件都算完（纯读），再逐个落盘并按文件回报进度。算不出来的文件会被单独报告并跳过，不会让整批中止。

## 安装

这是一个普通的 DSH bundle。还没发布到 npm，所以从源码目录安装。

```bash
git clone https://github.com/pastchais/dsh-diff-review.git
cd dsh-diff-review
```

然后在 DSH Web 界面里打开 **插件 → 安装 bundle**，指向这个目录：

```
link:<该目录的绝对路径>
```

或者在启用了 `plugin_manager` 的会话里：

```
plugin_manager(action: "install_bundle", target: "link:<该目录的绝对路径>")
```

安装后默认启用。profile 里配了 HMR 的话，浏览器半边 `ctrl+r` 就生效；没有配就重启 DSH。

想不安装、直接从源码跑，也可以让 HMR 指向这个目录——开发时就是这么用的：

```yaml
# <dshHome>/cordis.hmr.patch.yml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    base: file:///<该目录的绝对路径>
    root: ['.']
    debounce: 100
```

前置条件：一个带 Web 界面的 DSH profile。面板注册进右侧栏，所以 `@deepseek-ai/dsh-client-ui-sidebar-right` 必须在（所有官方 Web profile 都带）。其余都不是硬依赖——缺了会降级，见[限制](#限制)。

## 怎么用

**打开面板。** 每轮结束后，有改动的回合底部会有「在右侧审阅」按钮；面板本身也作为右侧栏的 **变更审阅** tab 存在。

**选轮次。** 顶栏有轮次下拉，列出最近有记录的几轮。它记住的是**轮次号**而不是位置，所以新轮次插到前面时，你看的还是原来那一轮。

**走文件。** `↑` / `↓` 在文件列表里移动，`Enter` 确认当前文件。每行显示自己的 `+新增 −删除` 数、一个状态圆点，以及本轮新建文件上的 **新增** 标记。

**走改动。** `F7` 跳到文件内下一处改动，`Shift+F7` 上一处。顶栏显示 `1 / N` 处。

**对单个文件动手。** 顶栏三个按钮作用于当前文件：

- **确认** —— 记下「我读过了」。再按一次收回这条记录。
- **回退** —— 把文件写回本轮改动之前，随后按钮变成 **撤销回退**。
- **修改** —— 展开意见框。保存后的意见列在差异下方，可以改（✎）或删（×）。

**收尾整轮。** 底栏显示 `已确认 X / N`、**全部确认**、**回退整轮**，以及有意见时出现的 **放进输入框** —— 把所有意见汇成一段 Markdown，**追加**到你已经在写的内容后面，不覆盖。

## 为什么不会写坏你的文件

回退是唯一有破坏性的动作，有三道闸。

**往返校验。** 回退是「把本轮的 patch 反向应用」。写之前，把结果再正向推一次，和磁盘上的当前内容逐字节比对：

```
before = reverseApply(hunks, current)
forwardApply(hunks, before) === current     // 必须成立，否则一个字都不写
```

这一个校验同时兜住了 CRLF、末尾缺换行、以及对比超时降级成「整文件替换」的 coarse patch —— 这三种正是朴素反向应用会悄悄写坏文件的情形。

**乐观锁。** 写盘带 `replaceIfVersion`（用刚才读到的版本号），本轮删除的文件则用 `createIfAbsent`。中途有人动过文件，写入会被拒绝，而不是重试。

**逐文件回报。** 一批目标会先全部算完再落盘，所以某个文件被拒绝不影响其余文件。失败以 code 返回（`STALE` / `COARSE` / `UNSUPPORTED` / `MISSING`），由浏览器本地化；Host 不发面向用户的文案。

回退**本轮新建**的文件时无法真删——文件系统接口没有删除操作——所以文件被**清空**，UI 会在两处说明：列表里的「新增」标记，以及回退后的结果文案。

## 它会产生哪些文件

| 位置 | 内容 |
| --- | --- |
| `<dshHome>/storages/diff_review.json` | 决策与审阅意见，重启后仍在 |
| 被审阅的文件本身 | 只有在你点回退或撤销回退时才会被写 |

本轮快照与差异**不**由本插件保存，来自 `@deepseek-ai/dsh-workspace-changes`，它在 Host 进程内存里保留。所以重启之后，下拉里只会出现 Host 仍能提供记录的轮次。决策与意见不受影响，它们在上面那个存储单元里。

## 外观：字体、字号、颜色

插件**不写死任何颜色，也不写死字号**。全部解析到运行中的主题与 DSH 自己的外观设置，所以「设置 → 外观」里改一次就跟着变，切换深浅色也不需要改插件。

- **字体**跟随 `--dsw-font-family`（正文）与 `--ds-font-family-code`（差异与行号）。
- **字号**跟随 `--dsh-content-font-delta` / `--dsh-code-font-delta`，也就是 DSH 在你调整正文字号/代码字号时贴到 `body` 上的增量。
- **颜色**只用 `var(--dsw-alias-*)` token，差异色带用 `--dsw-alias-file-diff-*`。

改观感三种粒度，从轻到重：

1. 装一个主题插件，或在 profile 里覆盖 `--dsw-alias-*`。面板自动跟随。
2. 加一段 CSS 覆盖——所有规则都在 `.dr-root` 前缀下，不会外溢：

   ```css
   .dr-root .dr-line[data-k=add] { background: #e8f5e9; }
   ```

3. 改 `lib/client.js` 里的 `const CSS` 数组；配了 HMR 的话 `ctrl+r` 即可。

词级高亮用 `color-mix()` 叠在主题的 marker 色上，因为主题没有「词级」专用 token。想更浓或更淡，改一个百分比就行。

完整的 token 表、当前字号谱、以及「怎么验证没写死」的清单见 [docs/appearance.md](docs/appearance.md)。

## 开发

```
lib/index.js            Host 半边：12 条鉴权路由、决策与意见存储、回退
lib/patch.js            纯 patch 运算：reverseApply / forwardApply / 往返
lib/client.js           浏览器半边：tab、轮次选择、差异视图、意见、交给输入框
test/patch.mjs          patch 运算，跑真实 structuredPatch 输出（14 个用例）
test/host-contract.mjs  路由、拒绝、流式、沙箱策略、存储形状
test/client-contract.mjs 渲染契约、字典、纯函数
docs/                   外观说明与回退设计记录
```

```bash
npm test          # 三套测试，不需要装任何依赖
```

测试是契约测试：用自己写的手工替身驱动插件自己的导出，所以纯 Node 就能跑，不需要构建，也不需要 DSH 在运行。patch 运算单独对着真实的 `structuredPatch` 输出测，因为那才是可能写坏文件的部分。

Host 半边除了 `./patch.js` 什么都不 import —— 装进 profile 的插件解析不到 `@deepseek-ai/dsh-*` 包，所以存储域的描述与记录 schema 是手写的。

## 设计记录

[`docs/revert-plan.md`](docs/revert-plan.md) 是回退与意见功能背后的设计记录，包括构建过程中改掉的部分，以及值得不要再踩一次的坑：

- `AbortSignal.any` 拒绝 `undefined` 条目，所以不带信号去读记录会直接抛。
- 不传策略时 `@deepseek-ai/dsh-fs-sandbox` 会回退到**部署**默认模式，比会话自己的窄 —— 回退必须传 `sandboxPolicy.resolve({ session })`，否则被拒。
- 存储单元是 `single` 布局，`compatibleVersions` 在这里不生效：加表安全，升版本会让所有既有记录打不开。
- `ctx.fs` 没有删除，所以新建文件只能清空。

## 限制

- **轮次记录在内存里。** Host 把快照放在内存，重启后旧轮次会从下拉里消失，而不是显示成坏掉。
- **只有一种布局。** 只支持 unified 差异，上下文固定 3 行，因为记录是 Host 生成的。
- **不能删文件。** 回退新建的文件等于清空；真要删得自己删。
- **只降级，不崩。** 没有 `storageDomain` 时能看不能记（503）。没有 `fs` 时能看能记但不能回退。没有 `sessions` 时轮次下拉与最新轮判定失效。没有 `conversation` 时「放进输入框」失效。差异本身依赖 `workspaceChanges`，没有它面板显示空状态。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
