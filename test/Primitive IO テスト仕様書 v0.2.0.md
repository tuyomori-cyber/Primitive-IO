# Primitive IO — テスト仕様書

- テストバージョン: v0.2.0
- 作成日: 2026-09-23
- 対象: Firefox / ChatGPT Web / Dropbox / GitHub.com
- 状態: GitHub Explorer UI 実装済み、GitHub 接続・API 層（Todo 8）未実装

## 1. 目的と品質基準

v0.2.0 は既存 Dropbox Explorer を維持し、GitHub Explorer からリポジトリ内のファイルを選択して、`repository/ref/path` を含むプロンプトを ChatGPT へ投入する機能を追加する。

拡張の責務は GitHub のリポジトリ・Git tree メタデータを表示し、選択情報をプロンプトへ変換することに限る。GitHub ファイル本文の取得、保存、プレビュー、GitHub への書き込み、ChatGPT の回答内容による成功判定はテスト対象外とする。

合格の最低条件は次である。

- Dropbox の既存機能を回帰させない。
- fine-grained PAT、Authorization header、ファイル本文を content script や ChatGPT DOM へ渡さない。
- GitHub Explorer が許可済みリポジトリだけをメタデータで表示し、通常ファイルを 1〜5 件選択できる。
- 生成プロンプトに正確な `repository`、`ref`、`path` を含め、既存下書きを上書きしない。
- GitHub API の認証・権限・rate limit・不完全 tree・ネットワーク失敗を区別して安全に扱う。

## 2. テスト範囲

| 区分 | 対象 | 実施時期 |
| --- | --- | --- |
| 静的検証 | TypeScript 型チェック、ビルド、XPI 内容 | 各変更時 |
| 単体テスト | `githubAuth`、`githubClient`、GitHub Explorer UI の分岐 | Todo 8 実装時 |
| 手動結合テスト | Firefox、GitHub API、ChatGPT Web、設定画面 | Todo 8 完了後 |
| セキュリティ・プライバシー確認 | token/本文非流出、権限、保存・削除 | Todo 8 完了後 |
| Dropbox 回帰 | Dropbox OAuth、ツリー、プロンプト、自動送信 | v0.2.0 配布前 |

GitHub 接続・API 層が未実装の現在は、静的検証と GitHub Explorer の未接続 UI だけが実行可能である。PAT を必要とするケースをモックで通過させたり、未実装の runtime message を成功扱いにしたりしない。

## 3. テスト環境と準備

### 3.1 共通環境

- Firefox Desktop 140 以降
- ChatGPT Web: `https://chatgpt.com/`。必要に応じ `https://chat.openai.com/` も確認する
- v0.2.0 のビルド済み `dist/manifest.json` を一時アドオンとして読み込む、または署名済み XPI を導入する
- 開発者ツールの Console と Network を開ける状態にする。ただし PAT 値・Authorization header を記録やスクリーンショットへ残さない

### 3.2 GitHub テストデータ（Todo 8 完了後）

テスト専用 GitHub アカウントまたはテスト専用リポジトリを使う。実運用の秘密情報を含むリポジトリや PAT は使わない。

- public repository: 通常ファイル、深い階層、空フォルダ相当、空白・日本語・`#`・`?`・`%` を含むパスを準備する
- private repository: fine-grained PAT と ChatGPT GitHub App の双方に読み取り権限を与える
- collaborator repository: テストアカウントを collaborator として追加する
- organization repository: テストアカウントを組織メンバーまたは team member とし、組織ポリシーを確認する
- Git tree fixture: symlink（mode `120000`）、submodule（mode `160000`）、実行可能ファイル（mode `100755`）を含める
- PAT: resource owner とリポジトリを限定し、`Metadata: read` と `Contents: read` だけを与え、有効期限を設定する

`truncated: true` は通常の小規模リポジトリで再現しにくいため、fetch モックまたはテスト用 background 実装で応答を注入して確認する。大規模リポジトリで実際に発生した場合も同じ期待結果とする。

## 4. 実行手順と記録

各テストケースについて ID、実施日、Firefox バージョン、結果（Pass / Fail / Blocked）、証跡（PAT を含まない画面・ログ）、不具合番号を記録する。

`Blocked` は外部条件または未実装により実施不能な状態であり、`Pass` ではない。現在の Todo 8 依存ケースは `Blocked` と記録する。

### 判定欄の記入方法

- `[ ]` — 未実施または未判定
- `[OK]` — 期待結果を満たした
- `[NG]` — 期待結果を満たさなかった。証跡と不具合番号を併記する

