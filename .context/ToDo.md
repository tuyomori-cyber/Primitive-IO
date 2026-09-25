# Primitive IO — 実装Todo

最終更新: 2026-09-24

## 実装方針

- Firefox専用のManifest V3 WebExtensionとして実装する。
- Chrome／Chromium互換レイヤーは作らず、Firefoxの `browser` APIを前提にする。
- ページUIとChatGPT DOM操作はcontent script、Dropbox OAuth・トークン管理・Dropbox API通信はFirefoxのbackground scriptに分離する。FirefoxではManifest V3の`background.service_worker`を使わない。
- content scriptとbackground処理はメッセージ経由だけで通信する。Dropboxのアクセストークン／リフレッシュトークンをcontent scriptやChatGPTページへ渡さない。
- Dropboxツリーは再帰取得しない。root表示時とフォルダ展開時に、その直下だけを取得する。
- GitHub対応ではファイル本文を取得せず、リポジトリ・Git treeのメタデータだけをbackground scriptから取得する。ChatGPT側のGitHub接続へ本文取得を委ねる。
- GitHub認証は、対象リポジトリを限定したfine-grained PATをユーザーが設定画面で登録する方式とする。OAuth App、Device Flow、GitHub App、独自バックエンドはv0.2.0で扱わない。
- 最初は「プロンプト投入のみ」を完成させる。自動送信は設定画面と確認送信が安定してから追加する。

## 実装順序

### 0. 開発基盤を決定・作成する

- [x] TypeScriptを使うか、素のJavaScriptで開始するか決める（TypeScript + esbuild）
- [x] ビルド方法とローカルFirefoxでの一時インストール手順を決める
  - `npm install`
  - `npm run check`
  - `npm run build`
  - Firefoxで `about:debugging#/runtime/this-firefox` を開き、「一時的なアドオンを読み込む」から **`dist/manifest.json`** を選択する（`src/manifest.json` はビルド元であり、選択しない）
  - `npm test`（GitHubの自動テスト）
- [x] `manifest.json`、background処理、content script、設定画面の最小構成を作る
- [x] 権限を最小化する
  - `identity`
  - `storage`
  - `scripting`（Firefoxでcontent scriptを明示注入するため）
  - ChatGPT Webのhost permission
  - Dropbox APIのhost permission
- [x] Firefoxで一時インストールし、ChatGPTページへcontent scriptが読み込まれることを確認する（開発用パネル表示確認済み、2026-09-21）

完了条件: ChatGPT Webを開いた時に、開発用の小さな拡張UIを表示できる。

### 1. ChatGPT DOMアダプタを先行検証する

- [x] `chatgptAdapter` を作る
  - 入力欄の検出
  - 入力欄への文字列投入
  - 送信ボタンの検出
  - 必要なDOM操作をこのモジュール以外へ漏らさない
- [x] React等のChatGPT実装でも入力変更が認識されるよう、実機で投入を確認する（2026-09-21）
- [x] 入力欄がない、既存下書きがある、編集不可の場合に失敗を返す
- [x] 初期段階では送信操作を実装しない

完了条件: テスト文字列をChatGPT入力欄へ投入でき、ユーザーが通常どおり送信できる。

### 2. Dropboxアプリ登録とOAuthを実装する

- [x] Dropbox Developer Consoleでアプリを作成する（Full Dropbox、`files.metadata.read`、`account_info.read`、OAuthリダイレクトURL登録済み）
  - アクセス種別: Full Dropbox
  - scope: `files.metadata.read`、`account_info.read`
  - `files.content.read` と書き込み権限は要求しない
  - Firefox拡張のOAuthリダイレクトURLを登録する
- [x] Firefox `identity` APIを使い、Authorization Code + PKCE を実装する（実機認証確認済み、2026-09-21）
- [x] PKCEのverifier/challenge生成、state検証、認可コード交換をbackground処理に実装する
- [x] `token_access_type=offline` を指定し、リフレッシュトークンで短命アクセストークンを更新する
- [x] 認証情報を拡張ローカル保存領域へ保存する
- [x] 「接続」「接続解除」「接続中アカウント表示」を実装する
- [x] 接続解除時はDropboxのトークン失効を試行し、成功・失敗を問わずローカルの認証情報を削除する

