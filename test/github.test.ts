import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { connectGitHub, disconnectGitHub } from "../src/background/githubAuth";
import { listGitHubDirectory, listGitHubRepositories } from "../src/background/githubClient";

type Values = Record<string, unknown>;
let stored: Values;
let responses: Array<Response | Error>;
let calls: Array<[RequestInfo | URL, RequestInit | undefined]>;

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function installBrowser(values: Values = {}): void {
  stored = values;
  responses = [];
  calls = [];
  const local = {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in stored).map((key) => [key, stored[key]])),
    set: async (valuesToSet: Values) => { Object.assign(stored, valuesToSet); },
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
  };
  (globalThis as unknown as { browser: unknown }).browser = { storage: { local } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init]);
    const result = responses.shift();
    if (!result) throw new Error("Unexpected fetch");
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
}

beforeEach(() => installBrowser());

describe("githubAuth", () => {
  it("rejects a blank PAT without making a request or saving", async () => {
    await assert.rejects(connectGitHub(" \n "), /PATを入力/);
    assert.deepEqual(stored, {});
    assert.equal(calls.length, 0);
  });

  it("trims and saves a PAT only after GET /user succeeds", async () => {
    responses.push(json({ login: "octocat", id: 1 }));
    assert.deepEqual(await connectGitHub("  github_pat_example  "), { connected: true, account: { login: "octocat", id: 1 } });
    assert.equal(calls[0][0], "https://api.github.com/user");
    assert.match(String((calls[0][1]?.headers as Record<string, string>).Authorization), /github_pat_example$/);
    assert.deepEqual(stored.githubTokens, { token: "github_pat_example" });
    assert.deepEqual(stored.githubAccount, { login: "octocat", id: 1 });
  });

  it("does not save an invalid PAT", async () => {
    responses.push(json({}, 401));
    await assert.rejects(connectGitHub("invalid"), /無効/);
    assert.deepEqual(stored, {});
  });

  it("disconnect removes GitHub keys but preserves Dropbox keys", async () => {
    installBrowser({ githubTokens: { token: "token" }, githubAccount: { login: "octocat", id: 1 }, githubStorageSchemaVersion: 1, dropboxTokens: { accessToken: "dropbox" } });
    assert.deepEqual(await disconnectGitHub(), { connected: false });
    assert.deepEqual(stored, { dropboxTokens: { accessToken: "dropbox" } });
  });
});

describe("githubClient", () => {
  beforeEach(() => installBrowser({ githubTokens: { token: "test-token" }, githubAccount: { login: "octocat", id: 1 } }));

  it("paginates repository metadata", async () => {
    responses.push(
      json([{ id: 1, name: "one", full_name: "octo/one", private: false, default_branch: "main", owner: { login: "octo" } }], 200, { Link: '<https://api.github.com/user/repos?page=2>; rel="next"' }),
      json([{ id: 2, name: "two", full_name: "octo/two", private: true, default_branch: "trunk", owner: { login: "octo" } }])
    );
    assert.deepEqual(await listGitHubRepositories(), [
      { id: "1", owner: "octo", name: "one", fullName: "octo/one", private: false, defaultBranch: "main" },
      { id: "2", owner: "octo", name: "two", fullName: "octo/two", private: true, defaultBranch: "trunk" }
    ]);
    assert.match(String(calls[0][0]), /per_page=100/);
    assert.match(String(calls[1][0]), /page=2/);
  });

  it("encodes segments and normalizes a non-recursive tree", async () => {
    responses.push(json({ truncated: false, tree: [
      { path: "src", sha: "tree", type: "tree", mode: "040000" },
      { path: "run.sh", sha: "exec", type: "blob", mode: "100755" },
      { path: "link", sha: "link", type: "blob", mode: "120000" },
      { path: "module", sha: "module", type: "commit", mode: "160000" }
    ] }));
    assert.deepEqual(await listGitHubDirectory("octo org", "repo#1", "main", "parent", "tree/sha"), [
      { name: "src", path: "parent/src", sha: "tree", type: "dir" },
      { name: "run.sh", path: "parent/run.sh", sha: "exec", type: "file" },
      { name: "link", path: "parent/link", sha: "link", type: "symlink" },
      { name: "module", path: "parent/module", sha: "module", type: "submodule" }
    ]);
    assert.equal(calls[0][0], "https://api.github.com/repos/octo%20org/repo%231/git/trees/tree%2Fsha");
  });

  it("rejects truncated trees without returning partial entries", async () => {
    responses.push(json({ truncated: true, tree: [{ path: "partial", sha: "x", type: "blob", mode: "100644" }] }));
    await assert.rejects(listGitHubDirectory("octo", "repo", "main", "", "main"), (error: unknown) => (error as { code?: string }).code === "DIRECTORY_TOO_LARGE");
  });

  it("normalizes rate limits using Retry-After", async () => {
    responses.push(json({}, 429, { "Retry-After": "120" }));
    await assert.rejects(listGitHubRepositories(), (error: unknown) => (error as { code?: string; message?: string }).code === "RATE_LIMITED" && error.message?.includes("2分後"));
  });

  it("normalizes a fetch failure without exposing request details", async () => {
    responses.push(new TypeError("Failed to fetch"));
    await assert.rejects(
      listGitHubDirectory("octo", "network-test", "main", "", "network-test"),
      (error: unknown) => (error as { code?: string; message?: string }).code === "NETWORK_FAILURE" && error.message === "GitHub APIへ接続できませんでした。ネットワーク接続を確認してください。"
    );
  });
});
import { buildGitHubPrompt } from "../src/content/githubExplorer";

describe("GitHub prompt", () => {
  it("preserves repository, default ref, and unencoded paths for one or more files", () => {
    const prompt = buildGitHubPrompt([
      { name: "仕様 #1.md", path: "docs/日本語/仕様 #1.md", sha: "a", type: "file", repository: { id: "1", owner: "octo", name: "repo", fullName: "octo/repo", private: true, defaultBranch: "main" } },
      { name: "index.ts", path: "src/index.ts", sha: "b", type: "file", repository: { id: "1", owner: "octo", name: "repo", fullName: "octo/repo", private: true, defaultBranch: "main" } }
    ]);
    assert.match(prompt, /repository: octo\/repo\n  ref: main\n  path: docs\/日本語\/仕様 #1\.md/);
    assert.match(prompt, /repository: octo\/repo\n  ref: main\n  path: src\/index\.ts/);
    assert.ok(!prompt.includes("%23"));
  });
});