テスト実行時は、各テスト表の ID 横にある `[ ]` を `[OK]` または `[NG]` に置き換える。Todo 8 の未実装が原因で実施できないケースは、`[ ] Blocked（Todo 8）` と追記する。

## 5. 静的・パッケージ検証

| ID / 判定 | 手順 | 期待結果 | 現在の状態 |
| --- | --- | --- | --- |
| V-01 [OK] | `npm run check` を実行する | TypeScript エラーなし | Pass（2026-09-23） |
| V-02 [OK] | `npm run build` を実行する | `dist/background.js`、`content.js`、`options.js`、manifest、options HTML が生成される | Pass（2026-09-23） |
| V-03 [OK] | `npm run package` と `unzip -t dist/primitive-io-0.2.0.xpi` を実行する | XPI にエラーがなく、必要な配布物を含む | Pass（2026-09-23） |
| V-04 [OK] | `src/manifest.json` と `dist/manifest.json` を確認する | 両方の version が `0.2.0` | Pass（2026-09-23） |
| V-05 [ ] Blocked（Todo 8） | manifest の host permission を確認する | Todo 8 完了時に `https://api.github.com/*` が追加され、不要な GitHub host permission がない | Blocked（Todo 8） |
| V-06 [OK] | `git diff --check` を実行する | 空白エラーなし | Pass（2026-09-23） |

## 6. GitHub 接続・設定画面テスト

| ID / 判定 | 条件・手順 | 期待結果 |
| --- | --- | --- |
| GA-01 [ ] | 未接続で ChatGPT を開き、GitHub を選択する | 未接続メッセージとヘッダーの `⚙` 設定ボタンを表示し、PAT 入力欄はパネルに存在しない |
| GA-02 [ ] | GitHub を選択してヘッダーの `⚙` 設定ボタンを押す | Dropbox 選択時と同じ拡張の設定画面が開く |
| GA-03 [ ] | 空白だけの PAT で接続する | 保存せず、入力エラーを表示する |
| GA-04 [ ] | 有効な限定 PAT で接続する | `GET /user` 成功後にだけ token を保存し、GitHub login を表示する |
| GA-05 [ ] | 無効・期限切れ PAT で接続する | token を保存せず、認証失敗を表示する |
| GA-06 [ ] | `Contents: read` を与えずに接続し、リポジトリを開く | 接続自体は検証可能なら維持し、ツリー取得時に権限不足を表示する |
| GA-07 [ ] | 組織 PAT が承認待ちまたはポリシーで拒否された状態で一覧を取得する | 組織の PAT 設定・承認を確認する案内を表示し、他の閲覧可能リポジトリを誤って表示しない |
| GA-08 [ ] | 接続後に Firefox を再起動して拡張を再読み込みする | 接続状態と login を復元する。PAT の入力値は設定画面に再表示しない |
| GA-09 [ ] | 接続解除する | `githubTokens` と GitHub アカウント情報だけを local storage から削除する。Dropbox 接続を維持し、GitHub 側 PAT は失効しない旨を表示する |
| GA-10 [ ] | token 設定後に Console、content script message、ChatGPT DOM を確認する | PAT 値と Authorization header が出力・注入されない |

GA-01 は Todo 8 前でも実施する。GA-03〜GA-10 は Todo 8 完了後に実施する。

## 7. GitHub REST API・メタデータテスト

