# Primitive IO — 実装Todo

最終更新: 2026-09-21

## 実装方針

- Firefox専用のManifest V3 WebExtensionとして実装する。
- Chrome／Chromium互換レイヤーは作らず、Firefoxの `browser` APIを前提にする。
- ページUIとChatGPT DOM操作はcontent script、Dropbox OAuth・トークン管理・Dropbox API通信はFirefoxのbackground scriptに分離する。FirefoxではManifest V3の`background.service_worker`を使わない。
- content scriptとbackground処理はメッセージ経由だけで通信する。Dropboxのアクセストークン／リフレッシュトークンをcontent scriptやChatGPTページへ渡さない。
- Dropboxツリーは再帰取得しない。root表示時とフォルダ展開時に、その直下だけを取得する。
- 最初は「プロンプト投入のみ」を完成させる。自動送信は設定画面と確認送信が安定してから追加する。

## 実装順序

### 0. 開発基盤を決定・作成する

- [x] TypeScriptを使うか、素のJavaScriptで開始するか決める（TypeScript + esbuild）
- [x] ビルド方法とローカルFirefoxでの一時インストール手順を決める
  - `npm install`
  - `npm run check`
  - `npm run build`
  - Firefoxで `about:debugging#/runtime/this-firefox` を開き、「一時的なアドオンを読み込む」から **`dist/manifest.json`** を選択する（`src/manifest.json` はビルド元であり、選択しない）
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

## MVPでは実装しないこと

- Dropboxファイル本文の取得・保存・送信
- Dropboxへの書き込み、保存、差分、バージョン更新
- ChatGPT出力の取得・解析・成功判定
- 全Dropboxの再帰スキャン、常時同期、バックグラウンド巡回
- Chromium対応
- 他ブラウザ向けの互換性・配布対応
