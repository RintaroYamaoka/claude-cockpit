// セッションの立ち上げ:root の決定、ソース一覧と依存グラフの走査、点滅のタイマー。
import type { EngineInterface } from 'claude-code'

import type { Workspace } from '../../types'
import { listFiles } from '../domain/tree'
import { PANE, getDraft, getRoot, getTurnId, getWorkspaces, setDraft, setFiles, setRoot, setTick, setWorkspaces } from '../store'
import { rebuildDeps } from './deps'
import { loadWorkspace } from './workspaces'

export const PANE_COLUMNS = 96
/** ペインの開き方:幅 96 列を要求、背景は塗らず端末の色(= transcript と同じ)にする。 */
export const PANE_OPEN = { id: PANE, title: 'cockpit', columns: PANE_COLUMNS, backgroundColor: 'transparent' } as const

export async function startSession($: EngineInterface, cwd: string): Promise<void> {
  // シェルの cd に引きずられないセッションの root。git リポジトリの中ならその root。
  const sessionRoot = await $.session.root().catch(() => cwd)
  const repo = await $.session.repo().catch(() => null)
  const root = repo?.root && (sessionRoot === repo.root || sessionRoot.startsWith(`${repo.root}/`)) ? repo.root : sessionRoot
  await setRoot($, root)
  const saved = ((await $.store.get(`cockpit:workspaces:${root}`)) as Workspace[] | undefined) ?? []
  await setWorkspaces($, () => saved)
  await setDraft($, () => null)

  void $.ui.open(PANE_OPEN)

  $.clock.after(10, () => void scanAll($))

  // カーソルの点滅(ターン中かストリーミング中だけ)
  $.clock.every(600, () => {
    void (async () => {
      const [turn, draft] = await Promise.all([getTurnId($), getDraft($)])
      if (turn !== null || draft !== null) await setTick($, await $.clock.now())
    })()
  })
}

/** ソース一覧(root と外部ルート)と依存グラフを作り直す。root のファイル数を返す。 */
export async function scanAll($: EngineInterface): Promise<number> {
  const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
  const list = await listFiles($, root)
  await setFiles($, () => list)
  for (const w of workspaces) await loadWorkspace($, w)
  await rebuildDeps($)
  return list.length
}
