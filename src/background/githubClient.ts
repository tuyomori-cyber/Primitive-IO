import { getGitHubAccessToken } from "./githubAuth";
import { githubApiBaseUrl, githubHeaders } from "./githubConfig";

export type GitHubRepository = { id: string; owner: string; name: string; fullName: string; private: boolean; defaultBranch: string };
export type GitHubEntry = { name: string; path: string; sha: string; type: "file" | "dir" | "symlink" | "submodule" };
export type GitHubClientErrorCode = "AUTH_INVALID" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "NETWORK_FAILURE" | "API_FAILURE" | "DIRECTORY_TOO_LARGE";
export class GitHubClientError extends Error { constructor(public readonly code: GitHubClientErrorCode, message: string) { super(message); } }
type Repo = { id?: unknown; name?: unknown; full_name?: unknown; private?: unknown; default_branch?: unknown; owner?: { login?: unknown } };
type TreeItem = { path?: unknown; sha?: unknown; type?: unknown; mode?: unknown };
type Tree = { truncated?: unknown; tree?: TreeItem[] };

function retryAt(response: Response): string {
  const after = Number(response.headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0) return `${Math.ceil(after / 60)}分後`;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "しばらく後";
}
function responseError(response: Response): GitHubClientError {
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) return new GitHubClientError("RATE_LIMITED", `GitHub APIの利用制限に達しました。${retryAt(response)}に再試行してください。`);
  if (response.status === 401) return new GitHubClientError("AUTH_INVALID", "GitHubトークンが無効です。設定画面で再検証または接続解除してください。");
  if (response.status === 403) return new GitHubClientError("FORBIDDEN", "GitHubリポジトリへのアクセスが許可されていません。PATの権限または組織ポリシーを確認してください。");
  if (response.status === 404) return new GitHubClientError("NOT_FOUND", "GitHubリポジトリまたはディレクトリが見つかりません。アクセス権も確認してください。");
  return new GitHubClientError("API_FAILURE", `GitHub APIの取得に失敗しました（HTTP ${response.status}）。`);
}
async function getJson<T>(path: string): Promise<{ body: T; response: Response }> {
  let response: Response;
  try { response = await fetch(`${githubApiBaseUrl}${path}`, { headers: githubHeaders(await getGitHubAccessToken()) }); }
  catch (error) { if (error instanceof GitHubClientError) throw error; throw new GitHubClientError("NETWORK_FAILURE", "GitHub APIへ接続できませんでした。ネットワーク接続を確認してください。"); }
  if (!response.ok) throw responseError(response);
  return { body: await response.json() as T, response };
}
function nextPage(link: string | null): number | undefined { const result = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="next"/); return result ? Number(result[1]) : undefined; }
function normalizeRepo(repo: Repo): GitHubRepository | undefined {
  if (typeof repo.id !== "number" || typeof repo.name !== "string" || typeof repo.full_name !== "string" || typeof repo.private !== "boolean" || typeof repo.default_branch !== "string" || typeof repo.owner?.login !== "string") return undefined;
  return { id: String(repo.id), owner: repo.owner.login, name: repo.name, fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch };
}
export async function listGitHubRepositories(): Promise<GitHubRepository[]> {
  const entries: GitHubRepository[] = []; let page: number | undefined = 1;
  while (page !== undefined) {
    const { body, response } = await getJson<Repo[]>(`/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=full_name&per_page=100&page=${page}`);
    if (!Array.isArray(body)) throw new GitHubClientError("API_FAILURE", "GitHubリポジトリ一覧の応答が不正です。");
    entries.push(...body.flatMap((repo) => { const item = normalizeRepo(repo); return item ? [item] : []; }));
    page = nextPage(response.headers.get("link"));
  }
  return entries.sort((a, b) => a.fullName.localeCompare(b.fullName, "ja"));
}
function normalizeEntry(entry: TreeItem, parentPath: string): GitHubEntry | undefined {
  if (typeof entry.path !== "string" || typeof entry.sha !== "string" || typeof entry.type !== "string" || typeof entry.mode !== "string") return undefined;
  const type = entry.type === "tree" ? "dir" : entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755") ? "file" : entry.type === "blob" && entry.mode === "120000" ? "symlink" : (entry.type === "commit" || entry.mode === "160000") ? "submodule" : undefined;
  const path = parentPath ? `${parentPath}/${entry.path}` : entry.path;
  return type ? { name: entry.path, path, sha: entry.sha, type } : undefined;
}
const inFlight = new Map<string, Promise<GitHubEntry[]>>();
/** Lists immediate children only; no recursive or file-content request is made. */
export function listGitHubDirectory(owner: string, repo: string, ref: string, path: string, treeSha: string): Promise<GitHubEntry[]> {
  const key = `${owner}\u0000${repo}\u0000${ref}\u0000${path}\u0000${treeSha}`, pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const { body } = await getJson<Tree>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}`);
    if (body.truncated === true) throw new GitHubClientError("DIRECTORY_TOO_LARGE", "ディレクトリ一覧を完全に取得できませんでした。");
    if (!Array.isArray(body.tree)) throw new GitHubClientError("API_FAILURE", "GitHubディレクトリ一覧の応答が不正です。");
    return body.tree.flatMap((entry) => { const item = normalizeEntry(entry, path); return item ? [item] : []; }).sort((a, b) => a.type !== b.type ? (a.type === "dir" ? -1 : b.type === "dir" ? 1 : 0) : a.name.localeCompare(b.name, "ja"));
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request); return request;
}