完了条件: 開発中の一時アドオンでは、接続状態を復元でき、接続中のDropboxアカウントをUIに表示できる（Firefox再起動後に一時アドオンを再追加して確認済み、2026-09-21）。Firefox再起動後の恒久インストール用XPIでの復元は、配布方式を整備した後に改めて確認する。

### 3. Dropboxメタデータ取得層を実装する

- [x] `dropboxClient` をbackground処理に作る（root取得の実機確認済み、2026-09-21）
- [x] rootの直下一覧を取得する（実機確認済み、2026-09-21）
- [x] 指定フォルダの直下一覧を取得する（実機確認済み、2026-09-21）
- [x] Dropbox APIのページング（`has_more` / `cursor`）を扱う
- [x] 同一フォルダへの同時リクエストを防ぐ
- [x] API失敗、認証切れ、ネットワーク失敗をUI向けのエラー種別へ変換する
- [x] 内部状態はDropboxのファイルIDを主に使い、表示・プロンプトには表示用パスを使う（実装・型チェック済み、実機確認は配布テスト時に実施）

完了条件: rootと任意の展開済みフォルダについて、直下のファイル名・フォルダ名・パスを取得できる。ファイル本文取得APIは呼ばない。

### 4. Dropbox Explorer UIを実装する

- [x] ChatGPTページ内に開閉可能なパネルを表示する（実機表示確認済み、2026-09-21）
- [x] 未認証、認証中、取得中、エラー、空フォルダを表示する
- [x] root表示とフォルダの展開・折りたたみを実装する（展開の実機確認済み、2026-09-21）
- [x] 展開時にだけ直下を取得し、取得済みフォルダはそのページ表示中だけキャッシュする
- [x] `.md` と `.txt` は選択可能、その他のファイルはグレー表示・選択不可にする（グレー表示の実機確認済み。選択UIは次フェーズ）
- [x] 狭い画面でもChatGPT本体を過度に覆わないパネル幅・開閉UIを調整する

完了条件: Dropboxのrootから複数階層を展開でき、対応／非対応ファイルを視覚的に区別できる。

### 5. 選択状態とプロンプト生成を実装する

- [x] 対応ファイルの選択、複数選択、選択解除を実装する（実機確認済み、2026-09-21）
- [x] 選択上限を5件に制限し、超過時は理由を表示する（実機確認済み、2026-09-21）
- [x] 選択状態はページ表示中だけ保持し、再読込・ページ遷移で解除する
- [x] 1件以上選択時だけ「読み込み」ボタンを有効化する（実機確認済み、2026-09-21）
- [x] 選択パスから定型プロンプトを生成する（実機確認済み、2026-09-21）
- [ ] パスに日本語、空白、記号が含まれるケースを確認する
- [x] 「読み込み」で`chatgptAdapter`へプロンプトを渡し、入力欄へ投入する（実機確認済み、2026-09-21）

完了条件: `.md` / `.txt` を1〜5件選択して、全パスを含むプロンプトをChatGPT入力欄へ投入できる。

### 6. 自動送信を任意機能として追加する

- [x] 設定画面に「自動送信」トグルを追加し、既定値をオフにする（実機確認は未実施）
- [x] オフ時はプロンプト投入だけを行う（実機確認済み）
- [x] オン時のみ、投入後に送信ボタン操作を行う（実機確認は未実施）
- [x] 送信ボタン未検出、送信不可、送信失敗を区別して表示する
- [x] 自動送信は「読み込み」ボタンをユーザーが押した場合にだけ実行する

完了条件: 既定では確認送信、明示設定時のみ自動送信となり、意図しない送信が起きない。

### 7. 結合テストと配布準備を行う

