import { Plugin } from "@opencode/plugin";
import { createPublishArtifactTool } from "./tool.ts";

export default Plugin.define({
  id: "opencode-artifacts",
  setup(ctx) {
    // Tool execution contexts do not include plugin storage, so capture the
    // setup context's storage here and use it for the artifact mapping.
    const storage = ctx.storage;

    // ── Tool: publish_artifact ─────────────────────────────────────────────

    ctx.tool.transform((editor) =>
      editor.add(createPublishArtifactTool(storage))
    );

    // ── Command: /board ────────────────────────────────────────────────────

    ctx.command.transform((editor) =>
      editor.add({
        name: "board",
        description:
          "Update the PR board for the current repo",
        execute: async ({
          sessionID,
          prompt,
          delivery,
        }: {
          sessionID: string;
          prompt: (opts: any) => Promise<any>;
          delivery: any;
        }) => {
          await ctx.session.prompt({
            sessionID,
            prompt,
            text:
              "Update the PR board for the current repository. Use the pr-board skill.",
            delivery,
          });
        },
      })
    );
  },
});
