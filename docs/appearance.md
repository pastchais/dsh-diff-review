# 外观：字体、字号、颜色怎么调

这个插件**不写死任何颜色，也不写死字号**。所有观感都从 DSH 现有的三处地方来，改哪里取决于你想改多大范围。

## 1. 字体与字号：用 DSH 自己的设置

「设置 → 外观」（`settings.theme` 命名空间）里有六项，插件的正文区和代码区分别跟随它们：

| 设置项 | 变量 | 插件用在哪 |
| --- | --- | --- |
| 正文字体 | `--dsh-font-family-text` → `--dsw-font-family` | `.dr-root`、输入框、按钮（`font:inherit`） |
| 代码字体 | `--dsh-font-family-code` → `--ds-font-family-code` | `.dr-diff`（对比内容）、`.dr-num`（行号） |
| 字号大小 | `--dsh-content-font-delta`（`calc(var(--dsh-content-font-size,14px) - 14px)`） | 所有界面字号 `calc(Npx + var(--dsh-content-font-delta,0px))` |
| 代码字号 | `--dsh-code-font-delta` | 对比区字号与行高 |

**为什么不直接写 px**：`dsh-client-ui-layout` 的 `ThemePresenter` 把用户选的字号算成一个**增量变量**贴在 `body` 上（`--dsh-content-font-delta` / `--dsh-code-font-delta`），核心 UI 全部用 `calc(基值 + 增量)`。插件照这个模式写，用户在设置里一改，插件跟着变，不用改代码。

行高也要同步加增量，否则字号放大后行会挤在一起：`.dr-diff` 用的是 `line-height: calc(22px + var(--dsh-code-font-delta,0px))`。

## 2. 颜色：只用主题 token，自动跟随明暗

插件里出现的所有颜色都是 `var(--dsw-alias-*)`（`grep -c 'var(--dsw-alias' lib/client.js` 可以核对），没有一处 `#rrggbb`。

| 用途 | token |
| --- | --- |
| 正文/标题 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 背景分层 | `--dsw-alias-bg-base` / `bg-layer-1` / `bg-layer-3` |
| 描边 | `--dsw-alias-border-l1` / `border-l2` |
| 主色（焦点框、进度条） | `--dsw-alias-brand-primary` |
| 成功/警告/错误 | `--dsw-alias-state-success-primary` / `-warn-` / `-error-` |
| 对比行背景 | `--dsw-alias-file-diff-added-bg` / `-deleted-bg` |
| 组合行内高亮 | `--dsw-alias-file-diff-added-marker` / `-deleted-marker`（叠 28% 透明） |

好处：切换深浅色主题时插件零改动自行跟随，也不会和 DSH 其他地方撞色。

**行内差异（词级）为什么用 `color-mix`**：主题里没有"词级高亮"的专用 token，只有整行的 `*-bg`。所以取同色系的 `*-marker` 做 28% 透明叠色：

```css
.dr-w{background:color-mix(in srgb,var(--dsw-alias-file-diff-deleted-marker) 28%,transparent)}
[data-k=add] .dr-w{background:color-mix(in srgb,var(--dsw-alias-file-diff-added-marker) 28%,transparent)}
```

想更淡/更重就改这个百分比，一个数字的事。

## 3. 想彻底换一套配色怎么做

三种粒度，从轻到重：

**a) 只改自己的 DSH 主题** —— 装一个主题插件，或在 profile 里覆盖 `--dsw-alias-*` 的值。插件自动跟着变，因为它读的就是这些变量。

**b) 只改这个插件的观感** —— 加一段 CSS 覆盖，不必碰 `lib/client.js`。根节点带 `.dr-root` 类，所有规则都在这个前缀下，不会外溢：

```css
.dr-root .dr-line[data-k=add]{background:#e8f5e9}
```

**c) 改插件源码** —— `lib/client.js:657` 起的 `const CSS` 数组就是这个插件的全部样式，一行一条规则，改完 `ctrl+r` 生效（HMR 直连源码）。

## 4. 当前的字号谱

| 元素 | 字号 |
| --- | --- |
| 根（正文、按钮、输入框） | `calc(13px + Δcontent)` |
| 顶部按钮 `.dr-btn` | `calc(12px + Δcontent)` |
| 导航按钮 `.dr-navbtn` | `calc(13px + Δcontent)` |
| 导航计数 `.dr-navcount` | `calc(11px + Δcontent)` |
| 标题文件名 `.dr-name` | 继承根字号，600 字重 |
| 次要信息 `.dr-blk` / `.dr-navhint` / `.dr-pill` | `calc(10.5px + Δcontent)` |
| 底栏提示 `.dr-notice` | `calc(12px + Δcontent)` |
| 意见行 `.dr-note-line` | `calc(11.5px + Δcontent)` |
| 对比内容 `.dr-diff` | `calc(11.5px + Δcode)`，行高 `calc(22px + Δcode)` |
| 行号 `.dr-num` | `calc(11px + Δcode)`，等宽数字 |
| 「新增」标记 `.dr-new` | `calc(9.5px + Δcontent)` |

要整体变大就调根那一行，其余都是相对它的固定差，不会散架。

**唯一不跟字号浮动的一处**：文件行左侧那个圆点 `.dr-dot` 是固定 13px 的徽章，里面打的是对勾，字号也固定 9px —— 跟着放大会把勾挤出圆圈。这类"图标尺寸"跟着字号缩放的收益是负的。

## 5. 验证方法

改完 `ctrl+r` 刷新，在「设置 → 外观」里把字号调到最大/最小各看一次，再切换深浅色主题。三件事都对就说明没写死：

- 字号变了、行高跟着变（不挤行）
- 深浅色切换后没有突兀的色块
- 对比区用的是等宽字体（和 DSH 代码块一致）