| ID / 判定 | 条件・手順 | 期待結果 |
| --- | --- | --- |
| GC-01 [ ] | API リクエストを検査する | `Accept`、Authorization、API version、`User-Agent` を送る。書き込み HTTP method を使わない |
| GC-02 [ ] | `GET /user/repos` を 101 件以上返すモックまたはテストアカウントで取得する | `per_page=100` と Link header を使って全ページを統合し、重複なく表示する |
| GC-03 [ ] | owner、collaborator、organization member の各リポジトリを用意する | `affiliation=owner,collaborator,organization_member` により、PAT が許可する各リポジトリを表示する |
| GC-04 [ ] | private/public を含む一覧を取得する | `owner/name`、private/public、既定ブランチを正しく正規化する |
| GC-05 [ ] | 既定ブランチの root tree を取得する | `recursive` を付けず、Git tree のメタデータだけを取得する |
| GC-06 [ ] | 子フォルダを展開する | 親 tree の SHA を使う非再帰リクエストを 1 回発行し、当該フォルダの直下だけを返す |
| GC-07 [ ] | `blob` mode `100644` / `100755`、`tree`、symlink、submodule を含む tree を返す | 通常 blob は `file`、tree は `dir`、symlink / submodule は選択不可として正規化する |
| GC-08 [ ] | tree response の `truncated: true` を注入する | `DIRECTORY_TOO_LARGE` を返し、entries を UI・キャッシュへ渡さない |
| GC-09 [ ] | `401`、`403`、`404`、`429`、ネットワーク失敗を注入する | `AUTH_INVALID`、`FORBIDDEN`、`NOT_FOUND`、`RATE_LIMITED`、`NETWORK_FAILURE` を区別する |
| GC-10 [ ] | 429 または remaining 0 と reset header を返す | 再試行可能時刻を表示し、その時刻まで自動再試行しない。`Retry-After` があれば優先する |
| GC-11 [ ] | 同一 tree を同時に展開する | API リクエストは 1 回に集約され、完了後に同じ結果を返す |
| GC-12 [ ] | 成功済み tree を閉じて再展開する | 当該ページのメモリキャッシュを使用する。更新操作後はキャッシュを捨てて再取得する |
| GC-13 [ ] | 日本語、空白、`#`、`?`、`%`、`/` を含む owner/repo/ref/path の fixture を使う | owner/repo/tree-ish を path segment として正しくエンコードする。表示・プロンプトは API 応答の path をそのまま使う |
| GC-14 [ ] | Network の response と storage を確認する | file content、Base64、download URL、GitHub Code Search の結果を取得・保存しない |

## 8. GitHub Explorer UI・操作テスト

| ID / 判定 | 条件・手順 | 期待結果 |
| --- | --- | --- |
| GU-01 [OK] | ChatGPT を開く | Cloud Explorer パネルは1つだけ表示される。ヘッダーのクライアント名を選ぶと Dropbox / GitHub のドロップダウンが開き、選択中クライアントだけを表示する |
| GU-02 [OK] | 未接続状態でドロップダウンから GitHub を選ぶ | 未接続の理由と設定画面への導線を表示し、読み込みボタンを無効にする |
| GU-03 [ ] | 接続済みでリポジトリ一覧を開く | login、リポジトリ名、private/public、既定ブランチを表示する |
| GU-04 [ ] | リポジトリを選ぶ | root tree を表示し、リポジトリ切替時に以前の tree・展開状態・選択を解除する |
| GU-05 [ ] | 深い階層を展開・折りたたむ | 直下だけを遅延表示し、折りたたみ後も同一ページでは取得済みの tree を再利用する |
| GU-06 [ ] | 空リポジトリと空フォルダを開く | 空であることを区別して表示する |
| GU-07 [ ] | file、symlink、submodule を表示する | file だけがチェック可能で、symlink/submodule はグレー表示・選択不可である |
| GU-08 [ ] | 1 件、5 件、6 件目を選択する | 1〜5 件では選択を保持し、6 件目は拒否して上限メッセージを表示する |
| GU-09 [ ] | 選択済みでリポジトリを変更、一覧へ戻る、更新する、ページを再読込する | それぞれ選択を解除する |
| GU-10 [ ] | 同名ファイルを異なるフォルダに置く | path で区別して選択・プロンプト生成できる |
| GU-11 [ ] | API エラー、`DIRECTORY_TOO_LARGE`、ネットワーク断を発生させる | エラーを notice に表示し、不完全な一覧を通常表示しない。ネットワーク断だけでは成功済みキャッシュを消さない |
| GU-12 [ ] | 狭い画面幅で Cloud Explorer を開き、Dropbox / GitHub を切り替える | ChatGPT 入力欄やパネル操作を妨げず、パネルが画面外へ出ない。二つのクライアント内容が同時表示または重なった場合は不具合として記録する |
| GU-13 [ ] | Dropbox / GitHub を切り替え、各クライアントでファイルを選択・フォルダを展開する | 切替後も同一ページ内では各クライアント固有の選択・展開・取得済みツリーを保持する。選択件数、更新、読み込み、notice は選択中クライアントだけに作用する |

## 9. プロンプト・ChatGPT 操作テスト

