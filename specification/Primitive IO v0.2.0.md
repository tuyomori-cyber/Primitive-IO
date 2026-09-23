# Primitive IO — v0.2.0 GitHub Explorer 仕様書

- 文書版: v0.2.0
- 作成日: 2026-09-23
- 状態: 実装仕様（未実装）
- 対象: Firefox / ChatGPT Web / Dropbox / GitHub.com

## 1. 概要

v0.2.0 は、Dropbox と GitHub を切り替えて使える単一の Cloud Explorer を ChatGPT Web に追加する。ユーザーが GitHub リポジトリ内のファイルをツリーから選ぶと、拡張は `owner/repository`、ブランチ（ref）、リポジトリ内パスを含む読み込み指示を ChatGPT の入力欄へ入れる。

拡張は GitHub のファイル本文を取得、送信、保存しない。GitHub API はリポジトリとツリーのメタデータを表示する目的だけで利用し、本文の検索・取得・理解は ChatGPT 側の GitHub 接続に委ねる。これは Dropbox 版と同じ責務境界である。

v0.2.0 の対象は `github.com` と GitHub REST API (`api.github.com`) のみとする。GitHub Enterprise Server、Gist、Issue、Pull request、コミット履歴、書き込み操作は対象外とする。

## 2. 背景と利用者価値

ChatGPT の GitHub 接続では、会話中にリポジトリ名とファイルパスを指定してコードや文書を参照できる。一方で、深いディレクトリや同名ファイルを自然言語だけで正確に指定するのは手間がかかる。GitHub Explorer はこの入力を、リポジトリ・ブランチ・ファイルツリーを選ぶ操作へ置き換える。

対象例:

- README、仕様書、設定ファイル、ソースコードを指定して設計・レビューをする
- 同一リポジトリの複数ファイルを横断して質問する
- ブランチ上の未マージ変更を、明示した ref で参照させる
- Dropbox 文書と GitHub コードを同一会話で参照させる

## 3. 前提と非保証事項

利用前に、ChatGPT の Apps/Plugins で GitHub を接続し、ChatGPT 側の GitHub App に対象リポジトリへの読み取り権限を与える。プライベートまたは組織リポジトリは、GitHub App のインストールとリポジトリ選択、組織管理者の承認が別途必要になる場合がある。[OpenAI の接続案内](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt)

拡張用トークンと ChatGPT 側 GitHub App の認可は別物である。両者が同じ GitHub アカウントであり、かつ同じ対象リポジトリを読めることを利用者が確認する。拡張は GitHub ユーザー名を表示するが、ChatGPT の接続先やアクセス可能リポジトリを自動照合しない。

ChatGPT の GitHub 機能はプラン、ワークスペース、利用画面によって標準チャットで使えない場合がある。この場合も拡張はプロンプトを作れるが、ChatGPT が本文を取得できることは保証しない。特に、拡張が `repository/ref/path` を正しく投入しても、ChatGPT 側 GitHub 接続が指定 `ref` を常に厳密に解釈・取得することは Primitive IO の保証範囲外とする。

## 4. 機能要件

### 4.1 Cloud Explorer と GitHub Explorer

- ChatGPT ページには開閉可能な Cloud Explorer パネルを 1 つだけ表示する。ヘッダーのクライアント名を操作するとドロップダウンが開き、`Dropbox` と `GitHub` を選択できる。
- 選択中のクライアントだけの接続状態、ツリー、選択件数、更新、読み込み、通知を表示・操作する。クライアントを切り替えても、同一ページ内では各クライアントの選択・取得済みツリー・展開状態を保持する。
- 更新は選択中クライアントのキャッシュと選択だけを破棄する。クライアント切替、パネルの開閉、他クライアントの更新では選択を解除しない。
- GitHub パネルは、登録済みトークンで読めるリポジトリを一覧表示する。各行は `owner/name`、private/public、既定ブランチを示す。
- リポジトリを開くと、既定ブランチを ref として root を表示する。v0.2.0 ではブランチ選択 UI を提供しない。
- フォルダ展開時に、その直下だけを遅延取得する。リポジトリを切り替えたとき、選択は解除する。
- ファイルを複数選択でき、選択上限は Dropbox と同じ 5 件とする。フォルダ、symlink、submodule は選択不可とする。
- ファイル拡張子で選択可否を制限しない。GitHub はコードを主用途とするため、通常ファイルは選択可能にする。ただし Git Trees API が通常ファイルとして返す `blob`（mode `100644` または `100755`）以外はグレー表示し選択不可とする。
- 選択状態、取得済みツリー、展開状態は ChatGPT ページのライフサイクル内だけで保持し、再読込・遷移時に破棄する。
- 更新ボタンはリポジトリ一覧と当該リポジトリのツリーキャッシュを破棄して再取得する。すでに選択した項目は解除する。

