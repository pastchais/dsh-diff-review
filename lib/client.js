window.__ModuleLoader__.load({
  id: 'dsh-diff-review',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /**
     * Identity of everything this plugin owns.
     *
     * `changes-review` (the shipped deliverables tab) and
     * `dsh-resource://file/**` (the file providers) are already taken, so this
     * tab kind and its address space are new. The turn-tail entry uses its own
     * id, which appends beside the shipped entries instead of replacing one.
     */
    const TAB_ID = 'dsh-diff-review'
    const TAB_KIND = 'diff-review'
    const ADDRESS_PREFIX = 'dsh-resource://diff-review/session/'
    const TURN_ENTRY_ID = 'dsh-diff-review-turn-entry'
    const NS = 'diffReview'

    const LATEST_ROUTE = '/api/diff-review.latest'
    const SUMMARY_ROUTE = '/api/diff-review.summary'
    const DIFF_ROUTE = '/api/diff-review.diff'
    const STATE_ROUTE = '/api/diff-review.state'
    const CONFIRM_ROUTE = '/api/diff-review.confirm'
    const REVERT_ROUTE = '/api/diff-review.revert'
    const RESTORE_ROUTE = '/api/diff-review.restore'
    const TURNS_ROUTE = '/api/diff-review.turns'
    const NOTE_ROUTE = '/api/diff-review.note'
    const ENOTE_ROUTE = '/api/diff-review.enote'
    const UNOTE_ROUTE = '/api/diff-review.unote'
    const NOTES_ROUTE = '/api/diff-review.notes'

    /**
     * How long a pane that is waiting for the turn's change record waits
     * before asking again. The record is written when the turn ends, so this
     * only has to be short enough to feel automatic, not fast.
     */
    const PENDING_POLL_MS = 3000

    /**
     * How many files the list fills its change counts for in the background.
     * A count needs the comparison, and the comparison is a Host read, so this
     * stays bounded: past it a file shows its count only once it is opened.
     */
    const PREFETCH_LIMIT = 60

    /** How many of those comparisons are in flight at once. */
    const PREFETCH_WIDTH = 3

    /* ── copy ────────────────────────────────────────────────────────── */

    const ZH = {
      'review.tabTitle': '变更审阅',
      'review.openAction': '在右侧审阅',
      'review.filesHeading': '本轮改动',
      'review.totals': '+{added} −{deleted}',
      'review.loading': '正在读取改动…',
      'review.empty': '本轮没有改动文件。',
      'review.running': '本轮还在进行，改动会在结束后出现在这里。',
      'review.unchanged': '本轮已结束，没有改动任何文件。',
      'review.summaryGone': '本轮的改动记录已不可用。',
      'review.loadFailed': '读取改动失败。',
      'review.binary': '二进制文件，无行级对比。',
      'review.oversized': '文件过大，无行级对比。',
      'review.coarse': '行比对超时，整文件按替换展示。',
      'review.confirmOne': '确认',
      'review.revertOne': '回退',
      'review.editOne': '修改',
      'review.pending': '待确认',
      'review.confirmed': '已确认',
      'review.reverted': '已回退',
      'review.edited': '已修改',
      'review.hint': '三个动作都以单文件为单位。确认只留记录，只有回退会写文件。',
      'review.prev': '上一处',
      'review.next': '下一处',
      'review.prevHint': '跳到上一处改动（Shift+F7）',
      'review.nextHint': '跳到下一处改动（F7）',
      'review.navHint': 'F7 下一处 · Shift+F7 上一处',
      'review.blocks': ' 处',
      'review.undoConfirm': '撤销确认',
      'review.confirmAll': '全部确认',
      'review.progress': '已确认 {done} / {total}',
      'review.allDone': '全部已确认',
      'review.listHint': '↑ ↓ 选择文件 · Enter 确认当前文件',
      'review.revertHint': '把这个文件恢复成本轮改动之前的样子（会写磁盘）',
      'review.undoRevert': '撤销回退',
      'review.editHint': '把这个文件的修改意见留给下一轮对话',
      'review.revertedOne': '已回退到本轮之前。',
      'review.restoredOne': '已恢复本轮的改动。',
      'review.refusedStale': '这个文件在本轮之后被改过，为避免覆盖已拒绝回退。',
      'review.refusedCoarse': '行比对超时，整文件按替换展示，不能安全回退。',
      'review.refusedUnsupported': '这个文件没有行级对比，不能回退。',
      'review.refusedMissing': '文件已经不在了，无需回退。',
      'review.refusedOther': '回退失败，文件没有改动。',
      'review.turn': '第 {turn} 轮',
      'review.turnHint': '这一栏保留最近几轮改动，可以回头审阅前面的轮次',
      'review.revertAll': '回退整轮',
      'review.revertAllHint': '把这一轮改过的每个文件都恢复原样（会写磁盘）',
      'review.undoRevertAll': '撤销整轮回退',
      'review.undoRevertAllHint': '把这一轮已经回退的文件再恢复到本轮的改动（会写磁盘）',
      'review.revertedAll': '已回退整轮（{count} 个文件）。',
      'review.restoredAll': '已恢复整轮（{count} 个文件）。',
      // A created file has no "before" side to put back, and the filesystem
      // seam cannot delete, so it is emptied instead. Saying "reverted" alone
      // would read as "removed"; the file is still there, at zero bytes.
      'review.emptiedOne': '已清空这个文件（本轮新建的，文件本身还在，需要的话手动删掉）。',
      'review.emptiedAll': '已回退整轮（{count} 个文件，其中 {blank} 个是新建的，已清空但没有删除）。',
      'review.new': '新增',
      'review.newHint': '本轮新建的文件：回退会把它清空，而不是删除',
      'review.refusedSome': '回退了 {done} 个文件，{failed} 个被拒绝。',
      'review.working': '正在处理 {done} / {total}：{name}',
      'review.workingHint': '逐个比对要先读每个文件的差异，这一步不改磁盘',
      'review.noteTitle': '这一处想怎么改',
      'review.noteSave': '记下',
      'review.noteCancel': '取消',
      'review.noteSaved': '意见已记下。',
      'review.noteFailed': '没能记下这条意见。',
      'review.noteEdited': '意见已更新。',
      'review.noteEdit': '改这条意见',
      'review.noteEditHint': '改掉这条审阅意见（不影响文件）',
      'review.noteEditing': '正在改 {name} 的意见',
      'review.noteUpdate': '更新',
      'review.noteWrite': '放进输入框',
      'review.noteWriteHint': '把所有意见合成一段话放进输入框，改完再发',
      'review.noteWrote': '已放进输入框，改完直接发。',
      'review.noteNoComposer': '输入框没有就绪，意见已经存在列表里。',
      'review.noteHeader': '请按这些审阅意见修改本轮改动的文件：',
      'review.notesCount': '{count} 条意见',
      'review.noteDrop': '删掉这条意见',
      'review.noteDropHint': '删掉这条审阅意见（不影响文件）',
    }

    const EN = {
      'review.tabTitle': 'Change review',
      'review.openAction': 'Review in sidebar',
      'review.filesHeading': 'Changed this turn',
      'review.totals': '+{added} −{deleted}',
      'review.loading': 'Reading changes…',
      'review.empty': 'This turn changed no file.',
      'review.running': 'This turn is still running; its changes appear here once it ends.',
      'review.unchanged': 'This turn ended without changing any file.',
      'review.summaryGone': "This turn's change record is no longer available.",
      'review.loadFailed': 'Could not read the changes.',
      'review.binary': 'Binary file; no line comparison.',
      'review.oversized': 'File too large; no line comparison.',
      'review.coarse': 'The line comparison timed out; every line is shown as replaced.',
      'review.confirmOne': 'Confirm',
      'review.revertOne': 'Revert',
      'review.editOne': 'Edit',
      'review.pending': 'Pending',
      'review.confirmed': 'Confirmed',
      'review.reverted': 'Reverted',
      'review.edited': 'Edited',
      'review.hint': 'All three actions act on one file. Confirm only records a decision; revert is the only one that writes.',
      'review.prev': 'Previous change',
      'review.next': 'Next change',
      'review.prevHint': 'Jump to the previous change (Shift+F7)',
      'review.nextHint': 'Jump to the next change (F7)',
      'review.navHint': 'F7 next · Shift+F7 previous',
      'review.blocks': ' changes',
      'review.undoConfirm': 'Undo confirm',
      'review.confirmAll': 'Confirm all',
      'review.progress': '{done} / {total} confirmed',
      'review.allDone': 'All confirmed',
      'review.listHint': '↑ ↓ pick a file · Enter confirms it',
      'review.revertHint': 'Put this file back the way it was before the turn (writes to disk)',
      'review.undoRevert': 'Undo revert',
      'review.editHint': 'Leave a note for the next turn instead of changing the file',
      'review.revertedOne': 'Reverted to before this turn.',
      'review.restoredOne': "Restored this turn's change.",
      'review.refusedStale': 'This file changed after the turn, so reverting it was refused rather than overwriting it.',
      'review.refusedCoarse': 'The line comparison timed out, so this file cannot be reverted safely.',
      'review.refusedUnsupported': 'This file has no line comparison to revert.',
      'review.refusedMissing': 'The file is already gone; nothing to revert.',
      'review.refusedOther': 'The revert failed; the file was not changed.',
      'review.turn': 'Turn {turn}',
      'review.turnHint': 'This pane keeps the last few turns, so an earlier one can still be reviewed',
      'review.revertAll': 'Revert turn',
      'review.revertAllHint': 'Put every file this turn changed back the way it was (writes to disk)',
      'review.undoRevertAll': 'Undo turn revert',
      'review.undoRevertAllHint': "Put the turn's changes back after the whole turn was reverted (writes to disk)",
      'review.revertedAll': 'Reverted the turn ({count} files).',
      'review.restoredAll': 'Restored the turn ({count} files).',
      'review.emptiedOne': 'Emptied this file. It was created by this turn, so it is still on disk at zero bytes; remove it yourself if you no longer need it.',
      'review.emptiedAll': 'Reverted the turn ({count} files, {blank} of them created by it and emptied rather than removed).',
      'review.new': 'new',
      'review.newHint': 'Created by this turn: reverting empties it rather than deleting it',
      'review.refusedSome': 'Reverted {done} files; {failed} were refused.',
      'review.working': 'Working on {done} / {total}: {name}',
      'review.workingHint': 'Each file is compared first; nothing is written during this step',
      'review.noteTitle': 'What should change here?',
      'review.noteSave': 'Save note',
      'review.noteCancel': 'Cancel',
      'review.noteSaved': 'Note saved.',
      'review.noteFailed': 'Could not save the note.',
      'review.noteEdited': 'Note updated.',
      'review.noteEdit': 'Edit this note',
      'review.noteEditHint': 'Rewrite this review note (the file is not touched)',
      'review.noteEditing': 'Rewriting the note on {name}',
      'review.noteUpdate': 'Update',
      'review.noteWrite': 'Put in the composer',
      'review.noteWriteHint': 'Collect every note into one message in the composer, ready to send',
      'review.noteWrote': 'In the composer; send it once it reads right.',
      'review.noteNoComposer': 'The composer is not ready; the notes are already stored in the list.',
      'review.noteHeader': 'Please apply these review notes to the files this turn changed:',
      'review.notesCount': '{count} notes',
      'review.noteDrop': 'Drop this note',
      'review.noteDropHint': 'Drop this review note (the file is not touched)',
    }

    /* ── helpers ─────────────────────────────────────────────────────── */

    const basename = (path) => {
      const parts = String(path).split(/[/\\]/)
      return parts[parts.length - 1]
    }

    const dirname = (path) => {
      const parts = String(path).split(/[/\\]/)
      return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : ''
    }

    const hunkHeader = (hunk) =>
      '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'

    /**
     * Every hunk's lines with the number each one carries on its own side.
     *
     * A removed line only exists in the old file and an added line only in the
     * new one, so the other side stays blank; context lines carry both.
     */
    const hunkRows = (hunk) => {
      let oldNo = hunk.oldStart
      let newNo = hunk.newStart
      const rows = []
      for (const line of hunk.lines) {
        const first = line.charAt(0)
        if (first === '+') {
          rows.push({ kind: 'add', old: undefined, new: newNo, text: line.slice(1) })
          newNo += 1
        } else if (first === '-') {
          rows.push({ kind: 'del', old: oldNo, new: undefined, text: line.slice(1) })
          oldNo += 1
        } else {
          rows.push({ kind: 'ctx', old: oldNo, new: newNo, text: line.slice(1) })
          oldNo += 1
          newNo += 1
        }
      }
      return rows
    }

    /**
     * Split one hunk into its changed blocks.
     *
     * A block is a run of removed and/or added lines together with nothing
     * else: the context lines between blocks are the boundaries. Each row
     * remembers the block it belongs to, so a jump can land on the row.
     */
    const hunkBlocks = (rows) => {
      const blocks = []
      let open = -1
      for (const row of rows) {
        if (row.kind === 'ctx') {
          open = -1
          row.block = undefined
          continue
        }
        if (open === -1) {
          open = blocks.length
          blocks.push({ start: row, dels: [], adds: [] })
        }
        row.block = open
        const block = blocks[open]
        if (row.kind === 'del') block.dels.push(row)
        else block.adds.push(row)
      }
      return blocks
    }

    const TOKEN = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g
    /** Beyond this many characters a changed line is not compared word by word. */
    const WORD_CAP = 400    /** Split a line into word-ish tokens, keeping whitespace as tokens too. */
    const tokenize = (text) => (text === '' ? [] : text.match(TOKEN) || [])

    /**
     * The longest common subsequence of two token lists, as index pairs.
     *
     * Word-level highlighting only needs the tokens two lines share, and a
     * changed line is short, so the quadratic table is bounded by the line.
     */
    const commonTokens = (left, right) => {
      const rows = left.length
      const cols = right.length
      if (rows === 0 || cols === 0) return []
      const table = []
      for (let i = 0; i <= rows; i += 1) table.push(new Uint32Array(cols + 1))
      for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
          table[i][j] = left[i] === right[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1])
        }
      }
      const pairs = []
      let i = 0
      let j = 0
      while (i < rows && j < cols) {
        if (left[i] === right[j]) {
          pairs.push([i, j])
          i += 1
          j += 1
        } else if (table[i + 1][j] >= table[i][j + 1]) {
          i += 1
        } else {
          j += 1
        }
      }
      return pairs
    }

    /**
     * Segment one line for word highlighting.
     *
     * Beyond the token cap, or with no partner line, the whole line is drawn
     * as one changed run: a highlight that has to guess is worse than none.
     */
    const segments = (text, partner, cap) => {
      if (partner === undefined || text.length > cap || partner.length > cap) {
        return [{ text, changed: true }]
      }
      const left = tokenize(text)
      const right = tokenize(partner)
      const pairs = commonTokens(left, right)
      if (pairs.length === 0) return [{ text, changed: true }]
      const out = []
      let cursor = 0
      let gap = ''
      for (const pair of pairs) {
        const at = pair[0]
        for (let k = cursor; k < at; k += 1) gap += left[k]
        if (gap !== '') {
          out.push({ text: gap, changed: true })
          gap = ''
        }
        out.push({ text: left[at], changed: false })
        cursor = at + 1
      }
      for (let k = cursor; k < left.length; k += 1) gap += left[k]
      if (gap !== '') out.push({ text: gap, changed: true })
      return out
    }

    /**
     * Word-level segments for every row of one changed block.
     *
     * Removed and added lines are paired by position; a pair gets a real
     * comparison, an unpaired line is wholly changed. Returns a map from row
     * to its segments so the renderer stays a plain lookup.
     */
    const blockSegments = (block, cap) => {
      const out = new Map()
      const pairs = Math.max(block.dels.length, block.adds.length)
      for (let i = 0; i < pairs; i += 1) {
        const del = block.dels[i]
        const add = block.adds[i]
        if (del !== undefined && add !== undefined) {
          out.set(del, segments(del.text, add.text, cap))
          out.set(add, segments(add.text, del.text, cap))
        } else if (del !== undefined) {
          out.set(del, segments(del.text, undefined, cap))
        } else if (add !== undefined) {
          out.set(add, segments(add.text, undefined, cap))
        }
      }
      return out
    }

    /** How many changed blocks a settled comparison holds, or nothing yet. */
    const countBlocks = (diff) => {
      if (typeof diff !== 'object' || diff === null || diff.kind !== 'text') return undefined
      let total = 0
      for (const hunk of diff.hunks) total += hunkBlocks(hunkRows(hunk)).length
      return total
    }

    /**
     * Whether the turn created the file rather than changing one that existed.
     *
     * The summary only carries line counts, which cannot tell a new file from a
     * rewritten one; the comparison can, because it knows whether a before side
     * exists. That distinction matters at revert time: a created file has no
     * earlier content to go back to, so it is emptied instead of restored, and
     * the pane marks it before the reviewer presses anything.
     */
    const createdByTurn = (diff) =>
      typeof diff === 'object' && diff !== null && diff.kind === 'text' && diff.before === false

    /**
     * The files whose counts the list fills by itself: the first
     * `PREFETCH_LIMIT` of them, minus the ones whose comparison is refused
     * outright. Each item keeps its index in the summary, which is what the
     * comparison route is addressed by.
     */
    const prefetchQueue = (files) =>
      files
        .map((entry, position) => ({ entry, position }))
        .slice(0, PREFETCH_LIMIT)
        .filter((item) => item.entry.binary !== true && item.entry.oversized !== true)

    /** Record one file's block count, keeping the map when nothing changed. */
    const mergeCount = (kept, path, total) =>
      kept[path] === total ? kept : { ...kept, [path]: total }

    /** Record whether a file is new in this turn, keeping the map when it already says so. */
    const mergeNew = (kept, path, created) =>
      kept[path] === created ? kept : { ...kept, [path]: created }

    /**
     * Where a chosen turn sits among the turns the Host still serves.
     *
     * A turn is addressed by its `workspace/changes` sequence, so switching
     * turns is switching the coordinate the whole pane reads through. The
     * chosen turn is kept by number rather than by position: the offered list
     * grows at the front as the session continues, and a position would then
     * point at a different turn than the one that was picked.
     *
     * @param turns - the offered turns, newest first.
     * @param turn - the chosen turn number, or undefined for the newest.
     * @returns the matching turn, or undefined when it is no longer offered.
     */
    const pickTurn = (turns, turn) => {
      if (!Array.isArray(turns) || turns.length === 0) return undefined
      if (turn === undefined) return turns[0]
      return turns.find((entry) => entry.turn === turn)
    }

    /**
     * How far through the turn the reviewer is: how many of the changed files
     * carry a confirmation, out of how many there are.
     * @param files - the turn's changed files.
     * @param decisions - recorded decisions, keyed by path.
     * @returns `{ done, total }`.
     */
    const tally = (files, decisions) => {
      let done = 0
      for (const entry of files) {
        const record = decisions[entry.path]
        if (record !== undefined && record.state === 'confirmed') done += 1
      }
      return { done, total: files.length }
    }

    /**
     * The index a list move lands on: clamped, and a no-op on an empty list.
     * @param index - the row shown now.
     * @param delta - how many rows to move, negative to walk back.
     * @param total - how many rows the list holds.
     */
    const stepIndex = (index, delta, total) => {
      if (total <= 0) return 0
      const next = index + delta
      if (next < 0) return 0
      if (next > total - 1) return total - 1
      return next
    }

    /**
     * Whether every revertible file of the turn is sitting at its pre-turn
     * content, which is what turns the whole-turn button around.
     *
     * Files without a line comparison (binary, oversized) can never be
     * reverted, so they are skipped rather than counted against the turn —
     * otherwise one such file would pin the button forever.
     * @param files - the turn's changed files.
     * @param decisions - recorded decisions, keyed by path.
     * @returns true when the turn as a whole is reverted.
     */
    const allReverted = (files, decisions) => {
      let eligible = 0
      for (const entry of files) {
        if (entry.binary === true || entry.oversized === true) continue
        eligible += 1
        const record = decisions[entry.path]
        if (record === undefined || record.state !== 'reverted') return false
      }
      return eligible > 0
    }

    /**
     * Which sentence a refused write shows.
     *
     * The Host answers per file with a code, never with prose: the browser owns
     * the wording, so a refusal reads the same whatever route it came from and
     * translating it needs no Host change.
     * @param code - the refusal code the route reported.
     */
    const refusalKey = (code) => {
      if (code === 'STALE') return 'review.refusedStale'
      if (code === 'COARSE') return 'review.refusedCoarse'
      if (code === 'UNSUPPORTED') return 'review.refusedUnsupported'
      if (code === 'MISSING') return 'review.refusedMissing'
      return 'review.refusedOther'
    }

    /**
     * Whether this pane may claim the F7 key right now. The listener lives on
     * `window`, so it fires while the pane is hidden behind another tab, or
     * while the caret sits in some other field: taking the key there would
     * swallow an editor's own F7 for a cursor nobody can see.
     */
    const ownsKey = (root, active) => {
      if (root === null || root === undefined) return false
      // `offsetParent` is null for anything not rendered, which is exactly a
      // tab that is open but not shown.
      if (root.offsetParent === null) return false
      if (active === null || active === undefined || active === root) return true
      if (typeof active.closest !== 'function') return true
      return active.closest('input,textarea,select,[contenteditable]') === null
    }

    /**
     * The message a set of notes becomes once it is put in the composer.
     *
     * Notes are what the reviewer wants changed next, so the text has to read
     * as an instruction, not a dump: one heading, then a section per file with
     * each note on its own line. Files keep the order the turn listed them, so
     * the message follows the review rather than the clock a note was written.
     * @param notes - every note recorded for the turn.
     * @param files - the turn's files, in review order.
     * @param header - the opening line, already in the reader's language.
     */
    const noteDigest = (notes, files, header) => {
      if (!Array.isArray(notes) || notes.length === 0) return undefined
      const order = new Map()
      const listed = Array.isArray(files) ? files : []
      for (let at = 0; at < listed.length; at += 1) order.set(listed[at].path, at)
      const grouped = new Map()
      for (const note of notes) {
        const bucket = grouped.get(note.path)
        if (bucket === undefined) grouped.set(note.path, [note])
        else bucket.push(note)
      }
      // A file the turn no longer lists still keeps its notes, at the end.
      const rank = (path) => (order.has(path) ? order.get(path) : order.size)
      const paths = [...grouped.keys()].sort((left, right) => {
        const gap = rank(left) - rank(right)
        return gap === 0 ? String(left).localeCompare(String(right)) : gap
      })
      const lines = [header]
      for (const path of paths) {
        lines.push('')
        lines.push('- ' + path)
        for (const note of grouped.get(path)) lines.push('  - ' + note.text)
      }
      return lines.join('\n')
    }

    /**
     * Split an NDJSON buffer into whole lines and the unfinished rest.
     *
     * The Host streams one record per file, and a chunk boundary lands
     * wherever the transport decided — often mid-record — so the caller keeps
     * the tail and prepends it to the next chunk instead of parsing half a
     * line. Only '\n' ends a record; anything else stays buffered.
     */
    const takeLines = (buffer) => {
      const cut = buffer.lastIndexOf('\n')
      if (cut === -1) return { lines: [], rest: buffer }
      return {
        lines: buffer.slice(0, cut).split('\n'),
        rest: buffer.slice(cut + 1),
      }
    }

    /** One NDJSON record, or undefined when the line is blank or not JSON. */
    const readStep = (line) => {
      const text = line.trim()
      if (text === '') return undefined
      try {
        const value = JSON.parse(text)
        return value !== null && typeof value === 'object' ? value : undefined
      } catch {
        return undefined
      }
    }

    /**
     * What the composer should hold once a digest is handed to it.
     *
     * Writing the composer means replacing its whole content, so a reviewer
     * who had already started typing would lose that text. Keeping it and
     * appending the digest below respects the draft that was there first, and
     * an empty composer simply receives the digest alone.
     * @param existing - what the composer holds now.
     * @param text - the digest to add.
     * @returns the draft the composer should end up with.
     */
    const mergeDraft = (existing, text) => {
      const before = typeof existing === 'string' ? existing : ''
      const after = typeof text === 'string' ? text : ''
      if (after === '') return before
      if (before.trim() === '') return after
      return before.replace(/\s+$/, '') + '\n\n' + after
    }

    /**
     * The whole comparison, prepared once: numbered rows, the changed blocks
     * F7 walks, and the word segments each changed row draws with.
     *
     * Blocks are numbered across the comparison, not per hunk, so a jump
     * crosses hunk boundaries and two hunks never share an index. Every row of
     * a block carries that same number, which is what marks the current one.
     */
    const planDiff = (diff) => {
      if (typeof diff !== 'object' || diff === null || diff.kind !== 'text') return null
      const hunks = []
      const blocks = []
      for (const hunk of diff.hunks) {
        const rows = hunkRows(hunk)
        const segs = new Map()
        for (const block of hunkBlocks(rows)) {
          const at = blocks.length
          blocks.push(block)
          for (const row of block.dels) row.block = at
          for (const row of block.adds) row.block = at
          for (const [row, value] of blockSegments(block, WORD_CAP)) segs.set(row, value)
        }
        hunks.push({ hunk, rows, segs })
      }
      return { hunks, blocks }
    }

    const withQuery = (path, params) => {      const search = new URLSearchParams()
      for (const key of Object.keys(params)) search.set(key, String(params[key]))
      return path + '?' + search.toString()
    }

    const reviewAddress = (sessionId, seq, turn) => ADDRESS_PREFIX + sessionId + '/' + seq + '/' + turn

    function parseAddress(address) {
      if (typeof address !== 'string' || address.indexOf(ADDRESS_PREFIX) !== 0) return undefined
      const parts = address.slice(ADDRESS_PREFIX.length).split('/')
      if (parts.length !== 3) return undefined
      const sessionId = parts[0]
      const seq = parts[1]
      const turn = parts[2]
      if (sessionId === '' || !/^\d+$/.test(seq) || !/^\d+$/.test(turn)) return undefined
      return { sessionId, seq: Number(seq), turn: Number(turn) }
    }

    /* ── styles ───────────────────────────────────────────────────────
     * Token-only: every colour resolves against the host theme, so light and
     * dark both follow without a second stylesheet.
     */
    const CSS = [
      '.dr-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:calc(13px + var(--dsh-content-font-delta,0px))}',
      '.dr-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-width:0}',
      '.dr-path{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
      '.dr-name{color:var(--dsw-alias-label-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.dr-pill{font-size:calc(10.5px + var(--dsh-content-font-delta,0px));padding:2px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
      '.dr-pill[data-s=confirmed]{color:var(--dsw-alias-state-success-primary)}',
      '.dr-pill[data-s=reverted]{color:var(--dsw-alias-state-warn-primary)}',
      '.dr-pill[data-s=edited]{color:var(--dsw-alias-link)}',
      '.dr-num{font-family:var(--ds-font-family-code);font-size:calc(11px + var(--dsh-code-font-delta,0px));font-variant-numeric:tabular-nums;flex:none}',
      '.dr-add{color:var(--dsw-alias-state-success-primary)}',
      '.dr-del{color:var(--dsw-alias-state-error-primary)}',
      '.dr-spacer{flex:1 1 auto}',
      '.dr-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:calc(12px + var(--dsh-content-font-delta,0px));padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;flex:none;transition:background .14s,border-color .14s}',
      '.dr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-btn:disabled{opacity:.42;cursor:default}',
      '.dr-btn[data-primary=true]{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
      '.dr-body{display:flex;flex:1 1 auto;min-height:0}',
      '.dr-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);overflow:auto;padding:6px}',
      '.dr-list:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dr-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer;border:0;background:none;width:100%;text-align:left;font:inherit;color:inherit}',
      '.dr-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dr-row[data-active=true]{background:var(--dsw-alias-bg-layer-3)}',
      // The dot is a fixed 13px badge, so its glyph stays fixed too: scaling it
      // with the font setting would push the mark out of its own circle.
      '.dr-dot{width:13px;height:13px;border-radius:50%;border:1.4px solid var(--dsw-alias-border-l2);flex:none;display:grid;place-items:center;font-size:9px;line-height:1}',
      '.dr-dot[data-s=confirmed]{background:var(--dsw-alias-state-success-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}',
      '.dr-dot[data-s=reverted]{background:var(--dsw-alias-state-warn-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}',
      '.dr-dot[data-s=edited]{background:var(--dsw-alias-link);border-color:transparent;color:var(--dsw-alias-bg-base)}',
      '.dr-fname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      // A file the turn created wears a mark: reverting it empties the file
      // rather than restoring it, which is worth knowing before the click.
      '.dr-new{flex:none;padding:0 4px;border-radius:4px;font-size:calc(9.5px + var(--dsh-content-font-delta,0px));line-height:15px;color:var(--dsw-alias-state-success-primary);border:1px solid var(--dsw-alias-state-success-primary)}',
      '.dr-blk{font-size:calc(10px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}',
      '.dr-diff{flex:1 1 auto;min-width:0;overflow:auto;font-family:var(--ds-font-family-code);font-size:calc(11.5px + var(--dsh-code-font-delta,0px));line-height:calc(22px + var(--dsh-code-font-delta,0px))}',
      '.dr-pane{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
      '.dr-nav{display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:none}',
      '.dr-navbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:calc(13px + var(--dsh-content-font-delta,0px));line-height:1;padding:2px 7px;border-radius:5px;cursor:pointer}',
      '.dr-navbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dr-navbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-navbtn:disabled{opacity:.38;cursor:default}',
      '.dr-navcount{font-size:calc(11px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dr-navhint{font-size:calc(10.5px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dr-hunks{display:flex;flex-direction:column;min-width:100%;width:max-content}',
      '.dr-hunk{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);padding:2px 10px;white-space:pre}',
      '.dr-line{display:flex;white-space:pre}',
      '.dr-line[data-k=add]{background:var(--dsw-alias-file-diff-added-bg)}',
      '.dr-line[data-k=del]{background:var(--dsw-alias-file-diff-deleted-bg)}',
      '.dr-no{width:46px;flex:none;text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary);user-select:none}',
      '.dr-mark{width:16px;flex:none;text-align:center;user-select:none}',
      '.dr-code{padding-left:4px;white-space:pre;flex:1 1 auto}',
      '.dr-w{background:color-mix(in srgb,var(--dsw-alias-file-diff-deleted-marker) 28%,transparent);border-radius:2px}',
      '[data-k=add] .dr-w{background:color-mix(in srgb,var(--dsw-alias-file-diff-added-marker) 28%,transparent)}',
      '.dr-line[data-b]{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      '.dr-note{padding:8px 12px;color:var(--dsw-alias-label-tertiary)}',
      '.dr-empty{margin:auto;padding:24px;color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.dr-foot{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:none}',
      '.dr-notice{padding:6px 12px;font-size:calc(12px + var(--dsh-content-font-delta,0px));border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);flex:none}',
      '.dr-notice[data-ok=true]{color:var(--dsw-alias-state-success-primary)}',
      '.dr-progress{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:calc(11.5px + var(--dsh-content-font-delta,0px))}',
      '.dr-progress-bar{flex:none;width:96px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}',
      '.dr-progress-fill{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .12s linear}',
      '.dr-progress-text{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.dr-compose{flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);padding:8px 12px;display:flex;flex-direction:column;gap:6px}',
      '.dr-input{box-sizing:border-box;width:100%;min-height:64px;max-height:180px;resize:vertical;font:inherit;font-family:var(--dsw-font-family);font-size:calc(12.5px + var(--dsh-content-font-delta,0px));line-height:calc(19px + var(--dsh-content-font-delta,0px));padding:7px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.dr-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-composebar{display:flex;justify-content:flex-end;gap:6px}',
      '.dr-notes{flex:none;display:flex;flex-direction:column;gap:2px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);max-height:96px;overflow:auto}',
      '.dr-note-line{display:flex;align-items:flex-start;gap:6px;font-size:calc(11.5px + var(--dsh-content-font-delta,0px));line-height:calc(17px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.dr-note-text{flex:1;min-width:0}',
      '.dr-note-drop{flex:none;font:inherit;line-height:1;padding:0 4px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dr-note-drop:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}',
      '.dr-note-drop:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-note-edit{flex:none;font:inherit;line-height:1;padding:0 4px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dr-note-edit:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}',
      '.dr-note-edit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-pick{appearance:none;font:inherit;font-size:calc(11.5px + var(--dsh-content-font-delta,0px));padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.dr-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dr-pick:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-entry{display:flex;padding:2px 0}',
      '.dr-compose{display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:none}',
      '.dr-input{font:inherit;font-family:var(--dsw-font-family);font-size:calc(12px + var(--dsh-content-font-delta,0px));line-height:1.5;resize:vertical;min-height:54px;max-height:40vh;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.dr-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dr-composebar{display:flex;gap:8px;justify-content:flex-end}',
      '.dr-notes{display:flex;flex-direction:column;gap:2px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:calc(11.5px + var(--dsh-content-font-delta,0px));flex:none;max-height:96px;overflow:auto}',
      '.dr-note-line{white-space:pre-wrap;word-break:break-word}',
    ].join('')

    /* ── the tab body ───────────────────────────────────────────────── */

    /**
     * One turn's review. The shown file, its comparison, and that file's
     * recorded decision all live here; nothing is cached across turns.
     * @param props - composed slot props.
     */
    function ReviewBody(props) {
      const t = props.t
      const tabInfo = props.useTabInfo()
      const tab = tabInfo.tab
      const signal = tab.signal
      const navigation = tab.navigation
      const params = navigation.params
      const revision = navigation.revision

      // A tab opened by address carries the turn; one opened as a page does not.
      const fromAddress = parseAddress(tab.contentId)
      const sessionId = props.sessionId !== undefined ? props.sessionId : fromAddress && fromAddress.sessionId

      const [coords, setCoords] = React.useState(fromAddress)
      const [summary, setSummary] = React.useState('loading')
      const [decisions, setDecisions] = React.useState({})
      const [index, setIndex] = React.useState(typeof params?.index === 'number' ? params.index : 0)
      const [diff, setDiff] = React.useState('loading')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(undefined)
      // Which file a whole-turn revert is on, so the pane reports progress
      // instead of looking frozen while one comparison per file is read.
      const [progress, setProgress] = React.useState(undefined)
      // The turns still on offer, newest first, and the one the reviewer picked
      // out of them. `undefined` means "follow the newest", which is also the
      // only choice that can be still running and can therefore wait for its
      // record.
      const [turns, setTurns] = React.useState([])
      const [picked, setPicked] = React.useState(undefined)
      // The notes recorded against this turn, and the box they are written in.
      // A note is the reviewer's instruction for the next turn, so it is kept
      // on the Host (it survives a reload) while the box is only editor state.
      const [notes, setNotes] = React.useState([])
      const [composing, setComposing] = React.useState(false)
      const [draftNote, setDraftNote] = React.useState('')
      // The note the box is rewriting, or undefined when it is writing a new
      // one. A note is addressed by its `at`, so editing keeps the same key and
      // the other notes of the file stay where they are.
      const [editing, setEditing] = React.useState(undefined)

      // Re-navigation resets the shown file to the one the opener named.
      React.useEffect(() => {
        if (typeof params?.index === 'number') setIndex(params.index)
      }, [revision])

      // A turn that has not recorded yet is polled, so the pane fills itself in
      // when the turn ends instead of staying on a notice until the tab is
      // reopened. A recorded turn is fetched once and then left alone.
      const [poll, setPoll] = React.useState(0)
      React.useEffect(() => {
        if (summary !== 'pending') return undefined
        const timer = setTimeout(() => setPoll((count) => count + 1), PENDING_POLL_MS)
        return () => clearTimeout(timer)
      }, [summary, poll])

      // The turns still on offer, newest first. This is what the picker lists,
      // and it also answers "which coordinate does a picked turn stand for".
      // It is read even for a tab opened by address: that tab shows one turn,
      // but the reviewer may still want to step to a neighbouring one.
      React.useEffect(() => {
        if (sessionId === undefined) return undefined
        let live = true
        fetch(withQuery(TURNS_ROUTE, { sessionId }), { signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            if (live) setTurns(Array.isArray(value?.turns) ? value.turns : [])
          })
          .catch(() => {
            // No list means no picker; the newest turn is still readable.
            if (live) setTurns([])
          })
        return () => {
          live = false
        }
      }, [sessionId, tab.contentId, poll])

      // Resolve the turn: a picked one wins, then the address, else ask the
      // Host which turn is newest.
      React.useEffect(() => {
        if (picked !== undefined) {
          const chosen = pickTurn(turns, picked)
          if (chosen === undefined) {
            setSummary('missing')
            return undefined
          }
          setCoords({ seq: chosen.seq, turn: chosen.turn })
          return undefined
        }
        if (fromAddress !== undefined) {
          setCoords(fromAddress)
          return undefined
        }
        if (sessionId === undefined) return undefined
        // Only the newest turn can be running, so only the newest one is ever
        // waited for.
        let live = true
        fetch(withQuery(LATEST_ROUTE, { sessionId }), { signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            if (!live) return
            // The Host reports the turn's state, because a turn that changed
            // nothing never records and must not read as one still running.
            if (value.state === 'running') setSummary('pending')
            else if (value.state === 'empty') setSummary('empty')
            else setCoords(value)
          })
          .catch(() => {
            // The session is not one this Host knows: nothing will arrive.
            if (live) setSummary('error')
          })
        return () => {
          live = false
        }
      }, [sessionId, tab.contentId, poll, picked, turns, fromAddress])

      const seq = coords ? coords.seq : undefined

      // The turn's changed-file list.
      React.useEffect(() => {
        if (sessionId === undefined || seq === undefined) return undefined
        let live = true
        setSummary('loading')
        fetch(withQuery(SUMMARY_ROUTE, { sessionId, seq }), { signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            if (live) setSummary(value)
          })
          .catch((error) => {
            if (live) setSummary(error === 404 ? 'missing' : 'error')
          })
        return () => {
          live = false
        }
      }, [sessionId, seq])

      // This turn's recorded decisions.
      const readDecisions = React.useCallback(() => {
        if (sessionId === undefined || seq === undefined) return
        fetch(withQuery(STATE_ROUTE, { sessionId, seq }), { signal })
          .then((response) => (response.ok ? response.json() : {}))
          .then((value) => setDecisions(value === null ? {} : value))
          .catch(() => undefined)
      }, [sessionId, seq])

      React.useEffect(() => {
        readDecisions()
      }, [readDecisions])

      // This turn's notes. Read next to the decisions because the two are
      // shown together: a note is why a file wears the `edited` mark.
      React.useEffect(() => {
        if (sessionId === undefined || seq === undefined) return undefined
        let live = true
        fetch(withQuery(NOTES_ROUTE, { sessionId, seq }), { signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            if (live) setNotes(Array.isArray(value?.notes) ? value.notes : [])
          })
          .catch(() => {
            if (live) setNotes([])
          })
        return () => {
          live = false
        }
      }, [sessionId, seq])

      // The comparison for the shown file.
      React.useEffect(() => {
        if (sessionId === undefined || seq === undefined) return undefined
        let live = true
        setDiff('loading')
        fetch(withQuery(DIFF_ROUTE, { sessionId, seq, index }), { signal })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            if (live) setDiff(value)
          })
          .catch((error) => {
            if (live) setDiff(error === 404 ? 'missing' : 'error')
          })
        return () => {
          live = false
        }
      }, [sessionId, seq, index])

      const files = summary === 'loading' || summary === 'missing' || summary === 'error' || summary === 'empty' || summary === 'pending'
        ? []
        : summary.files || []
      const file = files.length > 0 ? files[Math.min(index, files.length - 1)] : undefined

      // How many changed blocks each comparison holds, kept per file path so
      // the list can show a count beside every file, not only the shown one.
      const counts = React.useMemo(() => countBlocks(diff), [diff])
      const [blockCounts, setBlockCounts] = React.useState({})
      const [createdFiles, setCreatedFiles] = React.useState({})
      React.useEffect(() => {
        if (counts === undefined || file === undefined) return
        setBlockCounts((kept) => mergeCount(kept, file.path, counts))
      }, [counts, file])
      // The open file's own comparison is authoritative about its shape, so it
      // is recorded here too: the prefetch below may have given up on it.
      const opened = React.useMemo(() => createdByTurn(diff), [diff])
      React.useEffect(() => {
        if (file === undefined) return
        setCreatedFiles((kept) => mergeNew(kept, file.path, opened))
      }, [file, opened])

      // The list fills its counts in the background: a count needs the
      // comparison, and the comparison is a Host read per file, so this walks
      // a bounded slice of the list a few reads at a time and gives up when the
      // tab closes. A file past the limit keeps showing its count once opened.
      const listKey = files.map((entry) => entry.path).join('|')
      React.useEffect(() => {
        if (sessionId === undefined || seq === undefined) return undefined
        const pending = prefetchQueue(files)
        let live = true
        let cursor = 0
        const drain = async () => {
          while (live && cursor < pending.length) {
            const item = pending[cursor]
            cursor += 1
            try {
              const response = await fetch(
                withQuery(DIFF_ROUTE, { sessionId, seq, index: item.position }),
                { signal },
              )
              if (!response.ok) continue
              const value = await response.json()
              if (!live) continue
              const total = countBlocks(value)
              if (total !== undefined) setBlockCounts((kept) => mergeCount(kept, item.entry.path, total))
              setCreatedFiles((kept) => mergeNew(kept, item.entry.path, createdByTurn(value)))
            } catch {
              // A refusal is the file's own answer, not the walk's failure.
            }
          }
        }
        for (let worker = 0; worker < PREFETCH_WIDTH; worker += 1) void drain()
        return () => {
          live = false
        }
      }, [sessionId, seq, listKey, signal])

      const blocksOf = (entry) => blockCounts[entry.path]

      /**
       * Whether reverting this file empties it instead of restoring it.
       *
       * A file the turn created has nothing to go back to, so reverting writes
       * an empty file — the row says so beforehand, because "revert" and "the
       * file stays on disk, now empty" are not the same thing to a reviewer.
       */
      const emptiesOnRevert = (entry) => createdFiles[entry.path] === true

      /**
       * Revert one file to what it was before the turn, or undo that revert.
       *
       * This is the only action that touches the disk, so it reports what
       * happened per file instead of failing silently: a file edited since the
       * turn is refused by the Host, and the pane says which one and why. The
       * same call settles a whole turn when the target carries `all`, which is
       * why the report is counted rather than assumed to be a single file.
       *
       * A whole turn reads one comparison per file before it writes anything,
       * so it can take a while; the Host streams a line per file and the pane
       * shows the count climbing instead of sitting on a dead button.
       */
      const settle = React.useCallback(
        (direction, target) => {
          if (sessionId === undefined || seq === undefined || target === undefined) return
          setBusy(true)
          setNotice(undefined)
          setProgress(undefined)
          const whole = target.all === true
          const payload = { sessionId, seq }
          if (whole) payload.all = true
          else payload.path = target.path

          /** Turn the Host's per-file report into the one line the pane shows. */
          const report = (value) => {
            const results = Array.isArray(value?.results) ? value.results : []
            const failed = results.filter((one) => one.ok !== true)
            const settled = results.length - failed.length
            // A file this turn created is emptied, not removed: the filesystem
            // seam has no delete, so the file stays on disk at zero bytes. The
            // report says so, otherwise "reverted" reads as "gone" and the
            // leftover empty file is a surprise found later.
            const blank =
              direction === 'revert'
                ? results.filter((one) => one.ok === true && one.shape === 'empty').length
                : 0
            if (failed.length === 0 && results.length > 0) {
              const key = direction === 'revert'
                ? (whole ? 'review.revertedAll' : 'review.revertedOne')
                : (whole ? 'review.restoredAll' : 'review.restoredOne')
              setNotice({
                ok: true,
                text: blank > 0 ? (whole ? 'review.emptiedAll' : 'review.emptiedOne') : key,
                params: whole
                  ? { count: settled, blank }
                  : blank > 0
                    ? { name: basename(results[0].path) }
                    : undefined,
              })
            } else if (failed.length > 0) {
              // A partly settled batch says both numbers: what was put back
              // and what was refused, so the count is never a mystery.
              setNotice({
                ok: false,
                text: whole ? 'review.refusedSome' : refusalKey(failed[0].code),
                params: whole ? { done: settled, failed: failed.length } : undefined,
              })
            }
            setProgress(undefined)
            readDecisions()
          }

          const request = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
          }

          /** Walk one NDJSON stream, one line at a time. */
          const readStream = async (response) => {
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let done
            for (;;) {
              const step = await reader.read()
              if (step.done) break
              const taken = takeLines(buffer + decoder.decode(step.value, { stream: true }))
              buffer = taken.rest
              for (const line of taken.lines) {
                const record = readStep(line)
                if (record === undefined) continue
                if (record.step === 'plan') {
                  setProgress({ done: record.at, total: record.total, name: basename(record.path) })
                } else if (record.step === 'failed') {
                  setNotice({ ok: false, text: 'review.refusedOther' })
                } else if (record.step === 'done') {
                  done = record
                }
              }
            }
            // A last line without its newline still counts: the tail of a
            // stream is a line like any other.
            if (buffer.trim() !== '') {
              const record = readStep(buffer)
              if (record !== undefined && record.step === 'done') done = record
            }
            if (done === undefined) throw new Error('stream ended early')
            report(done)
          }

          // Stream only the whole turn: one file is one read, and a stream
          // would only get in the way of an answer that is already quick.
          const streamed = whole
            ? fetch(direction === 'revert' ? REVERT_ROUTE : RESTORE_ROUTE, {
                ...request,
                headers: { ...request.headers, accept: 'application/x-ndjson' },
              }).then((response) => (response.ok ? readStream(response) : Promise.reject(response.status)))
            : fetch(direction === 'revert' ? REVERT_ROUTE : RESTORE_ROUTE, request)
                .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
                .then(report)

          streamed
            .catch(() => {
              setProgress(undefined)
              setNotice({ ok: false, text: 'review.refusedOther' })
            })
            .then(() => setBusy(false))
        },
        [sessionId, seq, readDecisions, refusalKey],
      )

      /** Record one decision, take one back, or settle every file at once. */
      const decide = React.useCallback(
        (state, options) => {
          if (sessionId === undefined || seq === undefined) return
          const whole = options?.all === true
          const takeBack = options?.undo === true
          const entry = options?.file !== undefined ? options.file : file
          if (!whole && entry === undefined) return
          setBusy(true)
          const payload = { sessionId, seq }
          if (whole) payload.all = true
          else payload.path = entry.path
          if (takeBack) payload.undo = true
          else payload.state = state
          fetch(CONFIRM_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
          })
            .then((response) => {
              if (response.ok) readDecisions()
            })
            .catch(() => undefined)
            .then(() => setBusy(false))
        },
        [file, sessionId, seq, readDecisions],
      )

      /**
       * Save the note in the box: a new one, or a rewrite of the one being
       * edited.
       *
       * A note is the reviewer's instruction, not a decision about the file:
       * it never touches the disk, and it survives a reload because the Host
       * keeps it. The box is left open on failure so nothing typed is lost.
       */
      const saveNote = React.useCallback(() => {
        const text = draftNote.trim()
        if (sessionId === undefined || seq === undefined || file === undefined || text === '') return
        const rewriting = editing !== undefined
        const path = rewriting ? editing.path : file.path
        setBusy(true)
        fetch(rewriting ? ENOTE_ROUTE : NOTE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            rewriting
              ? { sessionId, seq, path, at: editing.at, text }
              : { sessionId, seq, path, text },
          ),
          signal,
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
          .then((value) => {
            setNotes(Array.isArray(value?.notes) ? value.notes : [])
            setDraftNote('')
            setEditing(undefined)
            setComposing(false)
            setNotice({ ok: true, text: rewriting ? 'review.noteEdited' : 'review.noteSaved' })
            readDecisions()
          })
          .catch(() => setNotice({ ok: false, text: 'review.noteFailed' }))
          .then(() => setBusy(false))
      }, [draftNote, editing, file, sessionId, seq, signal, readDecisions])

      /**
       * Put every note of this turn into the composer, ready to be sent.
       *
       * The notes are already stored, so this is only the handoff: the text
       * lands in the input box where it can be read, edited and sent, instead
       * of being fired off as a message the reviewer never saw. A composer
       * that is not there yet is reported rather than silently swallowed.
       */
      const writeNotes = React.useCallback(() => {
        const text = noteDigest(notes, files, t('review.noteHeader'))
        if (text === undefined) return
        const composer = props.composer
        if (typeof composer !== 'function') {
          setNotice({ ok: false, text: 'review.noteNoComposer' })
          return
        }
        try {
          composer(text)
          setNotice({ ok: true, text: 'review.noteWrote' })
        } catch {
          setNotice({ ok: false, text: 'review.noteNoComposer' })
        }
      }, [notes, files])

      /**
       * Open the composer on an existing note so it can be rewritten.
       *
       * The text is only read out of the store here; nothing is written until
       * the box is saved. Keeping the note's `at` is what makes the save a
       * rewrite instead of a second note beside the first.
       * @param note - the note to rewrite, as the Host returned it.
       */
      const editNote = React.useCallback(
        (note) => {
          if (note === undefined) return
          setEditing(note)
          setDraftNote(note.text)
          setComposing(true)
        },
        [],
      )

      /** Close the box without saving, forgetting any note it was rewriting. */
      const closeComposer = React.useCallback(() => {
        setComposing(false)
        setEditing(undefined)
        setDraftNote('')
      }, [])

      /**
       * Drop one note.
       *
       * A note is advice, not a record of something that happened, so it has
       * to be takeable back — otherwise a typo lives on in every digest from
       * then on. Removing the last note of a file also lets its `edited` mark
       * go, which the Host does in the same request.
       * @param note - the note to remove, as the Host returned it.
       */
      const dropNote = React.useCallback(
        (note) => {
          if (sessionId === undefined || seq === undefined || note === undefined) return
          // A note that is already in the box cannot be removed from under it.
          if (editing !== undefined && editing.at === note.at && editing.path === note.path) {
            setComposing(false)
            setEditing(undefined)
            setDraftNote('')
          }
          setBusy(true)
          fetch(UNOTE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, seq, path: note.path, at: note.at }),
            signal,
          })
            .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
            .then((value) => {
              setNotes(Array.isArray(value?.notes) ? value.notes : [])
              readDecisions()
            })
            .catch(() => setNotice({ ok: false, text: 'review.noteFailed' }))
            .then(() => setBusy(false))
        },
        [editing, sessionId, seq, signal, readDecisions],
      )

      if (summary === 'loading') return h('div', { className: 'dr-empty' }, t('review.loading'))
      if (summary === 'pending') return h('div', { className: 'dr-empty' }, t('review.running'))
      if (summary === 'empty') return h('div', { className: 'dr-empty' }, t('review.unchanged'))
      if (summary === 'missing') return h('div', { className: 'dr-empty' }, t('review.summaryGone'))
      if (summary === 'error') return h('div', { className: 'dr-empty' }, t('review.loadFailed'))
      if (file === undefined) return h('div', { className: 'dr-empty' }, t('review.empty'))

      const current = decisions[file.path] ? decisions[file.path].state : undefined
      const dot = (state) =>
        state === 'confirmed' ? '✓' : state === 'reverted' ? '↺' : state === 'edited' ? '✎' : ''
      const counted = tally(files, decisions)
      const revertedTurn = allReverted(files, decisions)

      // The list is walked from the keyboard as well as the mouse: the rows are
      // buttons, so the arrow keys move the shown file and Enter settles it.
      const onListKey = (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setIndex(stepIndex(index, 1, files.length))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setIndex(stepIndex(index, -1, files.length))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (!busy) decide(current === 'confirmed' ? undefined : 'confirmed', {
            undo: current === 'confirmed',
          })
        }
      }

      const confirmed = current === 'confirmed'
      const reverted = current === 'reverted'

      // The picker lists the offered turns; the one on screen is selected by
      // its number, which is also what a pick records. A turn opened by address
      // that the offer list no longer holds still gets an option of its own, so
      // the control never claims a different turn is showing.
      const shownTurn = coords === undefined ? undefined : coords.turn
      const offered = turns.some((entry) => entry.turn === shownTurn) || shownTurn === undefined
        ? turns
        : [{ turn: shownTurn, seq: coords.seq }, ...turns]

      return h(
        'div',
        { className: 'dr-root' },
        h(
          'div',
          { className: 'dr-bar' },
          // Older turns are still reviewable while the recorder keeps them, so
          // the bar names which turn is on screen instead of silently showing
          // the newest one. A single turn needs no choice and gets no control.
          offered.length > 1
            ? h(
                'select',
                {
                  className: 'dr-pick',
                  value: shownTurn === undefined ? '' : String(shownTurn),
                  title: t('review.turnHint'),
                  onChange: (event) => {
                    const next = event.target.value
                    setPicked(next === '' ? undefined : Number(next))
                    setIndex(0)
                  },
                },
                offered.map((entry) =>
                  h(
                    'option',
                    { key: entry.turn, value: String(entry.turn) },
                    t('review.turn', { turn: entry.turn }),
                  ),
                ),
              )
            : null,
          h('span', { className: 'dr-path' }, dirname(file.display)),
          h('span', { className: 'dr-name' }, basename(file.display)),
          h(
            'span',
            { className: 'dr-pill', 'data-s': current === undefined ? '' : current },
            current === undefined ? t('review.pending') : t('review.' + current),
          ),
          h('span', { className: 'dr-num dr-add' }, '+' + file.added),
          h('span', { className: 'dr-num dr-del' }, '−' + file.deleted),
          h('span', { className: 'dr-spacer' }),
          h(
            'button',
            {
              className: 'dr-btn',
              // Confirming twice is meaningless, so the same button takes the
              // decision back instead of sitting dead once the file is settled.
              'data-primary': !confirmed,
              disabled: busy,
              onClick: () => (confirmed ? decide(undefined, { undo: true }) : decide('confirmed')),
            },
            confirmed ? t('review.undoConfirm') : t('review.confirmOne'),
          ),
          h(
            'button',
            {
              className: 'dr-btn',
              disabled: busy || file.binary === true || file.oversized === true,
              title: t('review.revertHint'),
              // The same button walks back: once a file is reverted, pressing it
              // again puts the turn's version back. One control, two directions,
              // exactly like the confirm button above.
              onClick: () => settle(reverted ? 'restore' : 'revert', file),
            },
            reverted ? t('review.undoRevert') : t('review.revertOne'),
          ),
          h(
            'button',
            {
              className: 'dr-btn',
              'data-primary': composing,
              disabled: busy,
              title: t('review.editHint'),
              // A note is the reviewer's instruction for the next turn, so this
              // opens a box instead of touching the file. Pressing it again
              // folds the box away, which is also how it is cancelled.
              onClick: () => (composing ? closeComposer() : setComposing(true)),
            },
            t('review.editOne'),
          ),
        ),
        composing
          ? h(
              'div',
              { className: 'dr-compose' },
              h('textarea', {
                className: 'dr-input',
                value: draftNote,
                placeholder: t('review.noteTitle'),
                'aria-label': t('review.noteTitle'),
                onChange: (event) => setDraftNote(event.target.value),
                onKeyDown: (event) => {
                  // Ctrl+Enter saves, Escape folds the box away, and a plain
                  // Enter stays a newline because a note is prose.
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    saveNote()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    closeComposer()
                  }
                },
              }),
              h(
                'div',
                { className: 'dr-composebar' },
                editing === undefined
                  ? null
                  : h('span', { className: 'dr-blk' }, t('review.noteEditing', { name: basename(editing.path) })),
                h('span', { className: 'dr-spacer' }),
                h('button', { className: 'dr-btn', onClick: closeComposer }, t('review.noteCancel')),
                h(
                  'button',
                  {
                    className: 'dr-btn',
                    'data-primary': true,
                    disabled: busy || draftNote.trim() === '',
                    onClick: saveNote,
                  },
                  editing === undefined ? t('review.noteSave') : t('review.noteUpdate'),
                ),
              ),
            )
          : null,
        notes.length === 0
          ? null
          : h(
              'div',
              { className: 'dr-notes' },
              notes.map((note, at) =>
                h(
                  'span',
                  { key: note.path + '/' + note.at + '/' + at, className: 'dr-note-line' },
                  h('span', { className: 'dr-note-text' }, '✎ ' + basename(note.path) + ' · ' + note.text),
                  h(
                    'button',
                    {
                      className: 'dr-note-edit',
                      disabled: busy,
                      title: t('review.noteEditHint'),
                      'aria-label': t('review.noteEdit'),
                      onClick: () => editNote(note),
                    },
                    '✎',
                  ),
                  h(
                    'button',
                    {
                      className: 'dr-note-drop',
                      disabled: busy,
                      title: t('review.noteDropHint'),
                      'aria-label': t('review.noteDrop'),
                      onClick: () => dropNote(note),
                    },
                    '×',
                  ),
                ),
              ),
            ),
        progress === undefined
          ? null
          : h(
              'div',
              { className: 'dr-progress', title: t('review.workingHint') },
              h('span', { className: 'dr-progress-bar' }, h('span', {
                className: 'dr-progress-fill',
                style: { width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` },
              })),
              h(
                'span',
                { className: 'dr-progress-text' },
                t('review.working', { done: progress.done, total: progress.total, name: progress.name }),
              ),
            ),
        notice === undefined
          ? null
          : h(
              'div',
              { className: 'dr-notice', 'data-ok': notice.ok },
              notice.params === undefined ? t(notice.text) : t(notice.text, notice.params),
            ),
        h(
          'div',
          { className: 'dr-body' },
          h(
            'div',
            { className: 'dr-list', tabIndex: 0, onKeyDown: onListKey },
            files.map((entry, i) =>
              h(
                'button',
                {
                  key: entry.path,
                  className: 'dr-row',
                  'data-active': i === index,
                  onClick: () => setIndex(i),
                },
                h(
                  'span',
                  {
                    className: 'dr-dot',
                    'data-s': decisions[entry.path] ? decisions[entry.path].state : '',
                  },
                  dot(decisions[entry.path] ? decisions[entry.path].state : undefined),
                ),
                h('span', { className: 'dr-fname' }, basename(entry.display)),
                emptiesOnRevert(entry)
                  ? h('span', { className: 'dr-new', title: t('review.newHint') }, t('review.new'))
                  : null,
                blocksOf(entry) === undefined
                  ? null
                  : h('span', { className: 'dr-blk' }, blocksOf(entry) + t('review.blocks')),
                h('span', { className: 'dr-num dr-add' }, entry.binary ? '·' : '+' + entry.added),
                h('span', { className: 'dr-num dr-del' }, entry.binary ? '·' : '−' + entry.deleted),
              ),
            ),
          ),
          h(DiffPane, { diff: diff, t: t }),
        ),
        h(
          'div',
          { className: 'dr-foot' },
          h('span', { className: 'dr-note' }, '+' + summary.added + ' −' + summary.deleted),
          notes.length === 0
            ? null
            : h('span', { className: 'dr-blk' }, t('review.notesCount', { count: notes.length })),
          h('span', { className: 'dr-spacer' }),
          h(
            'span',
            { className: 'dr-blk' },
            counted.total > 0 && counted.done === counted.total
              ? t('review.allDone')
              : t('review.progress', { done: counted.done, total: counted.total }),
          ),
          counted.total > 0 && counted.done < counted.total
            ? h(
                'button',
                { className: 'dr-btn', disabled: busy, onClick: () => decide('confirmed', { all: true }) },
                t('review.confirmAll'),
              )
            : null,
          // The whole turn, not just the shown file. Files that were edited
          // since are refused one by one and reported, so this cannot quietly
          // destroy work the reviewer never saw. Once the turn sits at its
          // pre-change content the same button walks back, like the per-file one.
          h(
            'button',
            {
              className: 'dr-btn',
              disabled: busy,
              title: t(revertedTurn ? 'review.undoRevertAllHint' : 'review.revertAllHint'),
              onClick: () => settle(revertedTurn ? 'restore' : 'revert', { path: undefined, all: true }),
            },
            t(revertedTurn ? 'review.undoRevertAll' : 'review.revertAll'),
          ),
          // The notes the reviewer wrote, handed to the composer as one message
          // instead of being sent blind: the text can be read and edited first.
          notes.length === 0
            ? null
            : h(
                'button',
                {
                  className: 'dr-btn',
                  'data-primary': true,
                  disabled: busy,
                  title: t('review.noteWriteHint'),
                  onClick: writeNotes,
                },
                t('review.noteWrite'),
              ),
        ),
      )
    }

    /** The comparison area for whatever the diff read settled on. */
    function DiffPane(props) {
      const diff = props.diff
      const t = props.t
      const [cursor, setCursor] = React.useState(0)
      const nodes = React.useRef(new Map())
      const pane = React.useRef(null)

      // One pass over the comparison: numbered rows, block boundaries, and the
      // word segments each changed row draws with.
      const plan = React.useMemo(() => planDiff(diff), [diff])

      // A different file starts its own count.
      React.useEffect(() => {
        setCursor(0)
      }, [diff])

      // F7 walks the changes, Shift+F7 walks back, the way editors behave. The
      // listener is global, so it must stand down whenever the pane is not the
      // thing on screen: a hidden tab, or a caret inside a text field, keeps
      // F7 for itself instead of moving a cursor nobody can see.
      React.useEffect(() => {
        if (plan === null || plan.blocks.length === 0) return undefined
        const onKey = (event) => {
          if (event.key !== 'F7') return
          if (!ownsKey(pane.current, document.activeElement)) return
          event.preventDefault()
          const max = plan.blocks.length - 1
          setCursor((prev) => {
            const next = event.shiftKey ? prev - 1 : prev + 1
            return next < 0 ? 0 : next > max ? max : next
          })
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [plan])

      // Keep the current block in view, including when F7 moved it.
      React.useEffect(() => {
        if (plan === null || plan.blocks.length === 0) return
        const block = plan.blocks[Math.min(cursor, plan.blocks.length - 1)]
        if (block === undefined) return
        const node = nodes.current.get(block.start)
        if (node !== undefined && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest' })
        }
      }, [cursor, plan])

      if (diff === 'loading') return h('div', { className: 'dr-empty' }, t('review.loading'))
      if (diff === 'missing') return h('div', { className: 'dr-empty' }, t('review.summaryGone'))
      if (diff === 'error') return h('div', { className: 'dr-empty' }, t('review.loadFailed'))
      if (diff.kind === 'binary') return h('div', { className: 'dr-empty' }, t('review.binary'))
      if (diff.kind === 'oversized') return h('div', { className: 'dr-empty' }, t('review.oversized'))
      // Anything without a comparison behind it falls back to the loading
      // notice instead of being read as one: a state the Host grows later
      // must not white-screen the pane.
      if (plan === null) return h('div', { className: 'dr-empty' }, t('review.loading'))

      const total = plan === null ? 0 : plan.blocks.length
      const at = total === 0 ? 0 : Math.min(cursor, total - 1)

      const rowNode = (row, rowKey, segs) =>
        h(
          'div',
          {
            key: rowKey,
            className: 'dr-line',
            'data-k': row.kind,
            'data-b': row.block === undefined || row.block !== at ? undefined : 'true',
            ref: (node) => {
              // Braced so the ref callback never returns the Map's boolean:
              // React 19 treats a returned value as a cleanup function.
              if (node === null) nodes.current.delete(row)
              else nodes.current.set(row, node)
            },
          },
          h('span', { className: 'dr-no' }, row.old === undefined ? '' : String(row.old)),
          h('span', { className: 'dr-no' }, row.new === undefined ? '' : String(row.new)),
          h('span', { className: 'dr-mark' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '),
          h(
            'span',
            { className: 'dr-code' },
            segs === undefined
              ? row.text
              : segs.map((segment, si) =>
                  segment.changed ? h('span', { key: si, className: 'dr-w' }, segment.text) : segment.text,
                ),
          ),
        )

      return h(
        'div',
        { className: 'dr-pane', ref: pane },
        total === 0
          ? null
          : h(
              'div',
              { className: 'dr-nav' },
              h(
                'button',
                {
                  className: 'dr-navbtn',
                  type: 'button',
                  'aria-label': t('review.prev'),
                  title: t('review.prevHint'),
                  disabled: at === 0,
                  onClick: () => setCursor(at - 1),
                },
                '‹',
              ),
              h('span', { className: 'dr-navcount' }, at + 1 + ' / ' + total + t('review.blocks')),
              h(
                'button',
                {
                  className: 'dr-navbtn',
                  type: 'button',
                  'aria-label': t('review.next'),
                  title: t('review.nextHint'),
                  disabled: at >= total - 1,
                  onClick: () => setCursor(at + 1),
                },
                '›',
              ),
              h('span', { className: 'dr-navhint' }, t('review.navHint')),
            ),
        h(
          'div',
          { className: 'dr-diff' },
          diff.coarse ? h('div', { className: 'dr-note' }, t('review.coarse')) : null,
          h(
            'div',
            { className: 'dr-hunks' },
            plan.hunks.map((entry, hi) =>
              h(
                'div',
                { key: hi },
                h('div', { className: 'dr-hunk' }, hunkHeader(entry.hunk)),
                entry.rows.map((row, ri) => rowNode(row, ri, entry.segs.get(row))),
              ),
            ),
          ),
        ),
      )
    }

    /* ── the turn-tail entry ────────────────────────────────────────── */

    /**
     * One button under a finished turn that opens that turn's review. It
     * appears only when the Host still serves a summary for this very turn,
     * so a turn with no recorded changes shows nothing at all.
     * @param props - composed slot props.
     */
    function ReviewEntry(props) {
      const t = props.t
      const turn = props.turn ? props.turn.turn : undefined
      const sessionId = props.sessionId
      const open = props.openResource
      const [recorded, setRecorded] = React.useState(undefined)

      React.useEffect(() => {
        if (sessionId === undefined) return undefined
        let live = true
        fetch(withQuery(LATEST_ROUTE, { sessionId }))
          .then((response) => (response.ok ? response.json() : undefined))
          .then((value) => {
            if (live) setRecorded(value)
          })
          .catch(() => undefined)
        return () => {
          live = false
        }
      }, [sessionId, turn])

      if (recorded === undefined || recorded.state !== 'recorded' || recorded.turn !== turn) return null
      return h(
        'div',
        { className: 'dr-entry' },
        h(
          'button',
          {
            className: 'dr-btn',
            onClick: () => open(reviewAddress(sessionId, recorded.seq, recorded.turn)),
          },
          t('review.openAction'),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'conversation'],
      /**
       * Not part of the plugin surface: the pure pieces the contract test
       * renders directly, so a shape mistake fails there instead of showing up
       * as a blank pane in the page.
       */
      __test: {
        parseAddress,
        reviewAddress,
        hunkHeader,
        basename,
        dirname,
        hunkRows,
        hunkBlocks,
        segments,
        planDiff,
        countBlocks,
        createdByTurn,
        prefetchQueue,
        mergeCount,
        mergeNew,
        tally,
        stepIndex,
        allReverted,
        ownsKey,
        refusalKey,
        pickTurn,
        noteDigest,
        takeLines,
        readStep,
        mergeDraft,
        DiffPane,
        ReviewBody,
        ReviewEntry,
        TAB_ID,
        TAB_KIND,
        TURN_ENTRY_ID,
        NS,
      },
      apply(ctx) {
        /**
         * Hand one message to the Session's composer.
         *
         * A note is the reviewer's instruction for the next turn, and the
         * decision was to let it land in the input box where it can be read
         * and edited rather than being sent on their behalf. That needs the
         * Session scope, which `sessions.scope` is the only way to get:
         * `conversation.input.for` resolves its binding from that scope and
         * throws when given the root context.
         * @param sessionId - the Session whose composer receives the text.
         * @returns a function that writes text into the composer, or
         * undefined when this Session has no composer to write to.
         */
        function composerFor(sessionId) {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          return (text) => {
            // Resolved per call, not captured: the Session scope and its
            // composer may both appear after this tab was first mounted, and
            // failing at call time reports that instead of staying broken.
            const sessions = ctx.get('sessions')
            if (sessions === undefined) throw new Error('diff-review: sessions unavailable')
            const actx = sessions.scope(sessionId)
            if (actx === undefined) throw new Error('diff-review: session scope unavailable')
            const conversation = actx.get('conversation')
            if (conversation === undefined) throw new Error('diff-review: conversation unavailable')
            const input = conversation.input.for(actx)
            // The composer is replaced, not appended to, so whatever the
            // reviewer had already typed is read first and kept.
            const held = input.state?.getSnapshot?.()?.draft
            input.setDraft(mergeDraft(held, text))
            input.focus()
          }
        }

        // Dictionaries: one namespace, both shipped locales.
        ctx.effect(
          () => ctx.locale.register(NS, { zh: ZH, en: EN }),
          'diff-review: dictionaries',
        )

        // One stylesheet for the plugin, removed with its effect.
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => undefined
          if (document.getElementById('dsh-diff-review-style') !== null) return () => undefined
          const tag = document.createElement('style')
          tag.id = 'dsh-diff-review-style'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'diff-review: styles')

        // The tab type: this plugin's own kind, at the builtin band, so no
        // shipped type is displaced.
        const t = () => ctx.locale.bind(NS)
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'builtin',
              patterns: ['dsh-resource://diff-review/**'],
              canOpen: (address) => parseAddress(address) !== undefined,
              title: () => t()('review.tabTitle'),
              guide: [
                {
                  id: 'changes',
                  order: 20,
                  title: () => t()('review.tabTitle'),
                  description: () => t()('review.filesHeading'),
                },
              ],
            }),
          'diff-review: tab type',
        )

        // The body, dispatched by the type's own id.
        //
        // This seat is session-scoped, so the framework hands the registrar a
        // sessionId; that is what makes the composer reachable at all. The
        // session scope itself has to be looked up through `sessions`, because
        // `conversation.input.for` resolves its binding from a retained scope
        // and throws without one.
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: NS,
              inject: (sessionId) => ({ composer: composerFor(sessionId) }),
            },
            ReviewBody,
          ),
        )

        // The turn-tail entry, under an id of its own.
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: TURN_ENTRY_ID,
              locale: NS,
              order: 10,
              inject: () => ({
                openResource: (address) => ctx.sidebarRight.openResource(address),
              }),
            },
            ReviewEntry,
          ),
        )
      },
    }
  },
})
