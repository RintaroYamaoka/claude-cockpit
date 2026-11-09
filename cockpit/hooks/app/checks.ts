// 編集が落ち着いたら 1 回だけチェックを実行し、待っていた変更すべてに結果を付ける。結果は見せるだけ(モデルには返さない)。
import type { EngineInterface } from 'claude-code'

import type { Check, CheckItem } from '../../types'
import { type CheckPlan, planChecks, runCheck } from '../domain/checks'
import { projectDirOf } from '../domain/paths'
import { getRoot, getWorkspaces, setChecks } from '../store'

const SETTLE_MS = 600 // 連続する編集はこの間隔で束ねる
const pending = new Map<string, string>() // tool_use_id → file
let timer: { cancel: () => void } | null = null
let isRunning = false

export function scheduleChecks($: EngineInterface, id: string, file: string): void {
  pending.set(id, file)
  const placeholder: Check = { at: Date.now(), items: [{ label: 'チェック', status: 'running', detail: [], ms: 0 }] }
  void setChecks($, c => ({ ...c, [id]: placeholder }))
  timer?.cancel()
  timer = $.clock.after(SETTLE_MS, () => void runPending($))
}

async function runPending($: EngineInterface): Promise<void> {
  if (isRunning || pending.size === 0) return
  isRunning = true
  const batch = new Map(pending)
  pending.clear()
  try {
    const [root, workspaces] = await Promise.all([getRoot($), getWorkspaces($)])
    const byProject = new Map<string, string[]>()
    for (const [id, file] of batch) {
      const dir = projectDirOf(root, workspaces, file)
      byProject.set(dir, [...(byProject.get(dir) ?? []), id])
    }
    for (const [dir, ids] of byProject) {
      // 同じコマンドは 1 回だけ(同じプロジェクトの 2 ファイルを編集しても tsc は 1 回)
      const unique = new Map<string, CheckPlan>()
      for (const id of ids) for (const p of await planChecks($, dir, batch.get(id)!)) unique.set(p.argv.join(' '), p)
      const plans = [...unique.values()]
      const items: CheckItem[] = plans.length
        ? plans.map(p => ({ label: p.label, status: 'running', detail: [], ms: 0 }))
        : [{ label: 'チェック', status: 'skip', detail: ['このプロジェクトで実行できるチェックが無い'], ms: 0 }]
      const initial: Check = { at: Date.now(), items }
      await setChecks($, c => ids.reduce((acc, id) => ({ ...acc, [id]: initial }), c))
      // 結果は位置で差し替える(同じ label のテストが 2 本あっても混ざらない)
      for (const [k, plan] of plans.entries()) {
        const item = await runCheck($, plan)
        await setChecks($, c =>
          ids.reduce((acc, id) => {
            const prev = acc[id]
            return prev ? { ...acc, [id]: { ...prev, items: prev.items.map((it, i) => (i === k ? item : it)) } } : acc
          }, c),
        )
      }
    }
  } finally {
    isRunning = false
    if (pending.size > 0) timer = $.clock.after(300, () => void runPending($))
  }
}
