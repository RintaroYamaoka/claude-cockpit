// 編集の直後に実行する速いチェック(型チェック・関連テスト・lint)の計画と実行。
import type { EngineInterface } from 'claude-code'

import type { CheckItem } from '../../types'
import { basename, dirname, extensionOf } from './paths'

export type CheckPlan = { label: string; argv: string[]; cwd: string; timeoutMs: number }

async function exists($: Pick<EngineInterface, 'fs'>, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

/** 触ったファイルに効くチェックを決める。無ければ空。 */
export async function planChecks($: Pick<EngineInterface, 'fs'>, projectDir: string, file: string): Promise<CheckPlan[]> {
  const plans: CheckPlan[] = []
  const ext = extensionOf(file)
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) {
    if ((await exists($, `${projectDir}/node_modules/.bin/tsc`)) && (await exists($, `${projectDir}/tsconfig.json`))) {
      plans.push({ label: '型チェック', argv: [`${projectDir}/node_modules/.bin/tsc`, '--noEmit', '-p', projectDir], cwd: projectDir, timeoutMs: 90_000 })
    }
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mts', 'mjs'].includes(ext)) {
    const test = await relatedTest($, file)
    if (test) {
      if (await exists($, `${projectDir}/node_modules/.bin/vitest`)) {
        plans.push({ label: 'テスト', argv: [`${projectDir}/node_modules/.bin/vitest`, 'run', test, '--reporter=dot'], cwd: projectDir, timeoutMs: 120_000 })
      } else if (await exists($, `${projectDir}/node_modules/.bin/jest`)) {
        plans.push({ label: 'テスト', argv: [`${projectDir}/node_modules/.bin/jest`, test, '--silent'], cwd: projectDir, timeoutMs: 120_000 })
      }
    }
  }
  if (ext === 'py') plans.push({ label: 'lint', argv: ['ruff', 'check', file], cwd: projectDir, timeoutMs: 30_000 })
  if (ext === 'rs') plans.push({ label: 'cargo check', argv: ['cargo', 'check', '-q'], cwd: projectDir, timeoutMs: 180_000 })
  if (ext === 'go') plans.push({ label: 'go vet', argv: ['go', 'vet', './...'], cwd: projectDir, timeoutMs: 120_000 })
  return plans
}

async function relatedTest($: Pick<EngineInterface, 'fs'>, file: string): Promise<string | null> {
  const dir = dirname(file)
  const base = basename(file)
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs)$/.test(base)) return file
  const ext = extensionOf(base)
  const stem = base.slice(0, base.length - ext.length - 1)
  const candidates = [
    `${dir}/${stem}.test.${ext}`, `${dir}/${stem}.spec.${ext}`,
    `${dir}/__tests__/${stem}.test.${ext}`, `${dir}/__tests__/${stem}.${ext}`,
    `${dir}/${stem}.test.ts`, `${dir}/${stem}.test.tsx`,
  ]
  for (const c of candidates) if (await exists($, c)) return c
  return null
}

/** 1 本実行して結果にする。 */
export async function runCheck($: Pick<EngineInterface, 'process' | 'clock'>, plan: CheckPlan): Promise<CheckItem> {
  const started = await $.clock.now()
  try {
    const r = await $.process.run(plan.argv, { cwd: plan.cwd, timeoutMs: plan.timeoutMs })
    const ms = (await $.clock.now()) - started
    if (r.exitCode === 0) return { label: plan.label, status: 'ok', detail: [], ms }
    const lines = `${r.stdout}\n${r.stderr}`
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^\s*at\s/.test(l))
    const errors = lines.filter(l => /error|fail|✗|×/i.test(l))
    const detail = (errors.length ? errors : lines).slice(0, 8).map(l => l.replace(`${plan.cwd}/`, ''))
    return { label: plan.label, status: 'fail', detail, ms }
  } catch (err) {
    const ms = (await $.clock.now()) - started
    return { label: plan.label, status: 'skip', detail: [String(err instanceof Error ? err.message : err).slice(0, 120)], ms }
  }
}

export const STATUS_MARK: Record<CheckItem['status'], string> = { ok: '✓', fail: '✗', running: '⏳', skip: '–' }