### 4.2 読み込みプロンプト

1 件以上の選択時だけ `読み込み` を有効にする。Dropbox と GitHub の選択は同一の読み込み操作に混在させない。選択中クライアントの読み込みは、そのサービス専用プロンプトを投入する。

GitHub のプロンプト形式は次とする。`ref` は URL エンコードせず、API から得た既定ブランチ名をそのまま表示する。パスはリポジトリ root 基準で `/` 区切りとする。

```text
GitHub 連携を使って、次のリポジトリ内ファイルを読み込み、この会話で参照できる状態にしてください。
各項目は owner/repository、ref、リポジトリ root からのパスです。

- repository: octo-org/primitive-io
  ref: main
  path: specification/Primitive IO v0.2.0.md
- repository: octo-org/primitive-io
  ref: main
  path: src/background/githubClient.ts
```

既存の `insertTextIntoEmptyComposer` を再利用する。下書きがある入力欄は上書きせず中止する。既定では投入のみとし、既存の共通 `autoSend` が明示的に有効なときだけ送信する。

### 4.3 設定画面

設定に `GitHub 接続` セクションを追加する。

- fine-grained personal access token（PAT）の入力欄を用意する。入力値は password 型にし、保存後は復元表示しない。
- `接続して検証` はトークンを保存する前に `GET /user` で検証し、成功時だけ保存する。成功後はログイン名を表示する。
- `リポジトリを確認` は最大 100 件ずつページングして、表示可能リポジトリ数と先頭 20 件を表示する。本文を取得しない。
- `接続解除` は Firefox のローカル保存領域から GitHub トークンとアカウント情報を削除する。PAT は GitHub API から失効しない。設定画面に GitHub の token settings へのリンクと、失効は利用者が GitHub 側で行う旨を表示する。
- 利用者には、対象リポジトリを限定し、有効期限を設定した fine-grained PAT を作成するよう案内する。

## 5. 認証方式の決定

### 採用: ユーザー登録の fine-grained PAT

v0.2.0 では、ユーザーが作成した fine-grained PAT を入力して接続する。必要な権限は、対象リポジトリを選択したうえで以下の読み取り専用権限だけである。

- `Metadata: read` — リポジトリの列挙・表示
- `Contents: read` — ディレクトリ（tree）メタデータの取得

