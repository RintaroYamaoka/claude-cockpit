// パスの扱い:セッションの root、外部ルート(別リポジトリ・worktree)、ツリー内の相対パス。
import type { EngineInterface } from 'claude-code'

import type { Workspace } from '../../types'

/** 絶対パスをツリー内のパスへ。root の中は素の相対、外部ルートの中は `label/…`、どちらでもなければ `~/…`。 */
export function relativize(root: string, workspaces: readonly Workspace[], file: string): string {
  if (root && file.startsWith(`${root}/`)) return file.slice(root.length + 1)
  for (const w of workspaces) if (file.startsWith(`${w.dir}/`)) return `${w.label}/${file.slice(w.dir.length + 1)}`
  return shortenHome(file)
}

/** `/home/<user>/…` を `~/…` に。 */
export function shortenHome(path: string): string {
  return path.replace(/^\/(home|Users)\/[^/]+\//, '~/')
}

/** 層の色を決めるためのパス:外部ルートの label を剥がす。 */
export function insideWorkspace(rel: string, workspaces: readonly Workspace[]): string {
  for (const w of workspaces) if (rel.startsWith(`${w.label}/`)) return rel.slice(w.label.length + 1)
  return rel
}

/** どの root にも入らないか。 */
export function isOutside(root: string, workspaces: readonly Workspace[], file: string): boolean {
  if (root && file.startsWith(`${root}/`)) return false
  return !workspaces.some(w => file.startsWith(`${w.dir}/`))
}

/** 絶対パスのファイルが属するプロジェクトのディレクトリ(チェックを実行する cwd)。 */
export function projectDirOf(root: string, workspaces: readonly Workspace[], file: string): string {
  if (root && file.startsWith(`${root}/`)) return root
  for (const w of workspaces) if (file.startsWith(`${w.dir}/`)) return w.dir
  return file.slice(0, file.lastIndexOf('/'))
}

/** ツリー内のパスを絶対パスへ戻す。 */
export function absolutize(root: string, workspaces: readonly Workspace[], rel: string): string {
  for (const w of workspaces) if (rel.startsWith(`${w.label}/`)) return `${w.dir}/${rel.slice(w.label.length + 1)}`
  if (rel.startsWith('~/')) return rel
  return `${root}/${rel}`
}

/** プロジェクトの目印。触られたファイルから上へ辿って最初に見つかった場所を root にする。 */
const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.claude-plugin', 'composer.json', 'Gemfile', 'deno.json', 'pom.xml']

export async function findProjectRoot($: Pick<EngineInterface, 'fs'>, file: string, stopAt: readonly string[]): Promise<string | null> {
  let dir = file.slice(0, file.lastIndexOf('/'))
  for (let i = 0; i < 8 && dir && dir !== '/'; i++) {
    if (stopAt.includes(dir)) return null
    for (const marker of MARKERS) {
      try {
        if (await $.fs.exists(`${dir}/${marker}`)) return dir
      } catch {
        // 読めない場所は目印なし
      }
    }
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
  return null
}

/** 外部ルートとして加えてよいか。キャッシュや一時ファイルは除く。 */
export function isEligibleOutside(file: string, home: string): boolean {
  const skip = ['/tmp/', '/proc/', '/etc/', '/usr/', `${home}/.cache/`, `${home}/.npm/`, `${home}/.nvm/`, `${home}/.local/`, `${home}/.claude/projects/`]
  return !skip.some(prefix => file.startsWith(prefix))
}

/** `/home/<user>` の部分。 */
export function homeOf(file: string): string {
  return file.match(/^\/(?:home|Users)\/[^/]+/)?.[0] ?? ''
}

/** 外部ルートの label:ディレクトリ名。既存と重なれば親を付ける。 */
export function labelFor(dir: string, existing: readonly Workspace[]): string {
  const base = dir.split('/').pop() ?? dir
  if (!existing.some(w => w.label === base)) return base
  return dir.split('/').slice(-2).join('/')
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extensionOf(path: string): string {
  const base = basename(path)
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
}
