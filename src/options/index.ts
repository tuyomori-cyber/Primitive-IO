type DropboxAccount = {
  displayName: string;
  email: string;
};

type DropboxAuthStatus = {
  redirectUri: string;
  connected: boolean;
  account?: DropboxAccount;
};

type DropboxMessage =
  | { type: "primitive-io:dropbox-status" }
  | { type: "primitive-io:dropbox-connect" }
  | { type: "primitive-io:dropbox-disconnect" }
  | { type: "primitive-io:dropbox-verify" }
  | { type: "primitive-io:dropbox-list-folder"; folderId: string }
  | { type: "primitive-io:auto-send-get" }
  | { type: "primitive-io:auto-send-set"; enabled: boolean };

type DropboxEntry = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
};

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`設定画面の要素を初期化できませんでした: ${selector}`);
  }

  return element;
}

const redirectUri = requiredElement<HTMLElement>("#redirect-uri");
const connectionState = requiredElement<HTMLElement>("#connection-state");
const statusElement = requiredElement<HTMLElement>("#status");
const connectButton = requiredElement<HTMLButtonElement>("#connect");
const verifyButton = requiredElement<HTMLButtonElement>("#verify");
const disconnectButton = requiredElement<HTMLButtonElement>("#disconnect");
const listRootButton = requiredElement<HTMLButtonElement>("#list-root");
const rootEntries = requiredElement<HTMLElement>("#root-entries");
const autoSendCheckbox = requiredElement<HTMLInputElement>("#auto-send");

function showStatus(message: string, kind: "success" | "error" | "info" = "info"): void {
  statusElement.textContent = message;
  statusElement.className = kind === "info" ? "" : kind;
}

function render(auth: DropboxAuthStatus): void {
  redirectUri.textContent = auth.redirectUri;
  connectButton.style.display = !auth.connected ? "block" : "none";
  verifyButton.style.display = auth.connected ? "block" : "none";
  disconnectButton.style.display = auth.connected ? "block" : "none";
  listRootButton.disabled = !auth.connected;

  if (auth.connected && auth.account) {
    connectionState.textContent = `接続済み: ${auth.account.displayName}（${auth.account.email}）`;
  } else {
    connectionState.textContent = "未接続です。Dropboxへ接続してください。";
  }
}

async function request(message: DropboxMessage): Promise<DropboxAuthStatus> {
  return browser.runtime.sendMessage(message) as Promise<DropboxAuthStatus>;
}

async function requestEntries(folderId = ""): Promise<DropboxEntry[]> {
  return browser.runtime.sendMessage({ type: "primitive-io:dropbox-list-folder", folderId }) as Promise<DropboxEntry[]>;
}

async function readAutoSend(): Promise<boolean> {
  return browser.runtime.sendMessage({ type: "primitive-io:auto-send-get" }) as Promise<boolean>;
}

async function saveAutoSend(enabled: boolean): Promise<boolean> {
  return browser.runtime.sendMessage({ type: "primitive-io:auto-send-set", enabled }) as Promise<boolean>;
}

async function refresh(): Promise<void> {
  render(await request({ type: "primitive-io:dropbox-status" }));
}

connectButton.addEventListener("click", async () => {
  try {
    showStatus("Dropboxの認可画面を開いています。", "info");
    render(await request({ type: "primitive-io:dropbox-connect" }));
    showStatus("Dropboxへ接続しました。", "success");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Dropboxへ接続できませんでした。", "error");
  }
});

verifyButton.addEventListener("click", async () => {
  try {
    render(await request({ type: "primitive-io:dropbox-verify" }));
    showStatus("Dropbox接続を確認しました。", "success");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Dropbox接続を確認できませんでした。", "error");
  }
});

disconnectButton.addEventListener("click", async () => {
  try {
    render(await request({ type: "primitive-io:dropbox-disconnect" }));
    showStatus("Dropbox接続を解除しました。", "success");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Dropbox接続を解除できませんでした。", "error");
  }
});

listRootButton.addEventListener("click", async () => {
  try {
    rootEntries.textContent = "取得中…";
    const entries = await requestEntries("");
    rootEntries.textContent = entries.length === 0
      ? "rootは空です。"
      : entries.map((entry) => `${entry.type === "folder" ? "📁" : "📄"} ${entry.name}\n   ${entry.path}`).join("\n");
  } catch (error) {
    rootEntries.textContent = error instanceof Error ? error.message : "rootを取得できませんでした。";
  }
});

