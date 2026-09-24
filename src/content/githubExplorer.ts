import { insertTextIntoEmptyComposer, sendComposer } from "./chatgptAdapter";

type GitHubAccount = { login: string };
type GitHubAuthStatus = { connected: boolean; account?: GitHubAccount };
type GitHubRepository = { id: string; owner: string; name: string; fullName: string; private: boolean; defaultBranch: string };
type GitHubEntry = { name: string; path: string; sha: string; type: "file" | "dir" | "symlink" | "submodule" };
export type SelectedGitHubEntry = GitHubEntry & { repository: GitHubRepository };

const maxSelections = 5;
/** Builds the exact metadata-only instruction inserted into the ChatGPT composer. */
export function buildGitHubPrompt(entries: Iterable<SelectedGitHubEntry>): string {
  return [
    "GitHub 連携を使って、次のリポジトリ内ファイルを読み込み、この会話で参照できる状態にしてください。",
    "各項目は owner/repository、ref、リポジトリ root からのパスです。", "",
    ...Array.from(entries).flatMap((entry) => [`- repository: ${entry.repository.fullName}`, `  ref: ${entry.repository.defaultBranch}`, `  path: ${entry.path}`])
  ].join("\n");
}


function setStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) element.style.setProperty(property, value, "important");
}

function makeElement<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}

async function authStatus(): Promise<GitHubAuthStatus> {
  return browser.runtime.sendMessage({ type: "primitive-io:github-status" }) as Promise<GitHubAuthStatus>;
}

async function listRepositories(): Promise<GitHubRepository[]> {
  return browser.runtime.sendMessage({ type: "primitive-io:github-list-repositories" }) as Promise<GitHubRepository[]>;
}

async function listDirectory(repository: GitHubRepository, path: string, treeSha: string): Promise<GitHubEntry[]> {
  return browser.runtime.sendMessage({
    type: "primitive-io:github-list-directory", owner: repository.owner, repo: repository.name,
    ref: repository.defaultBranch, path, treeSha
  }) as Promise<GitHubEntry[]>;
}

async function getAutoSend(): Promise<boolean> {
  return browser.runtime.sendMessage({ type: "primitive-io:auto-send-get" }) as Promise<boolean>;
}

async function openOptionsPage(): Promise<void> {
  await browser.runtime.sendMessage({ type: "primitive-io:open-options-page" });
}

