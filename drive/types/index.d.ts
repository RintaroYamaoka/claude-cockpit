// drive の状態契約。$.state に置く値はすべてここで宣言する。

/** root の外で触られ、依存グラフに加えた場所(別リポジトリ・worktree)。 */
export type Workspace = { dir: string; label: string }

/** 構造に影響する変更の種類。 */
export type StructureKind = 'schema' | 'deps' | 'route' | 'env' | 'config' | 'new'

/** 適用された 1 回の変更。リバートに必要な前後のテキストを持つ。Bash はコマンドの記録。 */
export type Change = {
  id: string // tool_use_id
  path: string // ツリー内のパス(Bash はコマンドの要約)
  file: string // 絶対パス(Bash は cwd)
  symbol: string | null // 変更位置に最も近い宣言名
  diff: string // unified diff のハンク
  at: number
  kind: StructureKind | null
  before: string | null // Write の新規作成は null
  after: string | null
  isNew: boolean
  tool: 'Edit' | 'Write' | 'Bash'
  agentId?: string // サブエージェントの変更なら、そのエージェントの id
  reverted?: true
  exitCode?: number
  command?: string // Bash のコマンド全文
  output?: string // Bash の出力全文(stdout + stderr)
}

/** ストリーミング中のツール入力から組んだ、まだ適用されていないコード(Bash はコマンド)。 */
export type Draft = { id: string; tool: string; path: string | null; text: string; startedAt: number; agentId?: string }

export type CheckStatus = 'running' | 'ok' | 'fail' | 'skip'
export type CheckItem = { label: string; status: CheckStatus; detail: string[]; ms: number }
export type Check = { at: number; items: CheckItem[] }

/** 依存グラフの 1 ファイル分。imports は repo 内の相対パス、packages はパッケージ名。 */
export type DepNode = { rel: string; imports: string[]; packages: string[]; exports: string[] }

declare module 'claude-code' {
  interface PluginState {
    drive: {
      root: string
      workspaces: Shaped<Workspace[]>
      files: string[] // 依存解析の対象(ツリー内の相対パス)
      focus: string | null // 今触っているファイル
      changes: Shaped<Change[]>
      intent: string
      draft: Shaped<Draft | null>
      checks: Shaped<Record<string, Check>>
      turnId: string | null
      deps: Shaped<Record<string, DepNode>>
      addedEdges: Shaped<Record<string, number>>
      depsDone: boolean
      tick: number
      selected: string | null // 履歴で選んだ変更(id)。null なら最新を映す
      codeScroll: number // 本文(diff / 出力)の先頭から何行スクロールしたか
      historyScroll: number // 履歴の先頭から何件スクロールしたか
    }
  }
}
