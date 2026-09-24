import { githubApiBaseUrl, githubHeaders } from "./githubConfig";

const keys = { tokens: "githubTokens", account: "githubAccount", schema: "githubStorageSchemaVersion" } as const;
type Tokens = { token: string };
export type GitHubAccount = { login: string; id: number };
export type GitHubAuthStatus = { connected: boolean; account?: GitHubAccount };

async function readTokens(): Promise<Tokens | undefined> {
  const value = (await browser.storage.local.get(keys.tokens))[keys.tokens];
  return typeof value === "object" && value !== null && "token" in value && typeof value.token === "string" && value.token.trim() ? { token: value.token } : undefined;
}

async function fetchAccount(token: string): Promise<GitHubAccount> {
  let response: Response;
  try { response = await fetch(`${githubApiBaseUrl}/user`, { headers: githubHeaders(token) }); }
  catch { throw new Error("GitHub APIへ接続できませんでした。ネットワーク接続を確認してください。"); }
  if (response.status === 401) throw new Error("GitHubトークンが無効です。fine-grained PATを確認してください。");
  if (response.status === 403) throw new Error("GitHubへのアクセスが許可されていません。PATの権限または組織ポリシーを確認してください。");
  if (!response.ok) throw new Error(`GitHub接続を検証できませんでした（HTTP ${response.status}）。`);
  const user = await response.json() as { login?: unknown; id?: unknown };
  if (typeof user.login !== "string" || typeof user.id !== "number") throw new Error("GitHubから有効なアカウント情報を取得できませんでした。");
  return { login: user.login, id: user.id };
}

export async function getGitHubAccessToken(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) throw new Error("GitHubに接続されていません。設定画面でfine-grained PATを登録してください。");
  return tokens.token;
}

export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const [tokens, result] = await Promise.all([readTokens(), browser.storage.local.get(keys.account)]);
  const account = result[keys.account];
  return tokens && typeof account === "object" && account !== null && "login" in account && "id" in account && typeof account.login === "string" && typeof account.id === "number" ? { connected: true, account: { login: account.login, id: account.id } } : { connected: false };
}

/** Validates the PAT before persisting it; the raw token never leaves background code. */
export async function connectGitHub(rawToken: string): Promise<GitHubAuthStatus> {
  const token = rawToken.trim();
  if (!token) throw new Error("fine-grained PATを入力してください。");
  const account = await fetchAccount(token);
  await browser.storage.local.set({ [keys.tokens]: { token }, [keys.account]: account, [keys.schema]: 1 });
  return { connected: true, account };
}

export async function verifyGitHubConnection(): Promise<GitHubAuthStatus> {
  const account = await fetchAccount(await getGitHubAccessToken());
  await browser.storage.local.set({ [keys.account]: account });
  return { connected: true, account };
}

/** Local removal only; PAT revocation is performed by the user on GitHub. */
export async function disconnectGitHub(): Promise<GitHubAuthStatus> {
  await browser.storage.local.remove([keys.tokens, keys.account, keys.schema]);
  return { connected: false };
}
