// 依存グラフの構築と、編集されたファイルの再解析。
import type { EngineInterface } from 'claude-code'

import type { Workspace } from '../../types'
import { addedEdgesBetween, analyze, isCodeFile, scanDeps } from '../domain/deps'
import { absolutize } from '../domain/paths'
import { getDeps, getFiles, getRoot, getWorkspaces, setAddedEdges, setDeps, setDepsDone } from '../store'

const LIMIT = 4000

/** 一覧にあるソースをすべて読んで依存グラフを作り直す(背景で 60 件ずつ反映)。 */
export async function rebuildDeps($: EngineInterface): Promise<void> {
  const [root, files, workspaces] = await Promise.all([getRoot($), getFiles($), getWorkspaces($)])
  await setDepsDone($, false)
  await setDeps($, () => ({}))
  const code = files.filter(isCodeFile).slice(0, LIMIT)
  await scanDeps($, code, rel => absolutize(root, workspaces, rel), new Set(code), async nodes => {
    await setDeps($, d => nodes.reduce((acc, n) => ({ ...acc, [n.rel]: n }), d))
  })
  await setDepsDone($, true)
}

/** 外部ルート 1 つ分だけ解析して足す。 */
export async function analyzeWorkspace($: EngineInterface, w: Workspace): Promise<void> {
  const [root, files, workspaces] = await Promise.all([getRoot($), getFiles($), getWorkspaces($)])
  const code = files.filter(isCodeFile)
  const list = code.filter(rel => rel.startsWith(`${w.label}/`)).slice(0, LIMIT)
  await scanDeps($, list, rel => absolutize(root, workspaces, rel), new Set(code), async nodes => {
    await setDeps($, d => nodes.reduce((acc, n) => ({ ...acc, [n.rel]: n }), d))
  })
}

/** 編集されたファイルだけ読み直し、増えた辺を記録する。 */
export async function reanalyze($: EngineInterface, rel: string, file: string, at: number): Promise<void> {
  if (!isCodeFile(rel)) return
  let text: string
  try {
    text = await $.fs.read(file)
  } catch {
    return
  }
  const [deps, files] = await Promise.all([getDeps($), getFiles($)])
  const next = analyze(rel, text, new Set([...files, ...Object.keys(deps)]))
  const added = addedEdgesBetween(deps[rel], next)
  await setDeps($, d => ({ ...d, [rel]: next }))
  if (added.length) await setAddedEdges($, e => added.reduce((acc, k) => ({ ...acc, [k]: at }), e))
}
