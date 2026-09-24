/** GitHub.com only. Enterprise Server is intentionally out of scope for v0.2.0. */
export const githubApiBaseUrl = "https://api.github.com";
export const githubApiVersion = "2026-03-10";

export function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": githubApiVersion,
    "User-Agent": "Primitive-IO"
  };
}
