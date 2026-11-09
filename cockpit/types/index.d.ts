// cockpit の状態契約。$.state に置く値はすべてここで宣言する。

/** root の外で触られ、依存グラフに加えた場所(別リポジトリ・worktree)。 */
export type Workspace = { dir: string; label: string }

/** 構造に影響する変更の種類。 */
export type StructureKind = 'schema' | 'deps' | 'route' | 'env' | 'config' | 'new'

export type ChangeBase = {
  id: string // tool_use_id(ヒアドキュメント由来は `<tool_use_id>-<path>`)
  at: number
  agentId?: string // サブエージェントの変更なら、そのエージェントの id
}

/** 適用された 1 回の Edit / Write。リバートに必要な前後のテキストを持つ。 */
export type FileChange = ChangeBase & {
  tool: 'Edit' | 'Write'
  path: string // ツリー内のパス
  file: string // 絶対パス
  symbol: string | null // 変更位置に最も近い宣言名
  diff: string // unified diff のハンク 1 つ(文脈行つき)
  plus: number // 追加行数(diff を数え直さない)
  minus: number // 削除行数
  kind: StructureKind | null
  before: string | null // Edit は old_string、Write はファイル全体。大きすぎて持てなければ null
  after: string | null // Edit は new_string、Write はファイル全体
  isNew: boolean // Write で新しく作った(リバートは削除)
  replaceAll?: true // Edit の replace_all(リバートも全置換)
  reverted?: true
}

/** 実行した 1 回の Bash。 */
export type CommandChange = ChangeBase & {
  tool: 'Bash'
  summary: string // 先頭のコマンドを短く(履歴と見出し)
  command: string // コマンド全文
  cwd: string
  exitCode: number
  output: string // stdout + stderr(末尾 2000 行まで)
}

export type Change = FileChange | CommandChange

/** ストリーミング中のツール入力から組んだ、まだ適用されていないコード(Bash はコマンド)。 */
export type Draft = { id: string; tool: 'Edit' | 'Write' | 'Bash'; path: string | null; text: string; startedAt: number; agentId?: string }

export type CheckStatus = 'running' | 'ok' | 'fail' | 'skip'
export type CheckItem = { label: string; status: CheckStatus; detail: string[]; ms: number }
export type Check = { at: number; items: CheckItem[] }

/** 依存グラフの 1 ファイル分。imports は repo 内の相対パス、packages はパッケージ名。 */
export type DepNode = { rel: string; imports: string[]; packages: string[]; exports: string[] }

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
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