- [x] 単一ファイル、複数ファイル（5件）、深い階層、空フォルダを手動テストする
- [x] 未認証、認証拒否、トークン期限切れ、Dropbox API失敗、ChatGPT入力欄未検出をテストする（確認済み、2026-09-22）。ネットワーク失敗後のroot更新で一覧へ復帰しない不具合を修正し、復旧も確認済み。
- [x] 日本語ファイル名・パス、同名ファイル、非対応拡張子をテストする
- [x] ChatGPT側Dropbox連携が同一または同等権限のアカウントであることを確認する手順をREADMEへ記載する
- [x] プライバシー説明、必要権限、接続解除方法、既知のDOM依存をREADMEへ記載する
- [x] Firefoxでのパッケージ化・インストール手順を作成する（未掲載アドオン向けの署名済みXPI手順をREADMEへ記載）
- [x] 署名済みまたはFirefoxで恒久インストール可能なXPIで、Firefox再起動後にDropbox接続状態を復元できることを確認する

完了条件: MVP完成条件を実環境で満たし、第三者がFirefoxへ導入して利用できる。

## v0.2.0 — GitHub Explorer

### 8. GitHub接続とメタデータ取得を実装する

- [x] `src/manifest.json` に `https://api.github.com/*` のhost permissionを追加する
- [x] `githubAuth.ts` を作る
  - fine-grained PATをpassword入力から受け取り、空白を除去して検証する
  - `GET /user` 成功時だけtokenと `login/id` を `storage.local` へ保存する
  - token値、Authorization header、APIのraw error bodyをcontent script・UI・consoleへ渡さない
  - 接続解除ではGitHub保存キーだけを削除し、GitHub側PATの失効はユーザー操作であると表示する
- [x] 設定画面にGitHub接続セクションを追加する
  - `Metadata: read` と `Contents: read` だけを与えた、対象リポジトリ限定・有効期限付きfine-grained PATの作成手順を示す
  - 接続・検証、接続中login表示、リポジトリ確認、ローカル接続解除を実装する
- [x] `githubClient.ts` を作る
  - 全リクエストで `Accept`、`Authorization`、`X-GitHub-Api-Version`、`User-Agent: Primitive-IO` を送る
  - `GET /user/repos` を `affiliation=owner,collaborator,organization_member`、`per_page=100` でページングする
  - Git Trees APIを非再帰で呼び、rootは既定ブランチ、子フォルダはtree SHAで取得する
  - `blob/tree/symlink/submodule` を正規化し、通常ファイルだけを選択可能にする
  - `truncated: true` を `DIRECTORY_TOO_LARGE` として扱い、不完全なentriesをUI・キャッシュへ渡さない
  - 401、403、404、429、rate limit header、ネットワーク失敗をUI向けエラーへ正規化する

完了条件: fine-grained PATが許可したリポジトリのrootと展開フォルダを、本文を取得せずに列挙できる。

### 9. GitHub Explorer UIとプロンプト生成を実装する（UI実装・型チェック済み。Todo 8完了後に結合確認）

- [x] Dropbox/GitHubを単一のCloud Explorerパネルへ統合し、ヘッダーのクライアント選択ドロップダウンで切り替える
- [x] リポジトリ一覧、既定ブランチ、private/public、遅延ツリー、空・未接続・取得中・エラー状態を表示する
- [x] 通常ファイルの1〜5件選択、選択解除、repo切替・更新時の選択解除を実装する
- [x] `repository/ref/path` を含むGitHub専用プロンプトを生成し、既存の下書きを上書きせずChatGPT入力欄へ投入する
- [x] 既存の共通auto-send設定を適用する。DropboxとGitHubの選択を一つのプロンプトに混在させない
- [x] `ref` のプロンプト投入は拡張の責務とし、ChatGPT側が厳密に解釈・取得することは成功条件に含めない

完了条件: 1〜5件のGitHubファイルを選び、repository/ref/pathを含むプロンプトをChatGPT入力欄へ投入できる。

### 10. v0.2.0のテスト・配布説明を更新する

