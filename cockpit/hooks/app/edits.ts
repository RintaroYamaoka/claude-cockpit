// 変更の記録(Edit / Write / Bash)、焦点の更新、リバート。
import type { EngineInterface } from 'claude-code'

import type { Change, FileChange } from '../../types'
import { hunkFromEdit, hunkFromWrite, isFileChange, structureKindOf } from '../domain/edits'
import { parseHeredocWrites, resolveShellPath, summarizeCommand, tailOutput } from '../domain/shell'
import { getChanges, getSelected, setChanges, setCodeScroll, setFiles, setFocus, setHistoryScroll, setSelected } from '../store'
import { scheduleChecks } from './checks'
import { reanalyze } from './deps'
import { adoptRel, relOf } from './workspaces'

/** 適用された Edit / Write。フックが集めた生の材料(ハンクはここで組む)。 */
export type Applied = {
  id: string
  tool: 'Edit' | 'Write'
  file: string
  before: string // Edit は old_string、Write は元のファイル('' なら新規)
  after: string // Edit は new_string、Write は新しいファイル
  isNew: boolean
  fileBefore: string | null // Edit:編集前のファイル全体(行番号と宣言名のため)。Write は不要
  replaceAll?: true
  agentId?: string
}

const TEXT_CAP = 200_000
const KEEP = 200

/**
 * 変更を履歴に積む。新しい変更が来た時の画面の扱いもここで決める:
 * 最新を見ているなら最新に追従(スクロールも先頭へ)。履歴を見ている最中なら画面を変えない
 * (本文はそのまま、履歴は 1 件ずれる分だけ補正して同じ行が見え続ける)。
 * 見ていた変更が上限で履歴から落ちたら、最新に戻す。
 */
async function appendChange($: EngineInterface, change: Change): Promise<void> {
  const selected = await getSelected($)
  const list = await setChanges($, cs => [...cs.filter(x => x.id !== change.id), change].slice(-KEEP))
  if (selected !== null && list.some(c => c.id === selected)) {
    await setHistoryScroll($, s => s + 1)
    return
  }
  if (selected !== null) await setSelected($, null)
  await setCodeScroll($, () => 0)
  await setHistoryScroll($, () => 0)
}

/** ファイルの中身が変わった後にやること:焦点、依存の再解析、チェック。記録とリバートの両方から呼ぶ。 */
async function afterFileChanged($: EngineInterface, c: Pick<FileChange, 'id' | 'path' | 'file' | 'at'>): Promise<void> {
  await setFocus($, c.path)
  await reanalyze($, c.path, c.file, c.at)
  scheduleChecks($, c.id, c.file)
}

/** 適用された Edit / Write を記録し、焦点・依存・チェックを更新する。 */
export async function recordChange($: EngineInterface, a: Applied): Promise<void> {
  const rel = await adoptRel($, a.file)
  const now = await $.clock.now()
  const hunk = a.tool === 'Edit' ? hunkFromEdit(a.fileBefore, a.before, a.after) : hunkFromWrite(a.isNew ? null : a.before, a.after)
  const cap = (s: string) => (s.length <= TEXT_CAP ? s : null)
  const change: FileChange = {
    id: a.id, tool: a.tool, path: rel, file: a.file, at: now,
    symbol: hunk.symbol, diff: hunk.diff, plus: hunk.plus, minus: hunk.minus,
    kind: a.isNew ? 'new' : structureKindOf(rel), before: cap(a.before), after: cap(a.after), isNew: a.isNew,
    ...(a.replaceAll ? { replaceAll: true as const } : {}),
    ...(a.agentId ? { agentId: a.agentId } : {}),
  }
  await appendChange($, change)
  if (a.isNew && !rel.startsWith('~/')) await setFiles($, f => (f.includes(rel) ? f : [...f, rel]))
  await afterFileChanged($, change)
}

export type RanCommand = { id: string; command: string; exitCode: number; output: string; cwd: string; home: string; existedBefore: Record<string, string | null>; agentId?: string }

