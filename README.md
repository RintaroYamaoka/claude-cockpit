# claude-cockpit

AI に書かせても、自分で書いている感覚のままでいる。Claude Code の mod。

AI がコードを書く速さに、人の把握が追いつかなくなった。今どこを触っていて、何が変わり、何に効き、壊れていないか。
それが分からないまま進むと、自分のコードではなくなっていく。
cockpit は、その把握を transcript から目を離さずに取り戻すための計器盤を右に 1 枚足す。見るだけでなく、その場で開いて、戻せる。左の Claude Code は素のまま。

[解説動画(5 分・日本語ナレーション・英語字幕)](media/cockpit-intro.mp4) ― 1 つの作業を追いながら、画面の要素を出てきた順に全部説明する。

| mod | 何をするか |
|---|---|
| [cockpit](./cockpit) | 書かれている最中のコードが流れる。確定したら本当の差分(変わった行と前後だけ)。そのファイルの imports / dependents と、このセッションで増えた依存。編集直後の型チェック・テストの結果。履歴をさかのぼって、その時の画面に戻る。`o` で VS Code の該当行へ、`r` でリバート |

## インストール

Claude Code のプロンプトで:

```
/plugin install cockpit --marketplace rintaroyamaoka/claude-cockpit
```

シェルから:

```
claude plugin install cockpit --marketplace rintaroyamaoka/claude-cockpit
```

`Add marketplace?` に `y`、scope は user を選ぶ。

## 開発

```
claude --plugin-dir ./cockpit        # そのセッションだけ読み込む(保存で再読み込み)
claude plugin validate ./cockpit     # manifest と hooks module の検証
claude plugin test ./cockpit         # 純粋なロジックの単体テスト
npm run typecheck                    # tsc --noEmit(npx で typescript を取る。npm の依存は持たない)
```
