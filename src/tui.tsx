import { Plugin } from "@opencode/plugin/tui";
import {
  createElement,
  createTextNode,
  setProp,
  insertNode,
} from "@opentui/solid";

type LastPublished = {
  slug?: string;
  url?: string;
  renderURL?: string;
  at?: string;
};

function LatestLink({ latest }: { latest: LastPublished }) {
  if (!latest.slug || !latest.renderURL) return null;
  const url =
    latest.renderURL.length > 64
      ? latest.renderURL.slice(0, 61) + "..."
      : latest.renderURL;
  const textEl = createElement("text");
  setProp(textEl, "href", latest.renderURL);
  setProp(textEl, "class", "artifact-link");
  const textNode = createTextNode(latest.slug + " \u2192 " + url);
  insertNode(textEl, textNode);
  return textEl;
}

export default Plugin.define({
  id: "opencode-artifacts",
  setup(context) {
    // Live store (solid-js store proxy): read properties directly. Stays in
    // sync with the server-side `lastPublished` writes across TUI instances,
    // so no polling or local signal is needed.
    const [latest] = context.storage.store<LastPublished>("lastPublished", {
      initial: {},
    });

    // Toast when a new publish lands; seed from persisted state so a TUI
    // restart does not re-toast the previous session's artifact.
    let lastToastAt = latest.at;
    const checkToast = () => {
      const at = latest.at;
      if (at && at !== lastToastAt) {
        lastToastAt = at;
        context.ui.toast.show({
          title: "Artifact published",
          message: latest.renderURL || latest.url,
          variant: "success",
        });
      }
    };

    // React to server events (debounced ~1s)
    const stop = context.data.listen(() => {
      setTimeout(checkToast, 1000);
    });

    // 5s interval backstop
    const timer = setInterval(checkToast, 5000);

    // Register footer slots
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => LatestLink({ latest }),
    });

    context.ui.slot({
      append: "home.footer.status",
      render: () => LatestLink({ latest }),
    });

    // Cleanup on plugin unload
    return () => {
      stop();
      clearInterval(timer);
    };
  },
});
