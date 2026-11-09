// turn.step のストリームを読み、意図(モデルの文章の 1 行目)と Draft(書かれつつあるコード)を状態に流す。
import type { EngineInterface, HookStream, TurnStepChunk, TurnStepResult } from 'claude-code'

import type { Draft } from '../../types'
import { extractDraft } from '../domain/draft'
import { setDraft, setIntent } from '../store'

let draftWrittenAt = 0
const DRAFT_INTERVAL_MS = 60
const STREAMED_TOOLS = new Set(['Edit', 'Write', 'Bash'])

/** チャンクを通しながら、意図(本体だけ)と Draft(サブエージェントも)を更新する。 */
export async function* observeStep($: EngineInterface, stream: HookStream<TurnStepChunk, TurnStepResult>, agentId?: string): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  const inputs = new Map<number, { id: string; name: string; json: string }>()
  const isMain = agentId === undefined
  let text = ''
  let intentWritten = ''
  for await (const chunk of stream) {
    yield chunk
    if (chunk.kind === 'text' && isMain) {
      text += chunk.text
      const first = text.split('\n').find(l => l.trim().length > 0)?.trim() ?? ''
      if (first && first !== intentWritten && first.length - intentWritten.length >= 8) {
        intentWritten = first
        await setIntent($, first.slice(0, 120))
      }
    } else if (chunk.kind === 'tool') {
      inputs.set(chunk.index, { id: chunk.id, name: chunk.name, json: '' })
    } else if (chunk.kind === 'input') {
      const slot = inputs.get(chunk.index)
      if (!slot || !STREAMED_TOOLS.has(slot.name)) continue
      slot.json += chunk.json
      const now = await $.clock.now()
      if (now - draftWrittenAt < DRAFT_INTERVAL_MS) continue
      const got = extractDraft(slot.json)
      if (got.text === null) continue
      draftWrittenAt = now
      const value: Draft = { id: slot.id, tool: slot.name, path: got.path, text: got.text, startedAt: now, ...(agentId ? { agentId } : {}) }
      await setDraft($, prev => (prev && prev.id === slot.id ? { ...value, startedAt: prev.startedAt } : value))
    }
  }
  const result = await stream.result
  if (isMain) {
    if (intentWritten === '' && result.answer.trim()) await setIntent($, (result.answer.split('\n').find(l => l.trim())?.trim() ?? '').slice(0, 120))
  }
  return result
}
