import {
  resolveToken,
  publishArtifact,
  type GistRef,
  type PublishResult,
} from "./publish.ts";

export type ArtifactStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: any): Promise<void>;
};

export type PublishArgs = {
  slug: string;
  file: string;
  title?: string;
  visibility?: "secret" | "public";
};

type PublishDeps = {
  resolveToken?: () => Promise<string>;
  publishArtifact?: (
    input: Parameters<typeof publishArtifact>[0]
  ) => Promise<PublishResult>;
};

// Storage is supplied by the plugin setup context, not by the tool execution
// context (Tool.Context has no `storage` field). Treat it as best-effort so a
// publish still succeeds when storage is unavailable — for example when the
// tool is invoked through Code Mode.
async function loadExisting(
  storage: ArtifactStorage | undefined,
  slug: string
): Promise<GistRef | undefined> {
  if (!storage) return undefined;
  try {
    const raw = await storage.get(`artifact:${slug}`);
    return raw ? (raw as GistRef) : undefined;
  } catch {
    return undefined;
  }
}

async function savePublished(
  storage: ArtifactStorage | undefined,
  slug: string,
  result: PublishResult
): Promise<void> {
  if (!storage) return;
  try {
    await storage.set(`artifact:${slug}`, result.ref);

    // Save lastPublished for the TUI footer/toast trigger
    await storage.set("lastPublished", {
      slug,
      url: result.rawURL,
      renderURL: result.renderURL,
      at: new Date().toISOString(),
    });
  } catch {
    // The Gist is the source of truth; failing to persist a convenience
    // mapping must not turn a successful publish into an error.
  }
}

export function createPublishArtifactTool(
  storage: ArtifactStorage | undefined,
  deps: PublishDeps = {}
) {
  return {
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
    execute: async (
      args: PublishArgs,
      toolCtx?: { storage?: ArtifactStorage }
    ) => executePublishArtifact(args, toolCtx?.storage ?? storage, deps),
  };
}

export async function executePublishArtifact(
  args: PublishArgs,
  storage: ArtifactStorage | undefined,
  deps: PublishDeps = {}
): Promise<{ content: string }> {
  const resolve = deps.resolveToken ?? resolveToken;
  const publish = deps.publishArtifact ?? publishArtifact;

  // Resolve token
  const token = await resolve();

  // Resolve title default
  const title = args.title || args.slug;

  // Resolve visibility default
  const visibility = args.visibility || "secret";

  // Look up existing mapping
  const existing = await loadExisting(storage, args.slug);

  // Call publishArtifact
  const result = await publish({
    token,
    slug: args.slug,
    file: args.file,
    title,
    visibility,
    existing,
  });

  // Save mapping and lastPublished for the TUI footer/toast
  await savePublished(storage, args.slug, result);

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
}
