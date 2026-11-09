// セッションの立ち上げ:root の決定、ソース一覧と依存グラフの走査、点滅のタイマー。
import type { EngineInterface } from 'claude-code'

import type { Workspace } from '../../types'
import { listFiles } from '../domain/tree'
import { PANE, getDraft, getTurnId, setDraft, setFiles, setRoot, setTick, setWorkspaces } from '../store'
import { rebuildDeps } from './deps'
import { loadWorkspace } from './workspaces'

export const PANE_COLUMNS = 96
/** ペインの開き方:幅 96 列を要求、背景は塗らず端末の色(= transcript と同じ)にする。 */
export const PANE_OPEN = { id: PANE, title: 'drive', columns: PANE_COLUMNS, backgroundColor: 'transparent' } as const

export async function startSession($: EngineInterface, cwd: string): Promise<void> {
  // シェルの cd に引きずられないセッションの root。git リポジトリの中ならその root。
  const sessionRoot = await $.session.root().catch(() => cwd)
  const repo = await $.session.repo()
  const root = repo?.root && sessionRoot.startsWith(repo.root) ? repo.root : sessionRoot
  await setRoot($, root)
  const saved = ((await $.store.get(`drive:workspaces:${root}`)) as Workspace[] | undefined) ?? []
  await setWorkspaces($, () => saved)
  await setDraft($, () => null)

  void $.ui.open(PANE_OPEN)

  $.clock.after(10, () => {
    void (async () => {
      await setFiles($, () => [])
      const list = await listFiles($, root)
      await setFiles($, () => list)
      for (const w of saved) await loadWorkspace($, w)
      await rebuildDeps($)
    })()
  })

  // カーソルの点滅(ターン中かストリーミング中だけ)
  $.clock.every(600, () => {
    void (async () => {
      const [turn, draft] = await Promise.all([getTurnId($), getDraft($)])
      if (turn !== null || draft !== null) await setTick($, await $.clock.now())
    })()
  })
}

/** ソース一覧と依存グラフを作り直す。 */
export async function rescan($: EngineInterface): Promise<number> {
  const root = (await $.session.root().catch(() => '')) || ''
  const list = await listFiles($, root)
  await setFiles($, () => list)
  await rebuildDeps($)
  return list.length
}