| ID / 判定 | 条件・手順 | 期待結果 |
| --- | --- | --- |
| GP-01 [ ] | GitHub ファイルを 1 件選択して「読み込み」を押す | 次のヘッダーと、選択した `repository`、既定 `ref`、repository root 相対 `path` を含むプロンプトを投入する |
| GP-02 [ ] | 同一リポジトリで複数ファイルを選ぶ | 選択順の全項目を 1 プロンプトに含める |
| GP-03 [ ] | 日本語・空白・記号を含む path を選ぶ | path を改変・URL エンコードせずにプロンプトへ表示する |
| GP-04 [ ] | ChatGPT 入力欄に既存下書きを置く | 下書きを変更せず、中止理由を表示する |
| GP-05 [ ] | 入力欄未検出・編集不可にする | ChatGPT DOM 操作の失敗理由を表示し、送信しない |
| GP-06 [ ] | auto-send OFF で読み込む | プロンプトを投入するだけで、送信ボタンを押さない |
| GP-07 [ ] | auto-send ON で読み込む | プロンプト投入後にだけ送信を試行する。送信ボタン未検出・無効を区別する |
| GP-08 [ ] | Dropbox と GitHub を切り替えてそれぞれ選択し、読み込む | 選択中クライアントのサービス専用プロンプトを作り、同一プロンプトに混在させない |
| GP-09 [ ] | ChatGPT 側 GitHub App に同一リポジトリを許可してから送信する | ChatGPT が対象ファイルを参照できることを確認する。拡張は回答から成功判定しない |
| GP-10 [ ] | 既定ブランチ以外が必要な fixture を使う | v0.2.0 は既定ブランチを ref として投入する。ChatGPT が ref を厳密に解釈することは保証外として、実際の挙動を記録する |

GP-01 の期待プロンプト例:

```text
GitHub 連携を使って、次のリポジトリ内ファイルを読み込み、この会話で参照できる状態にしてください。
各項目は owner/repository、ref、リポジトリ root からのパスです。

- repository: octo-org/primitive-io
  ref: main
  path: src/content/githubExplorer.ts
```

## 10. Dropbox 回帰テスト

v0.2.0 では Dropbox の認証、API、プロンプト形式を変更しない。単一 Cloud Explorer への UI 統合や共通 auto-send が Dropbox を壊していないことを確認する。

| ID / 判定 | 手順 | 期待結果 |
| --- | --- | --- |
| DR-01 [ ] | Dropbox 未接続・接続・接続解除・再起動後復元を確認する | v0.1.2 と同じ動作を維持する |
| DR-02 [ ] | root、深い階層、空フォルダを展開する | 直下の遅延取得、折りたたみ、更新が動作する |
| DR-03 [ ] | `.md` / `.txt`、非対応拡張子、日本語・空白・記号を含む path、同名ファイルを確認する | 対応ファイルだけを選択可能にし、完全 path をプロンプトへ入れる |
| DR-04 [ ] | 1 件・5 件選択、6 件目拒否、更新・再読込時の選択解除を確認する | v0.1.2 の選択仕様を維持する |
| DR-05 [ ] | Dropbox prompt、下書き保護、auto-send ON/OFF、送信失敗を確認する | GitHub UI 追加後も既存動作を維持する |
| DR-06 [ ] | Dropbox API の 401、429、ネットワーク失敗から更新で回復する | 適切なエラー表示と root 一覧への復帰を維持する |
| DR-07 [ ] | 単一パネルで GitHub と Dropbox を切り替え、閉じて再度開く | runtime message、storage key、画面位置が相互に干渉しない。各クライアントの選択状態は切替・開閉では維持される |
| DR-08 [ ] | Dropbox を選択してヘッダーの設定ボタンを押す | `about:addons` の Primitive IO「設定」と同じ拡張の設定画面が開く。失敗時はパネル内に理由を表示する |

## 11. 受け入れ判定

以下をすべて満たしたとき v0.2.0 を GitHub 対応版として受け入れる。

- V-01〜V-06 が Pass。
- GA、GC、GU、GP の全必須ケースが Pass。外部サービス都合で Blocked のケースは、原因・回避方法・再試験予定を記録し、リリース可否を別途判断する。
- DR-01〜DR-07 が Pass。
- GitHub API に本文取得・書き込みリクエストがなく、PAT が content script・ChatGPT DOM・ログへ出ないことを確認する。
- README、CHANGELOG、設定画面、Firefox データ利用申告が実装済みの機能と一致する。

## 12. 現在の実施状況

各テストケースの最新判定は、該当するテスト表の ID 横に記入する。v0.2.0 では Todo 8 が未実装の間、GitHub API を前提とする項目を `[ ] Blocked（Todo 8）` と記録する。GitHub Explorer UI だけを根拠に GitHub 対応を完了とは判定しない。
