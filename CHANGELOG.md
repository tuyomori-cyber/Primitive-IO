# 更新履歴

このプロジェクトは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [0.2.0] - 2026-09-23

### 追加

- GitHub ExplorerのUIを追加。Dropboxとは独立したパネル、リポジトリ/ツリー表示、1〜5件選択、`repository/ref/path`を含むプロンプト生成、既存の下書き保護・自動送信設定への対応を実装。
- GitHub Explorer v0.2.0の仕様書、認証・REST API・セキュリティ設計、実装Todoを追加。

### 制約

- GitHubのfine-grained PAT接続、リポジトリ列挙、Git Trees API通信は未実装。GitHub Explorerはまだ利用できず、Dropbox Explorerの機能だけを提供する。

## [0.1.2] - 2026-09-22

### 修正

- Dropbox APIのネットワークエラー後、接続を復旧してパネルを更新してもroot一覧へ戻らない不具合を修正。

### 確認

- 単一・5件選択、深い階層、空フォルダ、日本語・空白・記号を含むパス、同名ファイル、非対応拡張子の手動テストを完了。
- 未認証、認証拒否、トークン期限切れ・無効トークン、Dropbox API失敗、ネットワーク失敗、ChatGPT入力欄未検出の異常系テストを完了。

## [0.1.1]

### 追加

- Firefox向けPrimitive IOの初期配布版を作成。
- Dropboxファイルツリーの選択と、選択パスをChatGPT入力欄へ投入する機能を提供。
- Dropbox OAuth（PKCE）、接続状態の復元、任意の自動送信、署名済みXPIによる配布手順を提供。
