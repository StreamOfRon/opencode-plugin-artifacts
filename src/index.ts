import { Plugin } from "@opencode/plugin";
import {
  resolveToken,
  publishArtifact,
  GistRef,
} from "./publish.js";

export default Plugin.define({
  id: "opencode-artifacts",
  setup(ctx) {
    // ── Tool: publish_artifact ─────────────────────────────────────────────

    ctx.tool.transform((editor) =>
      editor.add({
        name: "publish_artifact",
        description:
          "Publishes an HTML file to a stable, in-place-updating secret Gist and returns the links. " +
          "The Gist is secret by default; use visibility='public' to make it public.",
        input: {
          type: "object" as const,
          properties: {
            slug: { type: "string" as const },
            file: { type: "string" as const },
            title: { type: "string" as const },
            visibility: {
              type: "string" as const,
              enum: ["secret", "public"],
            },
          },
          required: ["slug", "file"],
          additionalProperties: false,
        },
        execute: async (args: any, ctx: any) => {
          // Resolve token
          const token = await resolveToken();

          // Resolve title default
          const title = args.title || args.slug;

          // Resolve visibility default
          const visibility = args.visibility || "secret";

          // Look up existing mapping
          const existingRaw = await ctx.storage.get(
            `artifact:${args.slug}`
          );
          const existing: GistRef | undefined = existingRaw
            ? (existingRaw as GistRef)
            : undefined;

          // Call publishArtifact
          const result = await publishArtifact({
            token,
            slug: args.slug,
            file: args.file,
            title,
            visibility,
            existing,
          });

          // Save mapping to storage
          await ctx.storage.set(
            `artifact:${args.slug}`,
            result.ref
          );

          // Save lastPublished for TUI toast trigger
          await ctx.storage.set("lastPublished", {
            slug: args.slug,
            url: result.rawURL,
            renderURL: result.renderURL,
            at: new Date().toISOString(),
          });

          // Build status label
          let status: string;
          if (result.created && !result.adopted) status = "created";
          else if (result.adopted) status = "adopted";
          else status = "updated";

          let content = `Published ${args.slug} (${status}) — render: ${result.renderURL}\nGist: ${result.gistURL}\nRaw: ${result.rawURL}`;
          if (result.warning) {
            content += `\n⚠️  ${result.warning}`;
          }
          content +=
            "\nNote: viewers may see the previous snapshot for up to ~5 minutes after an update (GitHub edge cache).";

          return { content };
        },
      })
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