autoSendCheckbox.addEventListener("change", async () => {
  try {
    autoSendCheckbox.checked = await saveAutoSend(autoSendCheckbox.checked);
    showStatus(`自動送信を${autoSendCheckbox.checked ? "オン" : "オフ"}にしました。`, "success");
  } catch (error) {
    autoSendCheckbox.checked = await readAutoSend();
    showStatus(error instanceof Error ? error.message : "自動送信設定を保存できませんでした。", "error");
  }
});

void refresh().catch((error: unknown) => {
  showStatus(error instanceof Error ? error.message : "設定を読み込めませんでした。", "error");
});

void readAutoSend().then((enabled) => {
  autoSendCheckbox.checked = enabled;
});

type GitHubStatus = { connected: boolean; account?: { login: string; id: number } };
type GitHubRepository = { fullName: string; private: boolean; defaultBranch: string };
const githubToken = requiredElement<HTMLInputElement>("#github-token");
const githubState = requiredElement<HTMLElement>("#github-state");
const githubConnect = requiredElement<HTMLButtonElement>("#github-connect");
const githubVerify = requiredElement<HTMLButtonElement>("#github-verify");
const githubList = requiredElement<HTMLButtonElement>("#github-list-repositories");
const githubDisconnect = requiredElement<HTMLButtonElement>("#github-disconnect");
const githubRepositories = requiredElement<HTMLElement>("#github-repositories");
const githubStatus = requiredElement<HTMLElement>("#github-status");
const githubRequest = (message: unknown): Promise<GitHubStatus> => browser.runtime.sendMessage(message) as Promise<GitHubStatus>;
function githubMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}
function showGitHubStatus(message: string, kind: "success" | "error" | "info" = "info"): void {
  githubStatus.textContent = message;
  githubStatus.className = kind === "info" ? "" : kind;
}
function renderGitHub(status: GitHubStatus): void {
  githubToken.value = "";
  githubToken.style.display = status.connected ? "none" : "block";
  githubConnect.style.display = status.connected ? "none" : "block";
  githubVerify.style.display = status.connected ? "block" : "none";
  githubList.style.display = status.connected ? "block" : "none";
  githubDisconnect.style.display = status.connected ? "block" : "none";
  githubState.textContent = status.connected ? `接続済み: ${status.account?.login ?? "GitHub"}` : "未接続です。fine-grained PATを登録してください。";
}
githubConnect.addEventListener("click", async () => {
  try { renderGitHub(await githubRequest({ type: "primitive-io:github-connect", token: githubToken.value })); showGitHubStatus("GitHubへ接続しました。", "success"); }
  catch (error) { showGitHubStatus(githubMessage(error, "GitHubへ接続できませんでした。"), "error"); }
});
githubVerify.addEventListener("click", async () => {
  try { renderGitHub(await githubRequest({ type: "primitive-io:github-verify" })); showGitHubStatus("GitHub接続を確認しました。", "success"); }
  catch (error) { showGitHubStatus(githubMessage(error, "GitHub接続を確認できませんでした。"), "error"); }
});
githubDisconnect.addEventListener("click", async () => {
  try { renderGitHub(await githubRequest({ type: "primitive-io:github-disconnect" })); githubRepositories.textContent = ""; showGitHubStatus("GitHubのローカル接続情報を削除しました。", "success"); }
  catch (error) { showGitHubStatus(githubMessage(error, "GitHub接続を解除できませんでした。"), "error"); }
});
githubList.addEventListener("click", async () => {
  try {
    githubRepositories.textContent = "取得中…";
    const repositories = await browser.runtime.sendMessage({ type: "primitive-io:github-list-repositories" }) as GitHubRepository[];
    githubRepositories.textContent = repositories.length === 0 ? "表示できるリポジトリはありません。" : `表示可能: ${repositories.length}件\n\n${repositories.slice(0, 20).map((repo) => `${repo.private ? "🔒" : "◫"} ${repo.fullName} (${repo.defaultBranch})`).join("\n")}`;
  } catch (error) { githubRepositories.textContent = githubMessage(error, "リポジトリを取得できませんでした。"); }
});
void githubRequest({ type: "primitive-io:github-status" }).then(renderGitHub).catch((error: unknown) => {
  showGitHubStatus(githubMessage(error, "GitHub接続状態を確認できませんでした。"), "error");
});
