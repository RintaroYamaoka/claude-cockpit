// ペイン(1 ページ、枠は固定):
//   対象ファイルの依存(imports / dependents / 増えた依存)
//   意図 → ストリーミング中のコード、または直近の変更(diff)→ 結果とチェック
//   履歴
//   r リバート  j/k スクロール
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Change } from '../../types'
import { STATUS_MARK } from '../domain/checks'
import { dependentsOf, edgeKey, moduleOf } from '../domain/deps'
import { tailLines } from '../domain/draft'
import { KIND_LABEL, countLines, windowHunk } from '../domain/edits'
import { insideWorkspace, relativize } from '../domain/paths'
import type { Frame } from '../store'
import { clock, fit, isPulseOn } from './format'
import { FAIL, NOW, OK, WARN, layerColor, moduleColor } from './palette'

type PaneInput = Extract<RenderInput, { component: 'Pane' }>

export type Actions = { revert: () => void; select: (id: string | null) => void; scroll: (by: number) => void; open: (change: Change) => void }

const DEPS_ROWS = 3 // 対象ファイル・imports・dependents
const NOTE_ROWS = 2 // 失敗の行

export function renderPane($: EngineInterface, e: PaneInput, f: Frame, actions: Actions) {
  const { Box, Text, Button, Code } = $.ui.resolve(e)
  const RIGHT_PAD = 2 // 右端で文字が切れて見えないための余白
  const W = Math.max(24, e.props.bodyColumns - RIGHT_PAD)
  // 中身は窓より 1 行少なく組む。木が窓より高い時、ペインが最後の 1 行をスクロールの印に使うため
  const R = Math.max(14, e.props.scroll.bodyRows - 1)
  const pulse = isPulseOn(f.tick)
  const isWorking = f.turnId !== null
  const list = [...f.changes].reverse()
  const latest = list[0]
  const hasRevertable = list.some(c => !c.reverted && c.tool !== 'Bash')
  // 履歴で選んだ変更があればそれを映す(その時の画面に戻る)。無ければ最新
  const selected = f.selected ? list.find(c => c.id === f.selected) ?? null : null
  const shown = selected ?? latest
  const isHistory = selected !== null

  // 行の配分は固定:依存 3、罫 1、意図 1、見出し 1、本文、結果 1、補足 2、罫 1、履歴(残り)、罫 1、操作 1
  const bodyRows = Math.max(4, Math.floor((R - DEPS_ROWS - 1 - 1 - 1 - 1 - NOTE_ROWS - 1 - 1 - 1) * 0.75))
  const historyRows = Math.max(2, R - DEPS_ROWS - 1 - 1 - 1 - bodyRows - 1 - NOTE_ROWS - 1 - 1 - 1)

  // ---- 対象ファイルの依存(履歴を見ている時はその変更のファイル)
  const focus = isHistory && selected && selected.tool !== 'Bash' ? selected.path : f.focus
  const node = focus ? f.deps[focus] : undefined
  const focusModule = focus ? moduleOf(focus) : ''
  const colorOf = (m: string) => moduleColor(insideWorkspace(m, f.workspaces))
  const importModules = node ? [...new Set(node.imports.map(moduleOf))].filter(m => m !== focusModule) : []
  const dependents = focus ? dependentsOf(f.deps, focus) : []
  const dependentModules = [...new Set(dependents.map(moduleOf))]
  const isAdded = (to: string) => (focus ? edgeKey(focus, to) in f.addedEdges : false)
  const deps = [
    <Text key="focus" wrap="truncate-end">
      <Text color={NOW}>{isWorking && pulse ? '▶ ' : '▷ '}</Text>
      {focus ? (
        <Text>
          <Text color={layerColor(insideWorkspace(focus, f.workspaces))} weight="bold">{fit(focus, Math.max(8, W - 20))}</Text>
          {node?.exports.length ? <Text dimColor>  exports {node.exports.slice(0, 4).join(', ')}{node.exports.length > 4 ? ` +${node.exports.length - 4}` : ''}</Text> : null}
        </Text>
      ) : (
        <Text dimColor>まだファイルを触っていない</Text>
      )}
    </Text>,
    <Text key="imports" wrap="truncate-end">
      <Text dimColor>  imports     </Text>
      {!focus ? (
        <Text dimColor>—</Text>
      ) : !node ? (
        <Text dimColor>{f.depsDone ? '(解析対象外)' : '(解析中…)'}</Text>
      ) : importModules.length === 0 && node.packages.length === 0 ? (
        <Text dimColor>—</Text>
      ) : (
        <Text>
          {importModules.slice(0, 6).map(m => (
            <Text key={`i:${m}`}>
              <Text color={colorOf(m)}>{m}</Text>
              {node.imports.some(t => moduleOf(t) === m && isAdded(t)) ? <Text color={OK}>+</Text> : null}
              <Text>  </Text>
            </Text>
          ))}
          {node.packages.slice(0, 6).map(p => (
            <Text key={`p:${p}`}>
              <Text dimColor>{p}</Text>
              {isAdded(p) ? <Text color={OK}>+</Text> : null}
              <Text>  </Text>
            </Text>
          ))}
        </Text>
      )}
    </Text>,
    <Text key="dependents" wrap="truncate-end">
      <Text dimColor>  dependents  </Text>
      {!focus || !node ? (
        <Text dimColor>—</Text>
      ) : dependents.length === 0 ? (
        <Text dimColor>—(エントリポイントか未参照)</Text>
      ) : (
        <Text>
          <Text weight="bold">{dependents.length}</Text>
          <Text dimColor>  </Text>
          {dependentModules.slice(0, 5).map(m => (
            <Text key={`d:${m}`} color={colorOf(m)}>
              {m}{'  '}
            </Text>
          ))}
        </Text>
      )}
    </Text>,
  ]

  // ---- 意図
  const intentRow = (
    <Text key="intent" wrap="truncate-end">
      <Text color={NOW}>{isWorking && pulse ? '▶ ' : '▷ '}</Text>
      <Text dimColor>{f.intent ? fit(f.intent, W - 3) : isWorking ? '考え中…' : ' '}</Text>
    </Text>
  )

  // ---- 本文:ストリーミング中のコード、または直近の変更
  let heading: ReturnType<typeof Text>
  let body: ReturnType<typeof Box>
  let result: ReturnType<typeof Text>
  const notes: Array<{ text: string; color: string }> = []

  if (f.draft && f.draft.text.length > 0 && !isHistory) {
    const d = f.draft
    const isBash = d.tool === 'Bash'
    const rel = d.path ? relativize(f.root, f.workspaces, d.path) : isBash ? 'bash' : '…'
    const total = d.text.split('\n').length
    const lines = tailLines(d.text, bodyRows)
    heading = (
      <Text key="h" wrap="truncate-end">
        <Text color={NOW}>{isBash ? '$ ' : '▎ '}{fit(rel, Math.max(8, W - 34))}</Text>
        <Text color={NOW}> · {isBash ? 'コマンド' : d.tool === 'Write' ? '新規' : '置換'} ストリーミング中 {total} 行{pulse ? ' ▌' : '  '}</Text>
        {d.agentId ? <Text dimColor>  ↳ サブエージェント</Text> : null}
      </Text>
    )
    body = (
      <Box key="b" flexDirection="column" height={bodyRows} overflow="hidden" width={W}>
        {lines.map((line, i) => (
          <Text key={`l:${i}`} wrap="truncate-end">
            <Text dimColor>{String(total - lines.length + i + 1).padStart(4)} </Text>
            <Text dimColor={i < lines.length - 1}>{line}</Text>
          </Text>
        ))}
      </Box>
    )
    result = <Text key="r"> </Text>
  } else if (shown) {
    const c = shown
    const check = f.checks[c.id]
    if (c.tool === 'Bash') {
      const ok = c.exitCode === 0
      // 本文 = コマンド全文 → 空行 → 出力全文。先頭から表示し、スクロールで全部読める
      const commandLines = (c.command ?? c.path).split('\n').map(l => `$ ${l}`)
      const outputLines = (c.output ?? '').split('\n')
      const all = [...commandLines, ...(outputLines.length && outputLines[0] !== '' ? ['', ...outputLines] : [])]
      const start = Math.max(0, Math.min(f.codeScroll, Math.max(0, all.length - bodyRows)))
      const out = all.slice(start, start + bodyRows)
      const above = start
      const below = all.length - start - out.length
      const isCommandRow = (i: number) => start + i < commandLines.length
      heading = (
        <Text key="h" wrap="truncate-end">
          <Text color={ok ? OK : FAIL}>$ </Text>
          <Text>{fit(c.path, Math.max(8, W - 26))}</Text>
          <Text color={ok ? OK : FAIL}> {ok ? '✓' : `✗ ${c.exitCode}`}</Text>
          <Text dimColor> {clock(c.at)}</Text>
          {c.agentId ? <Text dimColor>  ↳ サブエージェント</Text> : null}
          {above > 0 || below > 0 ? <Text dimColor>  ↑{above} ↓{below}</Text> : null}
          {isHistory ? <Text color={NOW}>  履歴</Text> : null}
        </Text>
      )
      body = (
        <Box key="b" flexDirection="column" paddingLeft={1} height={bodyRows} overflow="hidden" width={W}>
          {out.map((l, i) =>
            isCommandRow(i) ? (
              <Text key={`o:${i}`} wrap="truncate-end">
                {l}
              </Text>
            ) : (
              <Text key={`o:${i}`} wrap="truncate-end" color={ok ? undefined : FAIL} dimColor={ok}>
                {l}
              </Text>
            ),
          )}
          {outputLines.length === 1 && outputLines[0] === '' && commandLines.length < bodyRows ? <Text dimColor>(出力なし)</Text> : null}
        </Box>
      )
      result = <Text key="r"> </Text>
    } else {
      const { plus, minus } = countLines(c.diff)
      // diff はスクロール可能:offset 行目から(@@ の 1 行を除いた)bodyRows − 1 行。見えていない行数は見出しに
      const win = windowHunk(c.diff, f.codeScroll, bodyRows - 1)
      heading = (
        <Text key="h" wrap="truncate-end">
          <Text color={layerColor(insideWorkspace(c.path, f.workspaces))}>▎ {fit(c.path, Math.max(8, W - 40))}</Text>
          {c.symbol ? <Text dimColor> · {c.symbol}</Text> : null}
          {c.kind ? <Text dimColor> ▌{KIND_LABEL[c.kind]}</Text> : null}
          {c.reverted ? <Text color={WARN}> リバート済み</Text> : <Text dimColor> {clock(c.at)}</Text>}
          {c.agentId ? <Text dimColor>  ↳ サブエージェント</Text> : null}
          {win.above > 0 || win.below > 0 ? <Text dimColor>  ↑{win.above} ↓{win.below}</Text> : null}
          {isHistory ? <Text color={NOW}>  履歴</Text> : null}
        </Text>
      )
      body = (
        <Box key="b" paddingLeft={1} width={W} height={bodyRows} overflow="hidden">
          <Code source={win.diff} format="diff" path={c.path} wrap="truncate-end" />
        </Box>
      )
      result = (
        <Text key="r" dimColor wrap="truncate-end">
          {'  └ '}
          <Text color={OK}>+{plus}</Text> <Text color={FAIL}>−{minus}</Text>
          {check ? (
            <Text>
              {'  '}
              {check.items.map(i => (
                <Text key={`c:${i.label}`} color={i.status === 'ok' ? OK : i.status === 'fail' ? FAIL : undefined} dimColor={i.status !== 'ok' && i.status !== 'fail'}>
                  {STATUS_MARK[i.status]} {i.label}
                  {i.status !== 'running' && i.ms > 0 ? <Text dimColor> {(i.ms / 1000).toFixed(1)}s</Text> : null}
                  {'  '}
                </Text>
              ))}
            </Text>
          ) : null}
        </Text>
      )
      for (const i of check?.items ?? []) if (i.status === 'fail') for (const line of i.detail.slice(0, 2)) notes.push({ text: line, color: FAIL })
    }
  } else {
    heading = <Text key="h" dimColor>まだ変更はありません。AI が Edit / Write / Bash すると、ここにコードがストリーミングされます。</Text>
    body = <Box key="b" height={bodyRows} />
    result = <Text key="r"> </Text>
  }

  // ---- 履歴:1 件 1 行。今本文に映している変更の行を ▸ で強調する。行を押すとその変更の画面に飛び、もう一度押すと最新へ
  const history = Array.from({ length: historyRows }, (_, i) => list[i] ?? null).map((c: Change | null, slot) => {
    if (!c) return <Text key={`e:${slot}`}> </Text>
    const isShown = shown?.id === c.id
    const toolLabel = c.tool.padEnd(5) // 時刻の次にツール名(Edit / Write / Bash)
    const onPress = () => actions.select(isShown ? null : c.id)
    if (c.tool === 'Bash') {
      const ok = c.exitCode === 0
      return (
        <Button key={`h:${c.id}`} plain onPress={onPress}>
          <Text color={isShown ? NOW : ok ? OK : FAIL}>{isShown ? '▸' : ok ? '✓' : '✗'} </Text>
          <Text dimColor={!isShown}>{clock(c.at)} {toolLabel} {c.agentId ? '↳ ' : ''}$ </Text>
          <Text weight={isShown ? 'bold' : 'regular'}>{fit(c.path, Math.max(12, W - 18))}</Text>
        </Button>
      )
    }
    const ck = f.checks[c.id]
    const mark = ck ? (ck.items.some(i => i.status === 'fail') ? '✗' : ck.items.some(i => i.status === 'running') ? '⏳' : '✓') : ' '
    const n = countLines(c.diff)
    return (
      <Button key={`h:${c.id}`} plain onPress={onPress}>
        <Text color={isShown ? NOW : mark === '✗' ? FAIL : mark === '✓' ? OK : undefined} dimColor={!isShown && mark !== '✗' && mark !== '✓'}>
          {isShown ? '▸' : mark}{' '}
        </Text>
        <Text dimColor={!isShown}>{clock(c.at)} {toolLabel} {c.agentId ? '↳ ' : ''}</Text>
        <Text color={layerColor(insideWorkspace(c.path, f.workspaces))} weight={isShown ? 'bold' : 'regular'} dimColor={Boolean(c.reverted)}>
          {fit(c.path, Math.max(12, W - 28 - (c.symbol ? c.symbol.length + 3 : 0)))}
        </Text>
        {c.symbol ? <Text dimColor={!isShown}> · {c.symbol}</Text> : null}
        <Text dimColor> +{n.plus} −{n.minus}</Text>
        {c.reverted ? <Text color={WARN}> ↶</Text> : null}
      </Button>
    )
  })

  return (
    <Box flexDirection="column" width={W + RIGHT_PAD} paddingRight={RIGHT_PAD}>
      {deps}
      <Text dimColor>{'─'.repeat(W)}</Text>
      {intentRow}
      {heading}
      {body}
      {result}
      {[0, 1].map(n => (
        <Text key={`n:${n}`} color={notes[n]?.color} wrap="truncate-end">
          {notes[n] ? `    ${notes[n]!.text}` : ' '}
        </Text>
      ))}
      <Text dimColor>{'┄'.repeat(W)}</Text>
      {history}
      <Text dimColor>{'─'.repeat(W)}</Text>
      <Box flexDirection="row" gap={1}>
        {shown ? <Button key="open" plain hotkey="o" label="開く" onPress={() => actions.open(shown)} /> : <Text dimColor>o: 開く</Text>}
        {hasRevertable ? <Button key="revert" plain hotkey="r" label="リバート" onPress={() => actions.revert()} /> : <Text dimColor>r: リバート</Text>}
        <Button key="down" plain hotkey="j" label="↓" onPress={() => actions.scroll(3)} />
        <Button key="up" plain hotkey="k" label="↑" onPress={() => actions.scroll(-3)} />
        {isHistory ? <Button key="latest" plain hotkey="l" label="最新へ" onPress={() => actions.select(null)} /> : null}
      </Box>
      {/* 木を窓より高くして、ホイールが「スクロール」として届くようにする(窓自体は ui.scroll のフックで止め、本文だけ動かす)。
          中身は窓 − 1 行なので、空行 2 つで窓 + 1 行になる */}
      <Text> </Text>
      <Text> </Text>
    </Box>
  )
}
