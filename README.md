# Primitive IO

Firefox上のChatGPT WebにCloud Explorerを表示し、DropboxまたはGitHubのファイル選択情報をプロンプトとして入力する拡張です。クライアントは一つのパネル内のドロップダウンで切り替えます。

v0.2.0では、fine-grained PATで許可されたGitHubリポジトリの一覧と非再帰ツリーを表示できます。DropboxまたはGitHubで選んだファイルの識別情報を、ChatGPT入力欄へ投入します。設計と残作業は[GitHub Explorer仕様](specification/Primitive%20IO%20v0.2.0.md)および[実装Todo](.context/ToDo.md)を参照してください。

Firefoxデスクトップ版 140以降が必要です。インストール時には、Dropboxのアカウント情報・選択パス、およびGitHubのlogin・リポジトリ／パス情報を扱うことをFirefoxのデータ利用許可として表示します。テレメトリや独自サーバーへの送信は行いません。

## 署名済みXPIをそのまま使う

ソースコードを変更せずに利用する場合はこちらです。

1. 配布元から**署名済み**の `.xpi` をダウンロードします。`dist/` にある未署名XPIや、`about:debugging` で読み込む `manifest.json` は恒久利用できません。
2. Firefoxで `about:addons` を開き、歯車メニューの「ファイルからアドオンをインストール」を選んで、ダウンロードしたXPIを指定します。
3. アドオンの詳細画面から「設定」を開きます。
4. 「Dropboxへ接続」を選び、認可を完了します。Dropboxアプリの設定やApp keyの入力は不要です。ChatGPTを開くとDropboxパネルが表示されます。

Firefoxを再起動し、`about:addons` にPrimitive IOが有効な状態で表示され、Dropboxの接続状態が復元されることを確認してください。Dropboxアプリのアクセス種別は **Full Dropbox**、必要なscopeは `files.metadata.read` と `account_info.read` です。

## clone / forkして開発・配布する

ソースを変更する場合、既存の署名は使えません。自分の署名済みXPIを作成してください。

```bash
git clone <このリポジトリのURL>
cd Primitive-IO
npm install
npm run check
npm run build
npm test
```

開発中だけは Firefox の `about:debugging#/runtime/this-firefox` から `dist/manifest.json` を「一時的なアドオン」として読み込めます。この方法はFirefoxを再起動すると消えます。

フォークを配布する場合は、`src/manifest.json` の以下を自分用の一意なIDへ変更してください。

```json
"browser_specific_settings": {
  "gecko": {
    "id": "your-extension-id@example.com"
  }
}
```

このIDを変更するとOAuthリダイレクトURLも変わります。Dropbox Developer Consoleには、**ビルド後に設定画面で表示されるURL**を登録してください。フォーク独自のDropboxアプリを使う場合は、`src/background/dropboxConfig.ts` の `dropboxAppKey` をそのアプリのApp keyへ更新します。App keyは公開クライアント識別子なのでXPIへ同梱できますが、クライアントシークレットは絶対にリポジトリやXPIへ含めないでください。

### フォーク版を恒久インストール用に署名する

通常版Firefoxでは、恒久インストールにはMozilla署名済みXPIが必要です。以下は個人利用向けの「未掲載（unlisted）」アドオンとして配布する手順です。

1. パッケージを生成します。

   ```bash
   npm run package
   unzip -t dist/primitive-io-<version>.xpi
   ```

2. [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/addon/submit/distribution) で「On your own」を選び、生成した `dist/primitive-io-<version>.xpi` をアップロードして署名済みXPIを取得します。公開ストアへの掲載は不要です。
3. 取得した署名済みXPIを配布するか、自分のFirefoxへ `about:addons` からインストールします。
4. Firefoxを再起動し、`about:addons` にフォーク版が有効なまま表示されることを確認します。ChatGPTを開き、Dropboxの接続状態も確認してください。

未署名の `dist/primitive-io-<version>.xpi` はパッケージ確認用です。Firefox通常版へ恒久インストールできません。Firefox Developer Edition / Nightlyで署名要件を無効化する手段はありますが、通常運用には使いません。

更新時は `version` を上げて再度 `npm run package` を実行し、署名済みXPIを同じ手順で配布・インストールします。配布開始後は `browser_specific_settings.gecko.id` を変更しないでください。変更するとFirefoxの保存済み設定・OAuthリダイレクトURLとの対応が切れます。

## Dropbox連携の前提

Dropbox Developer Consoleには、この拡張のFirefox OAuthリダイレクトURLを登録します。ChatGPT側のDropbox連携と拡張側OAuthは別の認証なので、同一または同等の閲覧権限を持つDropboxアカウントで接続してください。

拡張の「接続解除」はDropboxトークンの失効を試みたうえで、Firefox内に保存された認証情報を削除します。

## GitHub連携

GitHub Explorerは、利用者ごとに作成したfine-grained personal access token（PAT）を使います。GitHubのtoken settingsで、resource ownerと必要なリポジトリだけを選び、有効期限を設定してください。Repository permissionsは`Metadata: Read-only`と`Contents: Read-only`だけを設定し、その他の権限は付与しないでください。このPATはPrimitive IO専用とし、他のアプリ、CLI、スクリプト、自動化で使い回さないでください。

設定画面の「GitHub 接続」でPATを入力して「接続して検証」を選びます。`GET /user`が成功した場合だけ、PATとGitHub loginをFirefoxのローカル保存領域へ保存します。PATは保存後に設定画面へ再表示しません。「リポジトリを確認」では、PATが表示を許可したリポジトリ数と先頭20件を確認できます。

拡張の現行実装は、GitHub APIのファイル本文取得APIを呼ばず、リポジトリ一覧とGit Treeのメタデータ（名前、パス、SHA、種別）のみを取得します。これは現行実装の責務境界であり、利用者がPATに与える権限や改変版・将来版まで含めて本文取得が絶対に起きないことを保証するものではありません。「読み込み」を押した後の本文参照は、利用者が別途許可したChatGPTのGitHub連携側で行われます。

## 既知の制約

- ChatGPTの入力欄・送信ボタンのDOM構造に依存します。ChatGPTのUI変更後は追従修正が必要になる場合があります。
- 拡張はDropboxのファイル本文を読み取りません。送信するのは、選択したファイルパスを含むChatGPT向けプロンプトだけです。
- GitHubのリポジトリ本文の参照可否は、Primitive IO用PATとは別に、ChatGPT側のGitHub連携で同じリポジトリを許可しているかに依存します。