- [ ] `githubAuth` と `githubClient` の自動テストを拡充する（403、404、rate limit reset header、同時取得、キャッシュ、全異常系）
  - [x] `npm test` 基盤を追加。10件でPAT検証、401時の非保存、接続解除、ページング、URLエンコード、tree正規化、truncated、429、ネットワーク失敗、プロンプト生成を確認（2026-09-24）
- [ ] GitHub ExplorerのUIテストを追加する（クライアント切替、5件上限、未接続、空リポジトリ、repo切替、下書き保護、auto-send）
- [ ] public/private/組織/collaboratorリポジトリ、日本語・記号パス、深い階層、symlink、submodule、truncatedを手動確認する
- [ ] ChatGPT側GitHub Appに同一リポジトリを許可した状態で、repository/ref/pathの参照を手動確認する
- [x] README、CHANGELOG、テスト仕様書をGitHub対応へ更新する。Firefoxのデータ利用申告は配布前に実際の収集内容で再確認する
- [ ] Dropbox回帰テストを実施し、保存キー・runtime message・単一パネルでのクライアント切替が相互に干渉しないことを確認する

完了条件: v0.2.0仕様書の完成条件を満たし、Dropbox機能を回帰させずにGitHub Explorerを配布できる。


### 10.1 v0.2.0 テスト実施状況（2026-09-24）

- [x] 静的チェック、ビルド、GitHub自動テスト10件を実行した。
- [x] GitHub手動テスト GA-01〜06、GA-09、GA-10を確認した。無効PATの設定画面エラー表示、privateリポジトリのContents未許可時の拒否、接続解除後の保存キー削除を含む。
- [x] セキュリティ手動テスト GC-01、GC-14を確認した。GitHub API通信の要求ヘッダ、ChatGPTページへPAT・GitHub API通信を渡さないこと、storage.localの保存キーを確認した。
- [x] GC-09は無効PATの401、Contents未許可のprivateリポジトリに対する404、429、OS側ネットワーク切断時のネットワーク失敗を確認した。組織ポリシーに起因する403は未実施。
- [x] GitHub Explorerの基本フロー（接続、リポジトリ表示、ツリー展開、ファイル選択、プロンプト生成）と、Dropbox `.txt` / `.md` の選択・プロンプト生成の回帰を確認した。
- [ ] GA-07（組織ポリシー等による403）、GA-08（配布後の署名済みXPI）を実施する。
- [ ] GitHub UIの残りケース（GU-05〜13）と、GitHub App連携確認（GP-01〜10 / DR-01〜08）を実施する。

v0.2.0の配布判定は、未実施の手動テストとFirefox Add-onsの申告・署名済みXPI確認を完了してから行う。

## v0.3.0 — Dropbox Output

仕様: `specification/Primitive IO v0.3.0.md`

### 11. Dropbox Outputを実装する

- [x] Dropbox Explorerへ、展開状態とは独立したアクティブフォルダ操作を追加する。rootと各フォルダを保存先にでき、選択中のパスをOutput UIへ表示する（型チェック・自動テスト済み、Firefox手動確認は未実施）。
- [ ] 選択中のアクティブフォルダパスをコピーする操作を追加する。
- [ ] Output用の状態をページ単位で管理する。Dropboxから「読み込み」プロンプトを投入したファイルだけを読み込み履歴候補にし、GitHub由来のファイルは候補に含めない。
- [x] ファイル名入力を追加する。拡張子を含まないベース名だけを受け付け、空白のみ、`/`、拡張子付きの名前を拒否する。出力は常に Markdown の `.md` とする（自動テスト済み）。
- [x] バージョン番号決定ロジックを実装する。保存直前にアクティブフォルダ直下を再取得し、`-v0` または `-v[1-9][0-9]*` と大文字・小文字非区別の既存最大値から次番号を決め、常に `.md` を付与する。先頭ゼロ付き既存番号は無視する（自動テスト済み）。
- [x] 保存プロンプトを生成する。内容は「この会話での議論内容をMarkdown文書として要約して」とし、常に新規作成、上書き禁止、代替名禁止を指示する（自動テスト済み）。
- [x] 「保存を依頼」ボタンでChatGPT入力欄へプロンプトを投入し、既存のauto-send設定がオンの時だけ、そのユーザー操作に起因して送信する。下書きは上書きしない（型チェック済み、Firefox手動確認は未実施）。
- [x] 同一操作サイクルでの保存依頼連打を防ぎ、ベース名変更、保存先変更、Dropbox更新で再度有効化する（型チェック済み、Firefox手動確認は未実施）。
- [ ] 通常更新時はfolder IDからアクティブフォルダのメタデータと表示パスを再取得し、消失・非フォルダなら解除する。
- [ ] 保存成功・失敗を判定・表示しないこと、Dropbox APIへの書き込み、ChatGPT出力の取得・解析、保存結果の保存を実装しないことをNetwork/storage inspectionで確認する。
- [ ] Output状態、UI、runtime messageをDropbox/GitHub Inputと分離し、PAT・Dropboxトークン・ファイル本文をcontent scriptやChatGPTページへ渡さないことを確認する。