/** Mounts the GitHub-only explorer. GitHub credentials stay in the background script. */
export function mountGitHubExplorer(): void {
  if (document.getElementById("primitive-io-github-explorer")) return;

  const launcher = makeElement("button", "Cloud Explorer");
  launcher.type = "button";
  launcher.id = "primitive-io-github-launcher";
  setStyles(launcher, { all: "initial", display: "none", position: "fixed", "z-index": "2147483647", top: "88px", left: "16px", padding: "9px 12px", border: "1px solid #9aa0a6", "border-radius": "8px", background: "#ffffff", color: "#202124", "box-shadow": "0 4px 12px rgb(0 0 0 / 18%)", "font-family": "system-ui, sans-serif", "font-size": "14px", cursor: "pointer" });

  const panel = makeElement("aside");
  panel.id = "primitive-io-github-explorer";
  panel.setAttribute("aria-label", "Primitive IO GitHub Explorer");
  setStyles(panel, { all: "initial", display: "none", position: "fixed", "z-index": "2147483647", top: "88px", right: "16px", width: "300px", "max-width": "calc(100vw - 32px)", "max-height": "calc(100vh - 112px)", overflow: "auto", border: "1px solid #9aa0a6", "border-radius": "10px", background: "#ffffff", color: "#202124", "box-shadow": "0 8px 24px rgb(0 0 0 / 18%)", "font-family": "system-ui, sans-serif", "font-size": "14px", "line-height": "1.4" });

  const header = makeElement("div");
  const clientSelector = makeElement("select");
  clientSelector.setAttribute("aria-label", "表示するクラウドサービス");
  for (const [value, label] of [["dropbox", "Dropbox"], ["github", "GitHub"]] as const) {
    const option = makeElement("option", label);
    option.value = value;
    clientSelector.append(option);
  }
  clientSelector.value = "github";
  const account = makeElement("span", "確認中…");
  const refresh = makeElement("button", "↻");
  refresh.type = "button";
  refresh.title = "リポジトリ一覧を再取得";
  const settings = makeElement("button", "⚙");
  settings.type = "button";
  settings.title = "設定を開く";
  settings.setAttribute("aria-label", "設定を開く");
  const close = makeElement("button", "×");
  close.type = "button";
  close.title = "閉じる";
  const body = makeElement("div");
  const message = makeElement("p", "接続状態を確認しています…");
  const footer = makeElement("div");
  const selectionSummary = makeElement("span", "0 / 5件選択");
  const readButton = makeElement("button", "読み込み");
  readButton.type = "button";
  const notice = makeElement("p");
  const autoSendIndicator = makeElement("p", "自動送信: OFF");
  setStyles(header, { display: "flex", "align-items": "center", gap: "8px", padding: "12px", "border-bottom": "1px solid #dadce0" });
  setStyles(clientSelector, { padding: "2px 4px", border: "1px solid #9aa0a6", "border-radius": "4px", background: "#ffffff", color: "#202124", "font-family": "system-ui, sans-serif", "font-size": "16px", "font-weight": "700", cursor: "pointer" });
  setStyles(account, { flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", color: "#5f6368", "font-size": "12px" });
  for (const button of [refresh, settings, close]) setStyles(button, { all: "initial", display: "inline-block", padding: "2px 6px", border: "0", background: "transparent", color: "#374151", "font-family": "system-ui, sans-serif", "font-size": "18px", cursor: "pointer" });
  setStyles(body, { padding: "8px 0" });
  setStyles(message, { margin: "8px 12px", color: "#5f6368", "font-size": "13px" });
  setStyles(footer, { padding: "10px 12px", "border-top": "1px solid #dadce0" });
  setStyles(selectionSummary, { color: "#5f6368", "font-size": "12px" });
  setStyles(readButton, { all: "initial", float: "right", padding: "7px 12px", border: "0", "border-radius": "6px", background: "#2563eb", color: "#ffffff", "font-family": "system-ui, sans-serif", "font-size": "13px", cursor: "pointer" });
  setStyles(notice, { clear: "both", margin: "8px 0 0", "font-size": "12px", color: "#5f6368" });
  setStyles(autoSendIndicator, { margin: "8px 0 0", "font-size": "11px", color: "#5f6368" });
  panel.append(header, body, footer);
  header.append(clientSelector, account, refresh, settings, close);
  footer.append(selectionSummary, readButton, notice, autoSendIndicator);
  document.body.append(launcher, panel);

  clientSelector.addEventListener("change", () => {
    document.dispatchEvent(new CustomEvent<string>("primitive-io:client-select", { detail: clientSelector.value }));
  });
  document.addEventListener("primitive-io:client-select", (event: Event) => {
    const client = (event as CustomEvent<string>).detail;
    if (client === "github") {
      panel.style.display = "block";
      launcher.style.display = "none";
      clientSelector.value = "github";
    } else if (client === "dropbox") {
      panel.style.display = "none";
      launcher.style.display = "none";
    }
  });

  const entriesByTreeSha = new Map<string, GitHubEntry[]>();
  const expandedTreeShas = new Set<string>();
  const loadingTreeShas = new Set<string>();
  const selectedEntries = new Map<string, SelectedGitHubEntry>();
  let repositories: GitHubRepository[] = [];
  let activeRepository: GitHubRepository | undefined;
  let available = false;
  let autoSend = false;
  const setMessage = (text: string, color = "#5f6368"): void => { message.textContent = text; message.style.color = color; };
  const showNotice = (text: string, color = "#5f6368"): void => { notice.textContent = text; notice.style.color = color; };
  const renderFooter = (): void => {
    selectionSummary.textContent = `${selectedEntries.size} / ${maxSelections}件選択`;
    readButton.disabled = selectedEntries.size === 0;
    readButton.style.opacity = selectedEntries.size === 0 ? "0.5" : "1";
    readButton.style.cursor = selectedEntries.size === 0 ? "not-allowed" : "pointer";
    autoSendIndicator.textContent = `自動送信: ${autoSend ? "ON" : "OFF"}`;
  };

  function fileRow(entry: GitHubEntry, depth: number): HTMLElement {
    const row = makeElement("div");
    row.title = entry.path;
    setStyles(row, { display: "flex", "align-items": "center", gap: "6px", padding: `5px 12px 5px ${24 + depth * 16}px`, color: "#202124", "font-size": "13px", "overflow-wrap": "anywhere" });
    const key = `${activeRepository?.id ?? ""}:${entry.sha}:${entry.path}`;
    const checkbox = makeElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedEntries.has(key);
    setStyles(checkbox, { display: "inline-block", width: "16px", height: "16px", appearance: "auto", "flex": "0 0 auto", cursor: "pointer" });
    checkbox.setAttribute("aria-label", `${entry.name}を選択`);
    checkbox.addEventListener("change", () => {
      if (!activeRepository) { checkbox.checked = false; return; }
      if (checkbox.checked) {
        if (selectedEntries.size >= maxSelections) { checkbox.checked = false; showNotice(`選択できるファイルは最大${maxSelections}件です。`, "#b3261e"); return; }
        selectedEntries.set(key, { ...entry, repository: activeRepository });
      } else selectedEntries.delete(key);
      showNotice("");
      render();
    });
    row.append(checkbox, makeElement("span", `📄 ${entry.name}`));
    return row;
  }

  function renderTree(treeSha: string, depth: number, target: HTMLElement): void {
    const entries = entriesByTreeSha.get(treeSha);
    if (!entries) { target.append(makeElement("p", "読み込み中…")); return; }
    if (entries.length === 0) {
      const empty = makeElement("p", depth === 0 ? "このリポジトリは空です。" : "このフォルダは空です。");
      setStyles(empty, { margin: "8px 12px", color: "#5f6368", "font-size": "13px" });
      target.append(empty);
      return;
    }
    for (const entry of entries) {
      if (entry.type === "file") { target.append(fileRow(entry, depth)); continue; }
      if (entry.type !== "dir") {
        const unsupported = makeElement("div", `${entry.type === "symlink" ? "↗" : "◌"} ${entry.name}`);
        unsupported.title = `${entry.path}（${entry.type} は選択できません）`;
        setStyles(unsupported, { padding: `5px 12px 5px ${24 + depth * 16}px`, color: "#9aa0a6", "font-size": "13px", "overflow-wrap": "anywhere" });
        target.append(unsupported);
        continue;
      }
      const folder = makeElement("button");
      folder.type = "button";
      const expanded = expandedTreeShas.has(entry.sha);
      folder.textContent = `${expanded ? "▼" : "▶"} 📁 ${entry.name}`;
      folder.title = entry.path;
      setStyles(folder, { all: "initial", display: "block", width: "100%", "box-sizing": "border-box", padding: `5px 12px 5px ${8 + depth * 16}px`, border: "0", background: "transparent", color: "#202124", "font-family": "system-ui, sans-serif", "font-size": "13px", "text-align": "left", cursor: "pointer", "overflow-wrap": "anywhere" });
      folder.addEventListener("click", () => {
        if (expandedTreeShas.has(entry.sha)) { expandedTreeShas.delete(entry.sha); render(); return; }
        expandedTreeShas.add(entry.sha);
        void loadTree(entry.sha, entry.path);
      });
      target.append(folder);
      if (expanded) {
        const children = makeElement("div");
        target.append(children);
        if (loadingTreeShas.has(entry.sha)) children.append(makeElement("p", "読み込み中…"));
        else renderTree(entry.sha, depth + 1, children);
      }
    }
  }

  function renderRepositories(): void {
    if (repositories.length === 0) {
      const empty = makeElement("p", "表示できるリポジトリはありません。");
      setStyles(empty, { margin: "8px 12px", color: "#5f6368", "font-size": "13px" });
      body.append(empty);
      return;
    }
    for (const repository of repositories) {
      const row = makeElement("button", `${repository.private ? "🔒" : "◫"} ${repository.fullName}  (${repository.defaultBranch})`);
      row.type = "button";
      row.title = repository.fullName;
      setStyles(row, { all: "initial", display: "block", width: "100%", "box-sizing": "border-box", padding: "6px 12px", border: "0", background: "transparent", color: "#202124", "font-family": "system-ui, sans-serif", "font-size": "13px", "text-align": "left", cursor: "pointer", "overflow-wrap": "anywhere" });
      row.addEventListener("click", () => {
        activeRepository = repository;
        entriesByTreeSha.clear(); expandedTreeShas.clear(); loadingTreeShas.clear(); selectedEntries.clear(); showNotice("");
        void loadTree(repository.defaultBranch, "");
      });
      body.append(row);
    }
  }

  function render(): void {
    body.replaceChildren();
    if (!available) {
      body.append(message);
    }
    else if (!activeRepository) renderRepositories();
    else {
      const back = makeElement("button", "‹ リポジトリ一覧へ戻る");
      back.type = "button";
      setStyles(back, { all: "initial", display: "block", padding: "6px 12px", color: "#2563eb", "font-family": "system-ui, sans-serif", "font-size": "13px", cursor: "pointer" });
      back.addEventListener("click", () => { activeRepository = undefined; entriesByTreeSha.clear(); expandedTreeShas.clear(); loadingTreeShas.clear(); selectedEntries.clear(); render(); });
      body.append(back);
      renderTree(activeRepository.defaultBranch, 0, body);
    }
    renderFooter();
  }

  async function loadTree(treeSha: string, path: string): Promise<void> {
    if (!activeRepository || loadingTreeShas.has(treeSha) || entriesByTreeSha.has(treeSha)) { render(); return; }
    loadingTreeShas.add(treeSha);
    render();
    try {
      entriesByTreeSha.set(treeSha, await listDirectory(activeRepository, path, treeSha));
    } catch (error) {
      expandedTreeShas.delete(treeSha);
      const errorMessage = error instanceof Error ? error.message : "GitHubディレクトリを取得できませんでした。";
      showNotice(errorMessage, "#b3261e");
      if (path.length === 0) { activeRepository = undefined; setMessage(errorMessage, "#b3261e"); }
    } finally { loadingTreeShas.delete(treeSha); render(); }
  }

  async function start(force = false): Promise<void> {
    try {
      const status = await authStatus();
      if (!status.connected) {
        available = false; account.textContent = "未接続";
        setMessage("GitHubへ接続してください。設定画面でfine-grained PATを登録します。", "#b3261e"); render(); return;
      }
      account.textContent = status.account?.login ?? "接続済み";
      available = true;
      if (force || repositories.length === 0) repositories = await listRepositories();
      render();
    } catch (error) {
      available = false; account.textContent = "エラー";
      setMessage(error instanceof Error ? error.message : "GitHub接続状態を確認できませんでした。", "#b3261e"); render();
    }
  }

  refresh.addEventListener("click", () => {
    repositories = []; activeRepository = undefined; entriesByTreeSha.clear(); expandedTreeShas.clear(); loadingTreeShas.clear(); selectedEntries.clear(); showNotice(""); void start(true);
  });
  settings.addEventListener("click", async () => {
    try {
      await openOptionsPage();
      showNotice("設定画面を開きました。", "#137333");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "不明なエラー";
      showNotice(`設定画面を開けませんでした: ${detail}`, "#b3261e");
    }
  });
  readButton.addEventListener("click", async () => {
    const prompt = buildGitHubPrompt(selectedEntries.values());
    const result = insertTextIntoEmptyComposer(prompt);
    if (!result.ok) { showNotice(result.message, "#b3261e"); return; }
    autoSend = await getAutoSend(); renderFooter();
    if (!autoSend) { showNotice("プロンプトを入力欄へ投入しました。送信はしていません。", "#137333"); return; }
    const sendResult = await sendComposer();
    showNotice(sendResult.ok ? "プロンプトを投入して送信しました。" : sendResult.message, sendResult.ok ? "#137333" : "#b3261e");
  });
  close.addEventListener("click", () => { panel.style.display = "none"; launcher.style.display = "block"; });
  launcher.addEventListener("click", () => { launcher.style.display = "none"; panel.style.display = "block"; });
  void getAutoSend().then((enabled) => { autoSend = enabled; renderFooter(); });
  void start();
}
