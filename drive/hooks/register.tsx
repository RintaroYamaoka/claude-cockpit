// 配線だけ:どのイベントでどの関数を呼ぶか。状態は store、処理は app、描画は ui/pane。
// 左の transcript には触らない。描くのは右のペイン 1 枚。設定は無い。
import type { EngineInterface, Register } from 'claude-code'

import type { Change } from '../types'
import { observeStep } from './app/draft'
import { openInEditor, recordChange, recordCommand, recordRead, revertLast } from './app/edits'
import { PANE_OPEN, rescan, startSession } from './app/session'
import { forgetWorkspaces } from './app/workspaces'
import { hunkFromEdit, hunkFromWrite } from './domain/edits'
import { homeOf } from './domain/paths'
import { parseHeredocWrites, resolveShellPath } from './domain/shell'
import { PANE, frame, setCodeScroll, setDraft, setIntent, setSelected, setTurnId } from './store'
import { renderPane } from './ui/pane'

const COMMAND = 'drive'

let revertArmedAt = 0
const REVERT_CONFIRM_MS = 3000

/** 1 キーの誤操作を防ぐ:3 秒以内に 2 回押して確定。 */
async function revertWithConfirm($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - revertArmedAt > REVERT_CONFIRM_MS) {
    revertArmedAt = now
    $.ui.toast('もう一度 r でリバートを確定')
    return
  }
  revertArmedAt = 0
  $.ui.toast(await revertLast($))
}

function makeActions($: EngineInterface) {
  return {
    revert: () => void revertWithConfirm($),
    select: (id: string | null) =>
      void (async () => {
        await setSelected($, id)
        await setCodeScroll($, () => 0)
      })(),
    scroll: (by: number) => void setCodeScroll($, s => Math.max(0, s + by)),
    open: (change: Change) => void openInEditor($, change).then(msg => $.ui.toast(msg)),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'drive のペインにフォーカス(o VS Code で開く · r リバート · j/k スクロール · Esc で戻る)。/drive rescan 依存の再解析、/drive forget 外部ルートを外す。プロンプトからは >revert' })
    await startSession($, e.cwd)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const t = e.text.trim()
    if (e.command || e.isMeta) return next(e)
    if (t === '>revert' || t === '>undo') return { drop: await revertLast($) }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'rescan') return { text: `再解析しました: ${await rescan($)} files` }
    if (arg === 'forget') return { text: `外部ルートを外しました: ${(await forgetWorkspaces($)).join(', ') || '(無し)'}` }
    if (arg) return { text: `drive: /drive ${arg} はありません。/drive、/drive rescan、/drive forget。リバートはプロンプトで >revert。` }
    // /drive はペインを開き、キーボードをペインに渡す(x r j k が効く。Esc でプロンプトへ)
    const opened = await $.ui.open({ ...PANE_OPEN, focus: true })
    return { text: opened.isPlaced ? 'drive にフォーカス。o VS Code で開く · r リバート · j/k スクロール · Esc で戻る' : `drive は待機中: ${opened.reason}` }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (typeof e.file_path === 'string') await recordRead($, e.file_path)
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const file = typeof e.file_path === 'string' ? e.file_path : null
    const before = typeof e.old_string === 'string' ? e.old_string : ''
    const after = typeof e.new_string === 'string' ? e.new_string : ''
    const content = file ? await $.fs.read(file).catch(() => null) : null
    const ran = await next(e)
    await setDraft($, () => null)
    if (file && ran.deny === undefined && ran.isError !== true) {
      const hunk = hunkFromEdit(content, before, after)
      await recordChange($, { id: e.tool_use_id, file, diff: hunk.diff, symbol: hunk.symbol, isNew: false, tool: 'Edit', before, after, agentId: e.agentId })
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const file = typeof e.file_path === 'string' ? e.file_path : null
    const content = typeof e.content === 'string' ? e.content : ''
    const existed = file ? await $.fs.exists(file).catch(() => false) : false
    const before = file && existed ? await $.fs.read(file).catch(() => null) : null
    const ran = await next(e)
    await setDraft($, () => null)
    if (file && ran.deny === undefined && ran.isError !== true) {
      const hunk = hunkFromWrite(content, !existed)
      await recordChange($, { id: e.tool_use_id, file, diff: hunk.diff, symbol: hunk.symbol, isNew: !existed, tool: 'Write', before, after: content, agentId: e.agentId })
    }
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = typeof e.command === 'string' ? e.command : ''
    const cwd = await $.session.cwd().catch(() => '')
    const home = homeOf(cwd)
    const existedBefore: Record<string, string | null> = {}
    for (const w of parseHeredocWrites(command)) {
      const file = resolveShellPath(w.path, cwd, home)
      existedBefore[file] = await $.fs.read(file).catch(() => null)
    }
    const ran = await next(e)
    await setDraft($, () => null)
    if (ran.deny !== undefined) return ran
    // Bash の結果は { stdout, stderr, interrupted } だけで終了コードは無い。
    // 失敗は isError と、モデルが読むテキストの「Exit code N」で分かる。
    const result = (ran.result ?? {}) as { stdout?: string; stderr?: string; interrupted?: boolean }
    const text = ran.text ?? ''
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() || text
    const parsed = text.match(/Exit code (\d+)/)?.[1]
    const exitCode = result.interrupted ? 130 : parsed ? Number(parsed) : ran.isError ? 1 : 0
    await recordCommand($, { id: e.tool_use_id, command, exitCode, output, cwd, home, existedBefore, agentId: e.agentId })
    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setIntent($, '')
      await setTurnId($, e.turnId)
    }
    return next(e)
  })

  // サブエージェントのストリームも観る(書いているコードは流す。意図は本体だけ)
  on('turn.step', async function* ($, e, next) {
    return yield* observeStep($, next(e), e.agentId)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await setDraft($, () => null)
    await setTurnId($, null)
    return done
  })

  // ペインの上のホイール・スクロールキーは、ペイン全体ではなく本文のコードを動かす
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    if (e.component !== 'Pane') return {}
    await setCodeScroll($, s => Math.max(0, s + e.by))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPane($, e, await frame($), makeActions($)))
}
