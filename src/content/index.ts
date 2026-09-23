import { mountDropboxExplorer } from "./dropboxExplorer";
import { mountGitHubExplorer } from "./githubExplorer";

function mount(): void {
  mountDropboxExplorer();
  mountGitHubExplorer();
  void browser.runtime.sendMessage({
    type: "primitive-io:content-mounted",
    href: location.href
  }).catch(() => undefined);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
