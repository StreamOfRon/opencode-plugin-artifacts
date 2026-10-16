import { Plugin } from "@opencode/plugin/tui";
import { createSignal, onCleanup } from "solid-js";

function LatestLink({ latest }) {
  if (!latest) return null;
  return (
    <text href={latest.renderURL} class="artifact-link">
      {latest.slug} → {latest.renderURL.length > 64 ? latest.renderURL.slice(0, 61) + "..." : latest.renderURL}
    </text>
  );
}

export default Plugin.define({
  id: "opencode-artifacts",
  setup(context) {
    let hasFiredToast = false;

    const [latest, setLatest] = context.storage.store("lastPublished", {
      initial: null,
    });

    const refresh = () => {
      context.storage.get("lastPublished").then((data) => {
        if (!data) {
          setLatest(null);
          return;
        }
        const d = data;
        // Only toast when `at` timestamp actually changed (new publish)
        const prevAt = latest()?.at;
        if (d && d.at && d.at !== prevAt) {
          if (!hasFiredToast) {
            hasFiredToast = true;
            context.ui.toast.show({
              title: "Artifact published",
              message: d.renderURL || d.url,
              variant: "success",
            });
          }
        }
        setLatest(d);
      });
    };

    // React to server events (debounced ~1s)
    const stop = context.data.listen(() => {
      setTimeout(refresh, 1000);
    });

    // 5s interval backstop
    const timer = setInterval(refresh, 5000);

    // Register footer slots
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => <LatestLink latest={latest} />,
    });

    context.ui.slot({
      append: "home.footer.status",
      render: () => <LatestLink latest={latest} />,
    });

    // Cleanup on plugin unload
    onCleanup(() => {
      stop();
      clearInterval(timer);
    });
  },
});
