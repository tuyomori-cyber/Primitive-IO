const authorizationEndpoint = "https://www.dropbox.com/oauth2/authorize";
const tokenEndpoint = "https://api.dropboxapi.com/oauth2/token";
const currentAccountEndpoint = "https://api.dropboxapi.com/2/users/get_current_account";
const revokeTokenEndpoint = "https://api.dropboxapi.com/2/auth/token/revoke";

const storageKeys = {
  appKey: "dropboxAppKey",
  tokens: "dropboxTokens",
  account: "dropboxAccount"
} as const;

type DropboxTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type DropboxAccount = {
  accountId: string;
  displayName: string;
  email: string;
};

export type DropboxAuthStatus = {
  appKey: string;
  redirectUri: string;
  connected: boolean;
  account?: DropboxAccount;
};

type DropboxTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type DropboxAccountResponse = {
  account_id: string;
  email: string;
  name: { display_name: string };
};

function asBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return asBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return asBase64Url(new Uint8Array(digest));
}

async function readAppKey(): Promise<string> {
  const values = await browser.storage.local.get(storageKeys.appKey);
  return typeof values[storageKeys.appKey] === "string" ? values[storageKeys.appKey].trim() : "";
}

async function readTokens(): Promise<DropboxTokens | undefined> {
  const values = await browser.storage.local.get(storageKeys.tokens);
  const tokens = values[storageKeys.tokens];
  if (
    typeof tokens === "object" &&
    tokens !== null &&
    "accessToken" in tokens &&
    "refreshToken" in tokens &&
    "expiresAt" in tokens &&
    typeof tokens.accessToken === "string" &&
    typeof tokens.refreshToken === "string" &&
    typeof tokens.expiresAt === "number"
  ) {
    return tokens as DropboxTokens;
  }

  return undefined;
}

async function tokenRequest(parameters: URLSearchParams): Promise<DropboxTokenResponse> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters
  });

  if (!response.ok) {
    throw new Error(`Dropboxトークン取得に失敗しました（HTTP ${response.status}）。`);
  }

  return response.json() as Promise<DropboxTokenResponse>;
}

function saveTokens(response: DropboxTokenResponse, existingRefreshToken?: string): Promise<void> {
  const refreshToken = response.refresh_token ?? existingRefreshToken;
  if (!refreshToken) {
    return Promise.reject(new Error("Dropboxからリフレッシュトークンが返されませんでした。"));
  }

  const tokens: DropboxTokens = {
    accessToken: response.access_token,
    refreshToken,
    // Refresh before actual expiry to avoid a request racing an expired token.
    expiresAt: Date.now() + Math.max(response.expires_in - 60, 0) * 1_000
  };
  return browser.storage.local.set({ [storageKeys.tokens]: tokens });
}

export async function getDropboxAccessToken(): Promise<string> {
  const appKey = await readAppKey();
  const tokens = await readTokens();
  if (!appKey || !tokens) {
    throw new Error("Dropboxに接続されていません。");
  }

  if (Date.now() < tokens.expiresAt) {
    return tokens.accessToken;
  }

  const parameters = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: appKey
  });
  const refreshed = await tokenRequest(parameters);
  await saveTokens(refreshed, tokens.refreshToken);
  return refreshed.access_token;
}

async function fetchAccount(accessToken: string): Promise<DropboxAccount> {
  const response = await fetch(currentAccountEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: "null"
  });

  if (!response.ok) {
    throw new Error(`Dropboxアカウント情報の取得に失敗しました（HTTP ${response.status}）。`);
  }

  const account = await response.json() as DropboxAccountResponse;
  return {
    accountId: account.account_id,
    displayName: account.name.display_name,
    email: account.email
  };
}

export async function getDropboxAuthStatus(): Promise<DropboxAuthStatus> {
  const [appKey, account, tokens] = await Promise.all([
    readAppKey(),
    browser.storage.local.get(storageKeys.account),
    readTokens()
  ]);
  const storedAccount = account[storageKeys.account] as DropboxAccount | undefined;

  return {
    appKey,
    redirectUri: browser.identity.getRedirectURL(),
    connected: tokens !== undefined && storedAccount !== undefined,
    account: storedAccount
  };
}

export async function saveDropboxAppKey(appKey: string): Promise<DropboxAuthStatus> {
  const normalizedAppKey = appKey.trim();
  if (!normalizedAppKey) {
    throw new Error("Dropbox App keyを入力してください。");
  }

  await browser.storage.local.set({ [storageKeys.appKey]: normalizedAppKey });
  await browser.storage.local.remove([storageKeys.tokens, storageKeys.account]);
  return getDropboxAuthStatus();
}

export async function connectDropbox(): Promise<DropboxAuthStatus> {
  const appKey = await readAppKey();
  if (!appKey) {
    throw new Error("先にDropbox App keyを保存してください。");
  }

  const redirectUri = browser.identity.getRedirectURL();
  const state = randomBase64Url();
  const verifier = randomBase64Url(64);
  const challenge = await createCodeChallenge(verifier);
  const authorizationUrl = new URL(authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: redirectUri,
    token_access_type: "offline",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "files.metadata.read account_info.read",
    include_granted_scopes: "user"
  }).toString();

  const returnedUrl = await browser.identity.launchWebAuthFlow({
    url: authorizationUrl.toString(),
    interactive: true
  });
  const result = new URL(returnedUrl);
  if (result.searchParams.get("state") !== state) {
    throw new Error("Dropbox認証のstate検証に失敗しました。");
  }

  const authorizationError = result.searchParams.get("error");
  if (authorizationError) {
    throw new Error(`Dropbox認証が完了しませんでした（${authorizationError}）。`);
  }

  const code = result.searchParams.get("code");
  if (!code) {
    throw new Error("Dropbox認証コードを受け取れませんでした。");
  }

  const tokens = await tokenRequest(new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: appKey
  }));
  await saveTokens(tokens);

  const account = await fetchAccount(tokens.access_token);
  await browser.storage.local.set({ [storageKeys.account]: account });
  return getDropboxAuthStatus();
}

export async function disconnectDropbox(): Promise<DropboxAuthStatus> {
  const tokens = await readTokens();
  if (tokens) {
    try {
      await fetch(revokeTokenEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.accessToken}` }
      });
    } catch {
      // Local credentials must still be removed even if the remote revoke fails.
    }
  }

  await browser.storage.local.remove([storageKeys.tokens, storageKeys.account]);
  return getDropboxAuthStatus();
}

export async function verifyDropboxConnection(): Promise<DropboxAuthStatus> {
  const account = await fetchAccount(await getDropboxAccessToken());
  await browser.storage.local.set({ [storageKeys.account]: account });
  return getDropboxAuthStatus();
}
