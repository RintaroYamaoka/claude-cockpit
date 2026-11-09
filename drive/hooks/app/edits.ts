// 変更の記録(Edit / Write / Bash)、焦点の更新、リバート。
import type { EngineInterface } from 'claude-code'

import type { Change } from '../../types'
import { hunkFromWrite, structureKindOf } from '../domain/edits'
import { homeOf, projectDirOf } from '../domain/paths'
import { parseHeredocWrites, resolveShellPath, summarizeCommand, tailOutput } from '../domain/shell'
import { getChanges, getRoot, getWorkspaces, setChanges, setCodeScroll, setFiles, setFocus, setSelected } from '../store'
import { scheduleChecks } from './checks'
import { reanalyze } from './deps'
import { resolveRel } from './workspaces'

export type Applied = {
  id: string
  file: string
  diff: string
  symbol: string | null
  isNew: boolean
  tool: 'Edit' | 'Write'
  before: string | null
  after: string | null
  agentId?: string
}

const TEXT_CAP = 200_000
const KEEP = 200

/** 適用された Edit / Write を記録し、焦点・依存・チェックを更新する。 */
export async function recordChange($: EngineInterface, a: Applied): Promise<void> {
  const rel = await resolveRel($, a.file)
  const now = await $.clock.now()
  const cap = (s: string | null) => (s !== null && s.length <= TEXT_CAP ? s : null)
  const change: Change = {
    id: a.id, path: rel, file: a.file, symbol: a.symbol, diff: a.diff, at: now,
    kind: a.isNew ? 'new' : structureKindOf(rel), before: cap(a.before), after: cap(a.after), isNew: a.isNew, tool: a.tool,
    ...(a.agentId ? { agentId: a.agentId } : {}),
  }
  await setFocus($, rel)
  await setSelected($, null) // 新しい変更が来たら最新に戻す(ライブ感を優先)
  await setCodeScroll($, () => 0)
  await setChanges($, list => [...list.filter(x => x.id !== a.id), change].slice(-KEEP))
  if (a.isNew && !rel.startsWith('~/')) await setFiles($, f => (f.includes(rel) ? f : [...f, rel]))
  await reanalyze($, rel, a.file, now)
  scheduleChecks($, a.id, a.file)
}

export type RanCommand = { id: string; command: string; exitCode: number; output: string; cwd: string; home: string; existedBefore: Record<string, string | null>; agentId?: string }

/** 実行した Bash を記録する。ヒアドキュメント(`cat > path <<EOF`)で書いたファイルは Write と同じ変更として記録。 */
export async function recordCommand($: EngineInterface, r: RanCommand): Promise<void> {
  const now = await $.clock.now()
  // コマンドも出力も全文を持つ(表示側でスクロール)。極端に大きい出力だけ末尾 2000 行に切る
  const entry: Change = {
    id: r.id, path: summarizeCommand(r.command, 60), file: r.cwd, symbol: null, diff: '', at: now, kind: null,
    before: null, after: null, isNew: false, tool: 'Bash', exitCode: r.exitCode, command: r.command, output: tailOutput(r.output, 2000).join('\n'),
    ...(r.agentId ? { agentId: r.agentId } : {}),
  }
  await setSelected($, null)
  await setCodeScroll($, () => 0)
  await setChanges($, list => [...list.filter(x => x.id !== r.id), entry].slice(-KEEP))
  if (r.exitCode !== 0) return
  for (const w of parseHeredocWrites(r.command)) {
    const file = resolveShellPath(w.path, r.cwd, r.home)
    const before = r.existedBefore[file] ?? null
    const after = w.isAppend && before !== null ? before + w.content : w.content
    const hunk = hunkFromWrite(w.content, before === null)
    await recordChange($, { id: `${r.id}-${file.replace(/[^A-Za-z0-9]/g, '_')}`, file, diff: hunk.diff, symbol: hunk.symbol, isNew: before === null, tool: 'Write', before, after, ...(r.agentId ? { agentId: r.agentId } : {}) })
  }
}

/**
 * 変更を VS Code で開く。Edit / Write はそのファイルの変更位置の行、Bash はヒアドキュメントで書いたファイル(無ければ作業ディレクトリ)。
 * WSL では `code` スクリプト(Remote-WSL のサーバーが無いと動かない)を経由せず、Windows 側の Code.exe を
 * `--remote wsl+<distro>` で呼び、WSL のパスのまま開く。起動を待たずに戻る。
 */
