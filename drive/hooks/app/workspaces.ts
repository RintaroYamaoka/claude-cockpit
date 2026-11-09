// root の外で触られたファイルを、外部ルート(別リポジトリ・worktree)として依存グラフに加える。
import type { EngineInterface } from 'claude-code'

import type { Workspace } from '../../types'
import { findProjectRoot, homeOf, isEligibleOutside, isOutside, labelFor, relativize, shortenHome } from '../domain/paths'
import { listFiles } from '../domain/tree'
import { getRoot, getWorkspaces, setFiles, setWorkspaces } from '../store'
import { analyzeWorkspace } from './deps'

/** 絶対パスをツリーのパスへ。root の外なら、その場所のプロジェクト root を見つけて加える。 */
export async function resolveRel($: EngineInterface, file: string): Promise<string> {
  const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
  if (!isOutside(root, workspaces, file)) return relativize(root, workspaces, file)
  const home = homeOf(file)
  if (!isEligibleOutside(file, home)) return relativize(root, workspaces, file)
  const dir = await findProjectRoot($, file, [root, home, `${home}/.claude`].filter(Boolean))
  if (!dir || dir === home) return relativize(root, workspaces, file)
  const added: Workspace = { dir, label: labelFor(dir, workspaces) }
  const next = await setWorkspaces($, list => (list.some(w => w.dir === dir) ? list : [...list, added]))
  await $.store.set(`drive:workspaces:${root}`, next)
  $.ui.toast(`外部ルートを追加: ${added.label} (${shortenHome(dir)})`)
  $.clock.after(0, () => void loadWorkspace($, added))
  return relativize(root, next, file)
}

/** 外部ルートのファイル一覧を足し、依存グラフにも含める。 */
export async function loadWorkspace($: EngineInterface, w: Workspace): Promise<void> {
  const list = await listFiles($, w.dir, w.label)
  await setFiles($, f => [...f.filter(p => !p.startsWith(`${w.label}/`)), ...list])
  await analyzeWorkspace($, w)
}

/** 足した外部ルートをすべて外す。 */
export async function forgetWorkspaces($: EngineInterface): Promise<string[]> {
  const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
  await setFiles($, f => f.filter(p => !workspaces.some(w => p.startsWith(`${w.label}/`))))
  await setWorkspaces($, () => [])
  await $.store.set(`drive:workspaces:${root}`, [])
  return workspaces.map(w => w.label)
}