完了条件: ユーザーがアクティブなDropboxフォルダとファイル名を選び、決定済みのバージョン付き新規ファイル名を含む保存プロンプトを、確認送信または既存設定による自動送信でChatGPTへ渡せる。

### 12. v0.3.0 テスト・配布説明を更新する

- [x] バージョン番号決定とプロンプト生成の自動テストを追加した（`.md`固定、入力番号あり／なし、先頭ゼロ、既存候補、Unicode名、大文字・小文字、無効入力）。`npm test` で13件成功（2026-09-25）。
- [ ] アクティブフォルダ、読み込み履歴候補、更新後の保存先維持・消失時解除、保存プロンプト、auto-send、下書き保護、二重実行防止、ページ遷移時の状態消去のUIテストを追加・実施する。
- [ ] Dropbox APIが保存直前の一覧取得に失敗した場合、保存プロンプトを投入しないことを手動・自動テストする。
- [ ] ChatGPT側Dropbox保存の自然言語再現性を調査する。v0.3.0実装以前には、長い議論の後に「この議論をまとめて仕様書として保存して。保存先は…、ファイル名は…」という最小指示で保存できた実績がある。一方、v0.3.0の「新規作成・上書き禁止・代替名禁止」を含む保存依頼では、ChatGPT側の upload_file が source_file 未指定で失敗した。
  - [ ] 実際に10ターン以上の議論を行った会話で、過去の成功形に近い最小指示（Markdown形式、保存先、ファイル名だけ）を3回以上実行し、Dropbox保存の成功率とChatGPTの応答を記録する。
  - [ ] 最小指示と現行v0.3.0プロンプトを同程度の長い会話で比較し、「新規ファイル」「上書き禁止」「代替名禁止」が保存可否・source_file解決へ与える影響を確認する。
  - [ ] 同一ターンの生成→添付→upload、前ターン生成ファイルのupload、ユーザーが明示添付したファイルのuploadを分けて検証し、ChatGPT側Dropbox actionがsource_fileを受け取れる条件を記録する。
  - [ ] 調査結果が再現可能になるまで、v0.3.0の完成条件を「Dropbox保存成功」ではなく「保存依頼プロンプトの投入」に維持する。
- [ ] Dropboxへの書き込みAPIを呼ばないこと、ChatGPTページへトークン・本文を渡さないこと、保存成否を記録しないことをネットワーク・storage inspectionで確認する。
- [x] v0.3.0テスト仕様書を作成した。
- [ ] README、CHANGELOGへ、Outputの制約（Dropboxのみ・Markdown新規作成のみ・成功判定なし）と利用手順を追記する。

完了条件: v0.3.0仕様のOutputフローと非機能要件を確認し、v0.2.0のInput機能を回帰させずに配布できる。

- Dropboxファイル本文の取得・保存・送信
## MVPでは実装しないこと
- Dropboxへの書き込み、保存、差分、バージョン更新
- ChatGPT出力の取得・解析・成功判定
- 全Dropboxの再帰スキャン、常時同期、バックグラウンド巡回
- Chromium対応
- 他ブラウザ向けの互換性・配布対応