`GET /user` は fine-grained PAT で追加権限なしに使えるため、ログイン名の検証・表示に用いる。リポジトリ列挙は `Metadata: read`、tree 取得は `Contents: read` が必要である。[認証済みユーザーの取得](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)、[リポジトリ一覧](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)、[Git tree](https://docs.github.com/en/rest/git/trees#get-a-tree)

fine-grained PAT は resource owner と対象リポジトリを限定でき、組織によっては承認待ちになる。そのため、表示されない組織・リポジトリはトークン設定または組織ポリシーを確認するようエラー案内する。[fine-grained PAT の管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

### 不採用: 拡張だけでの OAuth App

Firefox 拡張は public client であり、client secret を安全に秘匿できない。GitHub は public client で PKCE を推奨しているが、client secret 自体を拡張コードから秘匿できるわけではない。Primitive IO は独自バックエンドを持たず、認証情報を拡張内へ固定埋め込みしない方針のため、OAuth App を採用しない。これは OAuth が技術的に不可能という意味ではなく、本製品のセキュリティおよび運用方針による設計判断である。[GitHub OAuth 認可](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[OAuth App の安全な実装](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)、[Firefox identity API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity)

Device Flow は client secret を不要にできるが、GitHub は公開クライアントでの不用意な有効化をフィッシング上の理由から勧めていない。また classic `repo` scope は private repository 全体を含み、最小権限の方針に反するため採用しない。

### 将来候補: GitHub App + バックエンド

将来、多人数向け配布でトークン入力をなくす場合は GitHub App を使う。GitHub App はリポジトリ単位の権限を提示でき、短命トークンを使える。ただし、App private key、ユーザー認可 code の交換、installation access token 発行を安全なサーバー側で扱う必要がある。この構成は「独自サーバーなし」という現行方針を変更するため v0.2.0 の対象外とする。

## 6. GitHub REST API 設計

すべて background script から呼ぶ。リクエストヘッダーは次で統一する。

```http
Accept: application/vnd.github+json
Authorization: Bearer <fine-grained-pat>
X-GitHub-Api-Version: 2026-03-10
User-Agent: Primitive-IO
```

| 用途 | REST API | パラメータ / 利用値 | 本文取得 |
| --- | --- | --- | --- |
| トークン検証・アカウント表示 | `GET /user` | `login`, `id`, `html_url` のみ採用 | なし |
| リポジトリ一覧 | `GET /user/repos` | `affiliation=owner,collaborator,organization_member`, `sort=full_name`, `per_page=100`, `page` | なし |
| root と直下フォルダの列挙 | `GET /repos/{owner}/{repo}/git/trees/{tree_sha}` | root は `{default_branch}` を tree-ish として指定し、子フォルダは親応答の `sha` を指定する。`recursive` は付けない。 | なし |

ディレクトリ列挙の主 API は Git Trees API とする。root には既定ブランチ名を tree-ish として渡し、子フォルダには親 tree 応答の `sha` を渡すため、各展開は非再帰の 1 リクエストで完結する。`type: tree` をフォルダ、`type: blob` かつ mode `100644` / `100755` を通常ファイル、mode `120000` を symlink、`type: commit` または mode `160000` を submodule として正規化する。応答の `truncated` は必ず検査し、`true` の場合は `DIRECTORY_TOO_LARGE` を返す。不完全な `tree` を UI に表示せず、ディレクトリキャッシュへ保存しない。Contents API はディレクトリ当たり 1,000 項目の上限があり、フォルダ列挙には使わない。Git Trees API の `recursive=1` も 100,000 項目または 7 MB で打ち切られ得るため v0.2.0 で使用しない。[Repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content)、[Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree)

`owner`、`repo`、root に使う ref、子フォルダの tree SHA は、それぞれ URL の path segment として `encodeURIComponent` する。API にリポジトリ内パスを渡さないため、`/` を含む `path` を URL 化しない。API 応答の `path` を表示・プロンプトに用い、ユーザー入力からパスを組み立てない。

## 7. 実装設計

### 7.1 ファイル構成と責務

```text
src/
├─ background/
│  ├─ githubAuth.ts       # PAT の検証、local storage の読み書き、接続状態
│  ├─ githubClient.ts     # GitHub REST API、ページング、エラー・rate limit 処理
│  ├─ githubConfig.ts     # API base URL と API version（GitHub.com 固定）
│  └─ index.ts            # github-* runtime message の振り分け
├─ content/
│  ├─ githubExplorer.ts   # GitHub パネル、リポジトリ/ツリー/選択/UI
│  └─ index.ts            # Dropbox Explorer と GitHub Explorer の mount
└─ options/
   ├─ index.ts            # GitHub 接続操作を追加
   └─ options.html        # GitHub PAT の説明・入力・検証 UI を追加
```

`chatgptAdapter.ts` と `extensionSettings.ts` は共通のまま再利用する。Dropbox の型・メッセージを GitHub の型と混在させず、各サービス固有の union と runtime message を独立させる。

代表的な message は以下とする。

```ts
type GitHubMessage =
  | { type: "primitive-io:github-status" }
  | { type: "primitive-io:github-connect"; token: string }
  | { type: "primitive-io:github-disconnect" }
  | { type: "primitive-io:github-verify" }
  | { type: "primitive-io:github-list-repositories" }
  | { type: "primitive-io:github-list-directory"; owner: string; repo: string; ref: string; path: string; treeSha: string };
```

`GitHubRepository` は `id`, `owner`, `name`, `fullName`, `private`, `defaultBranch` を持つ。`GitHubEntry` は `name`, `path`, `sha`, `type: "file" | "dir" | "symlink" | "submodule"` を持つ。`file` は API 上の `blob` かつ通常ファイル mode に限る。トークン値、Authorization ヘッダー、API の raw error body は content script・UI・console へ渡さない。

### 7.2 manifest とデータ移行

- `host_permissions` に `https://api.github.com/*` を追加する。GitHub OAuth を使わないので `https://github.com/*` は GitHub token settings への通常リンク以外に host permission として追加しない。
- `browser_specific_settings.gecko.data_collection_permissions.required` に、トークン由来で扱う GitHub login とリポジトリ/パスが含まれることを説明できるよう、現行の `personallyIdentifyingInfo` と `websiteActivity` を維持する。Firefox AMO 提出時は実際のデータ利用申告を再確認する。
- 保存キーは `githubTokens`（token）、`githubAccount`、`githubStorageSchemaVersion` とする。Dropbox の保存キーに触れない。
- token の形式検証に prefix を固定しない。GitHub token の prefix は将来変わり得るため、空白除去・空文字拒否だけを行い、`GET /user` の成功で検証する。

### 7.3 エラー、キャッシュ、レート制限

`GitHubClientError` を `AUTH_INVALID`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `NETWORK_FAILURE`, `API_FAILURE`, `DIRECTORY_TOO_LARGE` に分類する。

- `401`: 保存済みトークンを削除せず、再検証または接続解除を促す。通信一時失敗と資格情報破壊を混同しない。
- `403` / `404`: private repository の不可視化、組織の SSO・PAT ポリシー、または ChatGPT 側の権限不足とは区別して、拡張トークンのアクセス不足として説明する。
- `429`、または `403` / `429` かつ `x-ratelimit-remaining: 0`: `x-ratelimit-reset` を読んで再試行可能時刻を表示し、その時刻まで自動再試行しない。`Retry-After` があれば優先する。
- Git Trees API の `truncated: true`: `DIRECTORY_TOO_LARGE` とし、「ディレクトリ一覧を完全に取得できなかった」と表示する。不完全な entries を返却・表示・キャッシュしない。
- ネットワーク失敗ではキャッシュを消さない。利用者の明示更新だけが当該キャッシュを消す。
- 同一 `owner/repo/ref/path` の同時取得は Promise を共有する。成功したディレクトリは当該ページでメモリキャッシュする。本文・Base64・download URL をキャッシュしない。

認証済み REST API の基本レート上限は通常 5,000 requests/hour だが、secondary rate limit もある。並列リクエストを不要に作らず、フォルダ展開時だけ 1 リクエストずつ発行する。GitHub の rate-limit response header を正とする。[REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## 8. セキュリティとプライバシー

- PAT は Firefox extension の `storage.local` にだけ保存し、background script だけが読む。content script、ChatGPT の DOM、独自サーバー、テレメトリへ渡さない。
- `storage.local` は OS の資格情報ストアではない。端末プロファイルにアクセスできる者からの保護は OS/Firefox プロファイル保護に依存する。このため専用かつ短期限、対象リポジトリ限定の fine-grained PAT を必須案内とする。
- ファイル本文、blob 内容、download URL、GitHub のソースコード検索結果を取得しない。保存するのはトークン、接続アカウントの `login/id`、閲覧中にメモリだけに置くリポジトリ・パス・SHA である。
- GitHub のリポジトリ名、ref、パスはユーザーが `読み込み` を押した時だけ ChatGPT へプロンプトとして送る。ツリー閲覧だけでは ChatGPT へ送らない。
- GitHub API への通信先は `api.github.com` のみ、書き込み系 HTTP メソッドは実装しない。
- PAT の接続解除はローカル削除のみであり、GitHub 上のトークン失効ではないことを明示する。

## 9. UI 例

```text
┌ GitHub ───────────────────────────────┐
│ octocat                                │
│ [↻] [×]                                │
│ ▼ 🔒 octo-org/primitive-io  (main)     │
│    ▼ 📁 src                            │
│       ☑ 📄 background/githubClient.ts  │
│    ☑ 📄 README.md                      │
│                                        │
│             2 / 5件選択 [ 読み込み ]  │
│ 自動送信: OFF                           │
└────────────────────────────────────────┘
```

初回・未接続状態では、パネルに「設定を開いて GitHub fine-grained PAT を接続してください」と表示し、設定ページを開くボタンを置く。PAT をパネルへ入力させない。

## 10. テスト仕様

### 自動テスト

- `githubAuth`: 空 token 拒否、`GET /user` 成功時だけ保存、401/403/ネットワーク失敗時に token を保存しない、disconnect で GitHub キーだけを削除する。
- `githubClient`: `/user/repos` の Link header ページング、owner/repo/tree-ish の URL path segment エンコード、Git Trees response の `blob/tree/symlink/submodule` 正規化、メタデータ以外を捨てる。
- `githubClient`: 401、403、404、429、`x-ratelimit-reset`、`Retry-After`、ネットワーク失敗をエラーコードへ正規化する。`truncated: true` は `DIRECTORY_TOO_LARGE` とし、entries を返却・キャッシュしない。
- `githubExplorer`: 5 件上限、repo 切替・更新での選択解除、未接続表示、空 repository、下書き保護、auto-send の既存挙動を確認する。
- 既存 Dropbox テストを回帰実行し、保存キー・message 名の衝突がないことを確認する。

### 手動受け入れテスト

- public repository、private repository、組織 repository、collaborator repository を表示できる（トークンが許可したものだけ）。
- 日本語、空白、`#`、`?`、`%` を含むパスを表示し、正しいプロンプトへ入れられる。
- 同名ファイルが別フォルダにある場合、完全パスで区別される。
- 深い階層、空ディレクトリ、1,000 件を超えるディレクトリ、symlink、submodule を確認する。
- トークン期限切れ、無効 token、組織承認待ち、SSO/ポリシーによる 403、rate limit、ネットワーク断からの回復を確認する。
- 大規模ディレクトリ等で Git Trees API の `truncated: true` が返った場合、不完全な一覧を通常表示せずエラーとして扱えることを確認する。
- ChatGPT 側に同一リポジトリを許可した状態で、投入した `repository/ref/path` を使って対象内容を参照できることを確認する。特に `ref` を含む指示が期待どおりに解釈されるか確認するが、ChatGPT 側の読み込み失敗は拡張が成功判定しない。

## 11. 完成条件

- 既存 Dropbox Explorer を壊さず、GitHub Explorer を独立して表示できる。
- fine-grained PAT を設定画面から検証・保存・ローカル削除できる。
- 読み取り専用の Metadata / Contents 権限で、許可リポジトリの root と展開フォルダを閲覧できる。
- 1〜5 個の通常ファイルを選択し、`owner/repository`、既定ブランチ、リポジトリ相対パスを含むプロンプトを作れる。
- ファイル本文を GitHub API から取得・保存せず、トークンを ChatGPT DOM へ渡さない。
- 失敗理由を未接続、権限不足、rate limit、ネットワーク、API 失敗、ChatGPT 入力欄問題として区別して利用者に表示できる。
- ChatGPT 側 GitHub 接続が同一リポジトリを許可している場合、利用者が通常の会話を継続できる。

## 12. v0.2.0 で含めないもの

- GitHub OAuth App / Device Flow / GitHub App によるログイン
- GitHub App 用バックエンド、独自サーバー、テレメトリ
- GitHub Enterprise Server
- ブランチ、tag、commit SHA を UI で切り替える機能
- GitHub Code Search、全文取得、ファイル本文のプレビュー・保存
- Issue、Pull request、Discussion、Wiki、Gist、Actions の閲覧
- GitHub への commit、branch 作成、PR 作成、ファイル書き込み
- Dropbox と GitHub の選択項目を一つの読み込みプロンプトに混ぜる UI

## 13. 将来候補

- GitHub App + バックエンドへ移行し、リポジトリ選択型・短命トークンの接続 UX を提供する。
- ref 選択（branch/tag/commit SHA）と、選択 ref を URL 固定して再現可能な参照を作る。
- Dropbox/GitHub の選択を統合し、サービス種別を明示した単一プロンプトを生成する。
- GitHub Enterprise Server の API base URL と認証を、別設計・別セキュリティレビューの上で追加する。