/** 実行した Bash を記録する。ヒアドキュメント(`cat > path <<EOF`)で書いたファイルは Write と同じ変更として記録。 */
export async function recordCommand($: EngineInterface, r: RanCommand): Promise<void> {
  const now = await $.clock.now()
  // コマンドも出力も全文を持つ(表示側でスクロール)。極端に大きい出力だけ末尾 2000 行に切る
  await appendChange($, {
    id: r.id, tool: 'Bash', at: now, summary: summarizeCommand(r.command, 60), command: r.command, cwd: r.cwd,
    exitCode: r.exitCode, output: tailOutput(r.output, 2000).join('\n'),
    ...(r.agentId ? { agentId: r.agentId } : {}),
  })
  if (r.exitCode !== 0) return
  for (const w of parseHeredocWrites(r.command)) {
    const file = resolveShellPath(w.path, r.cwd, r.home)
    const before = r.existedBefore[file] ?? null
    const after = w.isAppend && before !== null ? `${before}${w.content}\n` : `${w.content}\n`
    await recordChange($, {
      id: `${r.id}-${file.replace(/[^A-Za-z0-9]/g, '_')}`, tool: 'Write', file, before: before ?? '', after, isNew: before === null, fileBefore: null,
      ...(r.agentId ? { agentId: r.agentId } : {}),
    })
  }
}

/** Read の記録:焦点だけ動かす(外部ルートは足さない)。 */
export async function recordRead($: EngineInterface, file: string): Promise<void> {
  await setFocus($, await relOf($, file))
}

/**
 * 直前の Edit / Write を逆向きに適用する。
 * 人が押した操作なので Claude Code のツールは通さず、ファイルに直接書く(許可ダイアログも出ず、履歴に自分を積まない)。
 * 元の変更に「リバート済み」を付け、その変更の id で依存とチェックを回し直す。
 */
export async function revertLast($: EngineInterface): Promise<string> {
  const list = await getChanges($)
  const last = [...list].reverse().find((c): c is FileChange => isFileChange(c) && !c.reverted)
  if (!last) return 'リバートできる変更がありません。'
  const failed = await applyInverse($, last)
  if (failed) return failed
  await setChanges($, cs => cs.map(x => (x.id === last.id ? { ...x, reverted: true as const } : x)))
  await afterFileChanged($, { ...last, at: await $.clock.now() })
  await $.session
    .append({ message: { type: 'user', content: [{ type: 'text', text: `cockpit: 人が ${last.path}${last.symbol ? ` (${last.symbol})` : ''} への直前の変更をリバートした。意図的な判断。別の方法が要るか人に聞く。` }] } })
    .catch(() => undefined)
  return `リバート: ${last.path}${last.symbol ? ` · ${last.symbol}` : ''}`
}

/** 逆向きの適用。成功なら null、できなければ理由。 */
async function applyInverse($: EngineInterface, c: FileChange): Promise<string | null> {
  if (c.isNew) {
    const r = await $.process.run(['rm', '--', c.file], { timeoutMs: 5000 }).catch(err => ({ exitCode: 1, stderr: String(err) }))
    return r.exitCode === 0 ? null : `削除に失敗: ${r.stderr.trim().slice(0, 100)}`
  }
  if (c.before === null || c.after === null) return 'この変更は大きすぎて元の内容を保持していません。'
  if (c.tool === 'Write') {
    await $.fs.write(c.file, c.before)
    return null
  }
  const text = await $.fs.read(c.file).catch(() => null)
  if (text === null) return 'ファイルが読めません。'
  const count = text.split(c.after).length - 1
  if (count === 0) return 'その変更はもうファイルに残っていません(後の編集で上書きされた)。'
  if (count > 1 && !c.replaceAll) return '同じ文字列が複数あって一意に戻せません。'
  await $.fs.write(c.file, c.replaceAll ? text.split(c.after).join(c.before) : text.replace(c.after, () => c.before!))
  return null
}
