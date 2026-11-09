// 変更を VS Code で開く(WSL では Windows 側の Code.exe にフォールバック)。
import type { EngineInterface } from 'claude-code'

import type { Change } from '../../types'
import { homeOf, projectDirOf } from '../domain/paths'
import { parseHeredocWrites, resolveShellPath } from '../domain/shell'
import { getRoot, getWorkspaces } from '../store'

/**
 * Edit / Write はそのファイルの変更位置の行、Bash はヒアドキュメントで書いたファイル(無ければ作業ディレクトリ)。
 * WSL では `code` スクリプト(Remote-WSL のサーバーが無いと動かない)を経由せず、Windows 側の Code.exe を
 * `--remote wsl+<distro>` で呼び、WSL のパスのまま開く。起動を待たずに戻る。
 */
export async function openInEditor($: EngineInterface, change: Change): Promise<string> {
  let target: string
  let line = 1
  if (change.tool === 'Bash') {
    const heredoc = parseHeredocWrites(change.command)[0]
    target = heredoc ? resolveShellPath(heredoc.path, change.cwd, homeOf(change.cwd)) : change.cwd
  } else {
    target = change.file
    line = Number(change.diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)?.[1] ?? '1')
  }
  const isWsl = await $.fs.exists('/proc/sys/fs/binfmt_misc/WSLInterop').catch(() => false)
  const isFile = (await $.fs.stat(target).catch(() => null))?.kind === 'file'
  // プロジェクトのフォルダをワークスペースとして開き、その中でファイルを変更位置の行に開く
  const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
  const project = projectDirOf(root, workspaces, target)
  // フォルダとファイルを 1 回で渡すとファイルが開かないことがあるので、2 段階:フォルダ → そのウィンドウでファイルを行指定で
  const steps: string[][] = isFile ? [[project], ['-g', `${target}:${line}`]] : [[project]]
  const found = await $.process.run(['sh', '-c', 'command -v code || true'], { timeoutMs: 5000 }).catch(() => null)
  const code = found?.stdout.trim().split('\n')[0] ?? ''
  const done = `VS Code で開きました: ${project.split('/').pop()}${isFile ? ` › ${change.tool === 'Bash' ? target.split('/').pop() : change.path}:${line}` : ''}`
  // `code` は既存ウィンドウに渡した後も戻ってこないことがある。時間切れは「開けた」とみなす(process.run は時間切れで reject する)
  const run = async (argv: string[]) =>
    $.process.run(argv, { timeoutMs: 30_000 }).catch(err => ({ exitCode: /timeout|timed out/i.test(String(err)) ? 0 : 127, stderr: String(err), stdout: '' }))

  // 1. `code`(WSL では Remote-WSL のリモート CLI 経由。WSL 側のウィンドウにフォルダごと開く)
  if (code) {
    let failed: { exitCode: number; stderr: string } | null = null
    for (const args of steps) {
      const r = await run([code, ...args])
      if (r.exitCode !== 0) {
        failed = r
        break
      }
      if (steps.length > 1 && args === steps[0]) await $.clock.sleep(800) // フォルダのウィンドウが立つのを待つ
    }
    if (!failed) return done
    if (!isWsl) return `開けませんでした: ${(failed.stderr || '').trim().slice(0, 120)}`
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
  for (const args of steps) {
    const r = await run([exe, '--remote', `wsl+${distro}`, ...args])
    if (r.exitCode !== 0) return `開けませんでした: ${(r.stderr || '').trim().split('\n').find(l => !/^\[main|DeprecationWarning|Unknown channel|^\(Use /.test(l)) ?? ''}`.slice(0, 160)
    if (steps.length > 1 && args === steps[0]) await $.clock.sleep(800)
  }
  return `${done}(Code.exe 経由。VS Code から一度 WSL に接続すると code コマンドが使えるようになります)`
}
