// 状態の唯一の置き場。atom と、それを読む・変える関数はこのファイルにだけ書く
// (検証の制約:read / update は atom と同じファイルに無いと通らない。$ を渡す先は関数宣言)。
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Change, Check, DepNode, Draft, Workspace } from '../types'

const root = atom({ plugin: 'drive', key: 'root' } as const, '')
const workspaces = atom({ plugin: 'drive', key: 'workspaces' } as const, [] as Workspace[], { shape: 'workspaces-1' })
const files = atom({ plugin: 'drive', key: 'files' } as const, [] as string[])
const focus = atom({ plugin: 'drive', key: 'focus' } as const, null as string | null)
const changes = atom({ plugin: 'drive', key: 'changes' } as const, [] as Change[], { shape: 'changes-4' })
const intent = atom({ plugin: 'drive', key: 'intent' } as const, '')
const draft = atom({ plugin: 'drive', key: 'draft' } as const, null as Draft | null, { shape: 'draft-2' })
const checks = atom({ plugin: 'drive', key: 'checks' } as const, {} as Record<string, Check>, { shape: 'checks-1' })
const turnId = atom({ plugin: 'drive', key: 'turnId' } as const, null as string | null)
const deps = atom({ plugin: 'drive', key: 'deps' } as const, {} as Record<string, DepNode>, { shape: 'deps-1' })
const addedEdges = atom({ plugin: 'drive', key: 'addedEdges' } as const, {} as Record<string, number>, { shape: 'edges-1' })
const depsDone = atom({ plugin: 'drive', key: 'depsDone' } as const, false)
const tick = atom({ plugin: 'drive', key: 'tick' } as const, 0)
const selected = atom({ plugin: 'drive', key: 'selected' } as const, null as string | null)
const codeScroll = atom({ plugin: 'drive', key: 'codeScroll' } as const, 0)

type $ = EngineInterface

/** 描画 1 回分の状態の写し。 */
export type Frame = {
  root: string
  workspaces: Workspace[]
  focus: string | null
  changes: Change[]
  intent: string
  draft: Draft | null
  checks: Record<string, Check>
  turnId: string | null
  deps: Record<string, DepNode>
  addedEdges: Record<string, number>
  depsDone: boolean
  tick: number
  selected: string | null
  codeScroll: number
}

export async function frame($: $): Promise<Frame> {
  const [a, b, c, d, e, f, g, h, i, j, k, l, m, n] = await Promise.all([
    read($, root), read($, workspaces), read($, focus), read($, changes), read($, intent), read($, draft),
    read($, checks), read($, turnId), read($, deps), read($, addedEdges), read($, depsDone), read($, tick), read($, selected), read($, codeScroll),
  ])
  return { root: a, workspaces: b, focus: c, changes: d, intent: e, draft: f, checks: g, turnId: h, deps: i, addedEdges: j, depsDone: k, tick: l, selected: m, codeScroll: n }
}

export function getRoot($: $) {
  return read($, root)
}
export function getWorkspaces($: $) {
  return read($, workspaces)
}
export function getFiles($: $) {
  return read($, files)
}
export function getChanges($: $) {
  return read($, changes)
}
export function getDeps($: $) {
  return read($, deps)
}
export function getTurnId($: $) {
  return read($, turnId)
}
export function getDraft($: $) {
  return read($, draft)
}

export function setRoot($: $, v: string) {
  return update($, root, () => v)
}
export function setWorkspaces($: $, fn: (v: Workspace[]) => Workspace[]) {
  return update($, workspaces, fn)
}
export function setFiles($: $, fn: (v: string[]) => string[]) {
  return update($, files, fn)
}
export function setFocus($: $, v: string | null) {
  return update($, focus, () => v)
}
export function setChanges($: $, fn: (v: Change[]) => Change[]) {
  return update($, changes, fn)
}
export function setIntent($: $, v: string) {
  return update($, intent, () => v)
}
export function setDraft($: $, fn: (v: Draft | null) => Draft | null) {
  return update($, draft, fn)
}
export function setChecks($: $, fn: (v: Record<string, Check>) => Record<string, Check>) {
  return update($, checks, fn)
}
export function setTurnId($: $, v: string | null) {
  return update($, turnId, () => v)
}
export function setDeps($: $, fn: (v: Record<string, DepNode>) => Record<string, DepNode>) {
  return update($, deps, fn)
}
export function setAddedEdges($: $, fn: (v: Record<string, number>) => Record<string, number>) {
  return update($, addedEdges, fn)
}
export function setDepsDone($: $, v: boolean) {
  return update($, depsDone, () => v)
}
export function setTick($: $, v: number) {
  return update($, tick, () => v)
}
export function setSelected($: $, v: string | null) {
  return update($, selected, () => v)
}
export function setCodeScroll($: $, fn: (v: number) => number) {
  return update($, codeScroll, fn)
}

export const PANE = 'drive'
