# claude-coding-driver

AI 駆動開発を自分で運転する(drive)ための Claude Code の mod。

| mod | 何をするか |
|---|---|
| [drive](./drive) | 右に 1 枚のペイン。AI が書いている最中のコードが流れ、編集した瞬間にそのファイルの imports / dependents と型チェック・テストの結果が見え、`o` で VS Code に、`r` でリバート。左の transcript は素のまま |

## インストール

Claude Code のプロンプトで:

```
/plugin install drive --marketplace rintaroyamaoka/claude-coding-driver
```

シェルから:

```
claude plugin install drive --marketplace rintaroyamaoka/claude-coding-driver
```

`Add marketplace?` に `y`、scope は user を選ぶ。

## 開発

```
claude --plugin-dir ./drive         # そのセッションだけ読み込む(保存で再読み込み)
claude plugin validate ./drive      # manifest と hooks module の検証
```
