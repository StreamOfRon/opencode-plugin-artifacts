import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// ─── Error classes ──────────────────────────────────────────────────────────

export class PublishError extends Error {
  hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "PublishError";
    this.hint = hint;
  }
}

export class AuthError extends PublishError {
  code = "auth";

  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class GistDeletedError extends PublishError {
  code = "deleted";

  constructor() {
    super("Gist no longer exists (404)");
    this.name = "GistDeletedError";
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type GistRef = {
  gistID: string;
  owner: string;
  url: string;
};

export type PublishResult = {
  created: boolean;
  adopted: boolean;
  warning?: string;
  ref: GistRef;
  gistURL: string;
  rawURL: string;
  renderURL: string;
};

// ─── URL builders ───────────────────────────────────────────────────────────

export function stableRawURL(owner: string, gistID: string): string {
  return `https://gist.githubusercontent.com/${owner}/${gistID}/raw`;
}

export function renderURL(rawURL: string): string {
  return `https://htmlpreview.github.io/?${rawURL}`;
}

export function gistURL(owner: string, gistID: string): string {
  return `https://gist.github.com/${owner}/${gistID}`;
}

// ─── Token resolution ───────────────────────────────────────────────────────

const GH_TOKEN_REMEDIATION =
  "install gh: brew install gh; then gh auth login — the token needs the gist scope";

export async function resolveToken(
  env: NodeJS.ProcessEnv = process.env,
  exec?: (
    cmd: string[]
  ) => Promise<{ ok: boolean; stdout: string }>
): Promise<string> {
  // Try gh auth token via exec or child_process.spawn
  if (exec) {
    const result = await exec(["gh", "auth", "token"]);
    if (result.ok && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } else {
    const { stdout, status } = await new Promise<{
      stdout: string;
      status: number | null;
    }>((resolve, reject) => {
      const proc = spawn("gh", ["auth", "token"], {
        env: { ...process.env, ...env },
      });
      let stdout = "";
      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.on("close", (code) => {
        resolve({ stdout, status: code });
      });
      proc.on("error", (err) => {
        reject(err);
      });
    });
    if (status === 0 && stdout.trim()) {
      return stdout.trim();
    }
  }

  // Fall back to env vars
  if (env.GH_TOKEN) return env.GH_TOKEN;
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;

  // No token available
  throw new PublishError(GH_TOKEN_REMEDIATION);
}

// ─── Gist API helpers ────────────────────────────────────────────────────────

const API_BASE = "https://api.github.com";

async function apiFetch(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  method: string = "GET",
  body?: object
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetchImpl(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 404 → GistDeletedError (update path)
  if (res.status === 404) {
    throw new GistDeletedError();
  }

  // 401/403 → AuthError
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(
      "Authentication failed — check your token has the gist scope"
    );
  }

  // Any other non-2xx → PublishError with GitHub's message
  if (!res.ok) {
    let message = `GitHub API ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || message;
    } catch {
      // ignore JSON parse errors — use status message
    }
    throw new PublishError(message);
  }

  return res.json();
}

// ─── Gist operations ────────────────────────────────────────────────────────

export async function createGist(
  token: string,
  input: { title: string; content: string; visibility: "secret" | "public" },
  fetchImpl: typeof fetch = fetch
): Promise<GistRef> {
  const body = {
    description: input.title,
    files: {
      "index.html": {
        content: input.content,
      },
    },
    public: input.visibility === "public",
  };

  const data: any = await apiFetch(
    fetchImpl,
    token,
    `${API_BASE}/gists`,
    "POST",
    body
  );

  return {
    gistID: data.id,
    owner: data.owner.login,
    url: data.html_url,
  };
}

export async function updateGist(
  token: string,
  gistID: string,
  content: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const body = {
    files: {
      "index.html": {
        content,
      },
    },
  };

  await apiFetch(
    fetchImpl,
    token,
    `${API_BASE}/gists/${gistID}`,
    "PATCH",
    body
  );
}

export async function listGists(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<
  Array<{ id: string; owner: string; description: string | null }>
> {
  const data: any[] = await apiFetch(
    fetchImpl,
    token,
    `${API_BASE}/gists`
  );

  return data.map((g) => ({
    id: g.id,
    owner: g.owner.login,
    description: g.description,
  }));
}

// ─── Main publish function ──────────────────────────────────────────────────

export async function publishArtifact(
  input: {
    token: string;
    slug: string;
    file: string;
    title: string;
    visibility: "secret" | "public";
    existing?: GistRef;
  },
  fetchImpl: typeof fetch = fetch
): Promise<PublishResult> {
  // Read the file
  let content: string;
  try {
    content = await readFile(input.file, "utf-8");
  } catch (err: any) {
    throw new PublishError(
      `Could not read file: ${input.file} — ${err.message || "file not found"}`
    );
  }

  // If we have an existing gist, update it
  if (input.existing) {
    try {
      await updateGist(
        input.token,
        input.existing.gistID,
        content,
        fetchImpl
      );
      return {
        created: false,
        adopted: false,
        ref: input.existing,
        gistURL: input.existing.url,
        rawURL: stableRawURL(
          input.existing.owner,
          input.existing.gistID
        ),
        renderURL: renderURL(
          stableRawURL(
            input.existing.owner,
            input.existing.gistID
          )
        ),
      };
    } catch (err: any) {
      if (err instanceof GistDeletedError) {
        // Gist was deleted out from under us — recreate
        const newRef = await createGist(
          input.token,
          {
            title: input.title,
            content,
            visibility: input.visibility,
          },
          fetchImpl
        );
        return {
          created: true,
          adopted: false,
          ref: newRef,
          gistURL: newRef.url,
          rawURL: stableRawURL(newRef.owner, newRef.gistID),
          renderURL: renderURL(
            stableRawURL(newRef.owner, newRef.gistID)
          ),
        };
      }
      throw err;
    }
  }

  // No existing — adopt or create
  const gists = await listGists(input.token, fetchImpl);
  const matches = gists.filter(
    (g) => g.description === input.title
  );

  if (matches.length === 1) {
    // Exactly one match — adopt
    const match = matches[0];
    await updateGist(
      input.token,
      match.id,
      content,
      fetchImpl
    );
    return {
      created: false,
      adopted: true,
      ref: {
        gistID: match.id,
        owner: match.owner,
        url: `https://gist.github.com/${match.owner}/${match.id}`,
      },
      gistURL: `https://gist.github.com/${match.owner}/${match.id}`,
      rawURL: stableRawURL(match.owner, match.id),
      renderURL: renderURL(stableRawURL(match.owner, match.id)),
    };
  }

  // Zero or more-than-one — create fresh
  const warning =
    matches.length > 1
      ? `Found ${matches.length} gists matching title "${input.title}" — creating a new one to avoid ambiguity.`
      : undefined;

  const newRef = await createGist(
    input.token,
    {
      title: input.title,
      content,
      visibility: input.visibility,
    },
    fetchImpl
  );

  return {
    created: true,
    adopted: false,
    warning,
    ref: newRef,
    gistURL: newRef.url,
    rawURL: stableRawURL(newRef.owner, newRef.gistID),
    renderURL: renderURL(
      stableRawURL(newRef.owner, newRef.gistID)
    ),
  };
}
