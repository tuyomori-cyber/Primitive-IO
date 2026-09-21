type DropboxAccount = {
  displayName: string;
  email: string;
};

type DropboxAuthStatus = {
  appKey: string;
  redirectUri: string;
  connected: boolean;
  account?: DropboxAccount;
};

type DropboxMessage =
  | { type: "primitive-io:dropbox-status" }
  | { type: "primitive-io:dropbox-save-app-key"; appKey: string }
  | { type: "primitive-io:dropbox-connect" }
  | { type: "primitive-io:dropbox-disconnect" }
  | { type: "primitive-io:dropbox-verify" }
  | { type: "primitive-io:dropbox-list-folder"; path: string }
  | { type: "primitive-io:auto-send-get" }
  | { type: "primitive-io:auto-send-set"; enabled: boolean };

type DropboxEntry = {
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

const appKeyInput = requiredElement<HTMLInputElement>("#app-key");
const redirectUri = requiredElement<HTMLElement>("#redirect-uri");
const connectionState = requiredElement<HTMLElement>("#connection-state");
const statusElement = requiredElement<HTMLElement>("#status");
const saveButton = requiredElement<HTMLButtonElement>("#save-app-key");
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
  appKeyInput.value = auth.appKey;
  redirectUri.textContent = auth.redirectUri;
  connectButton.style.display = auth.appKey && !auth.connected ? "block" : "none";
  verifyButton.style.display = auth.connected ? "block" : "none";
  disconnectButton.style.display = auth.connected ? "block" : "none";
  listRootButton.disabled = !auth.connected;

  if (auth.connected && auth.account) {
    connectionState.textContent = `接続済み: ${auth.account.displayName}（${auth.account.email}）`;
  } else if (auth.appKey) {
    connectionState.textContent = "未接続です。Dropboxへ接続してください。";
  } else {
    connectionState.textContent = "Dropbox App keyを保存してください。";
  }
}

async function request(message: DropboxMessage): Promise<DropboxAuthStatus> {
  return browser.runtime.sendMessage(message) as Promise<DropboxAuthStatus>;
}

async function requestEntries(path: string): Promise<DropboxEntry[]> {
  return browser.runtime.sendMessage({ type: "primitive-io:dropbox-list-folder", path }) as Promise<DropboxEntry[]>;
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

saveButton.addEventListener("click", async () => {
  try {
    render(await request({ type: "primitive-io:dropbox-save-app-key", appKey: appKeyInput.value }));
    showStatus("App keyを保存しました。", "success");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "App keyを保存できませんでした。", "error");
  }
});

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