export async function openInEditor($: EngineInterface, change: Change): Promise<string> {
  let target: string
  let line = 1
  if (change.tool === 'Bash') {
    const heredoc = parseHeredocWrites(change.command ?? '')[0]
    target = heredoc ? resolveShellPath(heredoc.path, change.file, homeOf(change.file)) : change.file
  } else {
    target = change.file
    line = Number(change.diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)?.[1] ?? '1')
  }
  const isWsl = await $.fs.exists('/proc/sys/fs/binfmt_misc/WSLInterop').catch(() => false)
  const isFile = (await $.fs.stat(target).catch(() => null))?.kind === 'file'
  // プロジェクトのフォルダをワークスペースとして開き、その中でファイルを変更位置の行に開く
  const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
  const project = projectDirOf(root, workspaces, target)
  const fileArgs = isFile ? [project, '-g', `${target}:${line}`] : [project]
  const found = await $.process.run(['sh', '-c', 'command -v code || true'], { timeoutMs: 5000 }).catch(() => null)
  const code = found?.stdout.trim().split('\n')[0] ?? ''
  const done = `VS Code で開きました: ${project.split('/').pop()}${isFile ? ` › ${change.tool === 'Bash' ? target.split('/').pop() : change.path}:${line}` : ''}`

  // 1. `code <プロジェクト> -g <ファイル>:<行>`。WSL では Remote-WSL のリモート CLI 経由で、WSL 側のウィンドウにフォルダごと開く
  if (code) {
    const r = await $.process.run([code, ...fileArgs], { timeoutMs: 30_000 }).catch(err => ({ exitCode: /timeout|timed out/i.test(String(err)) ? 0 : 127, stderr: String(err), stdout: '' }))
    if (r.exitCode === 0) return done
    if (!isWsl) return `開けませんでした: ${(r.stderr || '').trim().slice(0, 120)}`
  } else if (!isWsl) {
    return 'VS Code の code コマンドが PATH にありません。'
  }

  // 2. WSL で 1 が失敗(リモート CLI が未インストールなど)した時だけ、Windows 側の Code.exe を直接
  const probe = await $.process
    .run(['sh', '-c', 'c=$(command -v code 2>/dev/null); [ -n "$c" ] && d=$(dirname "$(dirname "$c")") && [ -f "$d/Code.exe" ] && { echo "$d/Code.exe"; exit 0; }; for p in /mnt/c/Users/*/AppData/Local/Programs/"Microsoft VS Code"/Code.exe "/mnt/c/Program Files/Microsoft VS Code/Code.exe"; do [ -f "$p" ] && { echo "$p"; exit 0; }; done; echo'], { timeoutMs: 5000 })
    .catch(() => null)
  const exe = probe?.stdout.trim().split('\n')[0] ?? ''
  if (!exe) return 'VS Code(Code.exe)が見つかりません。'
  const distro = (await $.process.run(['sh', '-c', 'echo "$WSL_DISTRO_NAME"'], { timeoutMs: 3000 }).catch(() => null))?.stdout.trim() || 'Ubuntu'
  const r = await $.process.run([exe, '--remote', `wsl+${distro}`, ...fileArgs], { timeoutMs: 30_000 }).catch(err => ({ exitCode: /timeout|timed out/i.test(String(err)) ? 0 : 1, stderr: String(err), stdout: '' }))
  if (r.exitCode !== 0) return `開けませんでした: ${(r.stderr || '').trim().split('\n').find(l => !/^\[main|DeprecationWarning|Unknown channel|^\(Use /.test(l)) ?? ''}`.slice(0, 160)
  return `${done}(Code.exe 経由。VS Code から一度 WSL に接続すると code コマンドが使えるようになります)`
}

/** Read の記録:焦点だけ動かす。 */
export async function recordRead($: EngineInterface, file: string): Promise<void> {
  await setFocus($, await resolveRel($, file))
}

/** 直前の Edit / Write を逆向きに適用する。 */
export async function revertLast($: EngineInterface): Promise<string> {
  const list = await getChanges($)
  const last = [...list].reverse().find(c => !c.reverted && c.tool !== 'Bash')
  if (!last) return 'リバートできる変更がありません。'
  if (last.isNew) {
    const r = await $.process.run(['rm', '--', last.file], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return `削除に失敗: ${r.stderr.trim().slice(0, 100)}`
  } else if (last.before !== null && last.after !== null) {
    const r =
      last.tool === 'Write'
        ? await $.tool.call({ tool: 'Write', file_path: last.file, content: last.before })
        : await $.tool.call({ tool: 'Edit', file_path: last.file, old_string: last.after, new_string: last.before })
    if (r.deny !== undefined || r.isError) return `リバートできませんでした: ${r.deny ?? (r.text ?? '').slice(0, 100)}`
  } else {
    return 'この変更は大きすぎて元の内容を保持していません。'
  }
  await setChanges($, cs => cs.map(x => (x.id === last.id ? { ...x, reverted: true as const } : x)))
  await $.session
    .append({ message: { type: 'user', content: [{ type: 'text', text: `drive: 人が ${last.path}${last.symbol ? ` (${last.symbol})` : ''} への直前の変更をリバートした。意図的な判断。別の方法が要るか人に聞く。` }] } })
    .catch(() => undefined)
  return `リバート: ${last.path}${last.symbol ? ` · ${last.symbol}` : ''}`
}

