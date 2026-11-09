# claude-cockpit

AI に書かせても、自分で書いている感覚のままでいる。Claude Code の mod。

AI がコードを書く速さに、人の把握が追いつかなくなった。今どこを触っていて、何が変わり、何に効き、壊れていないか。
それが分からないまま進むと、自分のコードではなくなっていく。
cockpit は、その把握を transcript から目を離さずに取り戻すための計器盤を右に 1 枚足す。見るだけでなく、その場で開いて、戻せる。左の Claude Code は素のまま。

https://github.com/user-attachments/assets/b6df1973-bef3-47d1-9bb4-a464dfe8626d


計器は 4 つ(流れるコードと本当の差分・そのファイルの依存・編集直後のチェック・履歴)、操作は 2 つ(`o` で VS Code、`r` でリバート)。設定は無い。
画面の読み方・仕組み・制約は [cockpit/README.md](./cockpit/README.md)。

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
