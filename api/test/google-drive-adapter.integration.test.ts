import { describe, expect, test } from "vitest";
import { GoogleDriveAdapter } from "../src/storage/google-drive-adapter.js";

type DriveFile = { id: string; name: string; mimeType: string; createdTime: string; parents?: string[]; appProperties?: Record<string, string>; trashed?: boolean };
const folderMime = "application/vnd.google-apps.folder";

function fakeDrive() {
  const files = new Map<string, DriveFile>([
    ["public", { id: "public", name: "public", mimeType: folderMime, createdTime: "2026-01-01T00:00:00.000Z" }],
    ["private", { id: "private", name: "private", mimeType: folderMime, createdTime: "2026-01-01T00:00:00.000Z" }],
    ["inbox", { id: "inbox", name: "Inbox", mimeType: folderMime, createdTime: "2026-01-01T00:00:00.000Z", parents: ["public"] }],
    ["nested", { id: "nested", name: "Nested", mimeType: folderMime, createdTime: "2026-01-01T00:00:00.000Z", parents: ["inbox"] }],
    ["image", { id: "image", name: "diagram.png", mimeType: "image/png", createdTime: "2026-01-02T00:00:00.000Z", parents: ["nested"], appProperties: { "weird'key": "value\\x" } }],
  ]);
  const listCalls: Array<Record<string, unknown>> = [];
  const getCalls: Array<Record<string, unknown>> = [];
  const client = {
    files: {
      async get(params: Record<string, unknown>) {
        getCalls.push(params);
        if (params.alt === "media") return { data: Buffer.from("image bytes") };
        const file = files.get(String(params.fileId));
        if (!file) { const error = Object.assign(new Error("not found"), { code: 404 }); throw error; }
        return { data: file };
      },
      async list(params: Record<string, unknown>) {
        listCalls.push(params);
        const match = /^'(.+)' in parents and trashed = false$/.exec(String(params.q));
        if (!match) throw new Error(`unconstrained query: ${String(params.q)}`);
        const parentId = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
        const children = [...files.values()].filter((item) => item.parents?.includes(parentId) && !item.trashed);
        if (parentId === "inbox") {
          return params.pageToken === "next"
            ? { data: { files: children.slice(1), nextPageToken: undefined } }
            : { data: { files: children.slice(0, 1), nextPageToken: "next" } };
        }
        return { data: { files: children, nextPageToken: undefined } };
      },
      async create(params: Record<string, unknown>) {
        const resource = params.requestBody as { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string> };
        const file: DriveFile = { id: resource.id, name: resource.name, mimeType: resource.mimeType, createdTime: "2026-01-03T00:00:00.000Z", parents: resource.parents, appProperties: resource.appProperties };
        files.set(file.id, file);
        return { data: file };
      },
      async update(params: Record<string, unknown>) {
        const file = files.get(String(params.fileId));
        if (!file) throw new Error("missing file");
        if ((params.requestBody as { trashed?: boolean } | undefined)?.trashed) file.trashed = true;
        if (typeof params.addParents === "string") file.parents = [params.addParents];
        return { data: file };
      },
      async generateIds() { return { data: { ids: ["generated-file"] } }; },
    },
  };
  return { client, listCalls, getCalls, files };
}

describe("GoogleDriveAdapter mocked integration", () => {
  test("uses root-constrained fully paginated Drive list queries and recursive property search", async () => {
    const fake = fakeDrive();
    const storage = new GoogleDriveAdapter({ client: fake.client, publicRootId: "public", privateRootId: "private", jitter: () => 0 });
    const children = await storage.listChildren("inbox");
    expect(children).toHaveLength(1);
    expect(fake.listCalls).toHaveLength(2);
    expect(fake.listCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ q: "'inbox' in parents and trashed = false", pageToken: undefined, fields: expect.stringContaining("nextPageToken") }),
      expect.objectContaining({ q: "'inbox' in parents and trashed = false", pageToken: "next" }),
    ]));
    await expect(storage.findByAppProperty("public", "weird'key", "value\\x")).resolves.toEqual([
      expect.objectContaining({ id: "image" }),
    ]);
    expect(fake.listCalls.every((call) => String(call.q).includes(" in parents and trashed = false"))).toBe(true);
    await expect(storage.isDescendant("public", "public")).resolves.toBe(true);
    await expect(storage.readFile("private")).rejects.toThrow(/file/i);
  });

  test("fails closed outside configured roots and validates exact current move parent", async () => {
    const fake = fakeDrive();
    const storage = new GoogleDriveAdapter({ client: fake.client, publicRootId: "public", privateRootId: "private", jitter: () => 0 });
    await expect(storage.listChildren("outside")).rejects.toThrow(/configured|allowed|not found/i);
    await expect(storage.moveFile("image", "inbox", "private")).rejects.toThrow(/current parent/i);
  });

  test("retries only retryable statuses with bounded exponential delays", async () => {
    const fake = fakeDrive();
    let attempts = 0;
    const originalGet = fake.client.files.get;
    fake.client.files.get = async (params: Record<string, unknown>) => {
      if (params.fileId === "inbox" && ++attempts < 4) throw Object.assign(new Error("transient"), { code: 503 });
      return originalGet(params);
    };
    const delays: number[] = [];
    const storage = new GoogleDriveAdapter({ client: fake.client, publicRootId: "public", privateRootId: "private", jitter: () => 0, sleep: async (ms) => { delays.push(ms); } });
    await expect(storage.listChildren("inbox")).resolves.toHaveLength(1);
    expect(attempts).toBe(4);
    expect(delays).toEqual([250, 500, 1000]);

    fake.client.files.get = async () => { throw Object.assign(new Error("forbidden"), { code: 403 }); };
    await expect(storage.listChildren("inbox")).rejects.toThrow("forbidden");
    expect(delays).toEqual([250, 500, 1000]);
  });

  test("uploads fresh readable byte streams under one generated ID and recovers a 409 indeterminate success", async () => {
    const fake = fakeDrive();
    const requests: Array<Record<string, unknown>> = [];
    let attempt = 0;
    fake.client.files.create = async (request: Record<string, unknown>) => {
      requests.push(request);
      const media = request.media as { body: NodeJS.ReadableStream };
      const chunks: Buffer[] = [];
      for await (const chunk of media.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from("exact bytes"));
      if (++attempt === 1) throw Object.assign(new Error("retry"), { code: 503 });
      if (attempt === 2) {
        fake.files.set("generated-file", { id: "generated-file", name: "x.png", mimeType: "image/png", createdTime: "2026-01-03T00:00:00.000Z", parents: ["inbox"], appProperties: {} });
        throw Object.assign(new Error("conflict"), { code: 409 });
      }
      throw new Error("unexpected");
    };
    const storage = new GoogleDriveAdapter({ client: fake.client, publicRootId: "public", privateRootId: "private", jitter: () => 0, sleep: async () => {} });
    await expect(storage.createFile({ name: "x.png", mimeType: "image/png", parentId: "inbox", bytes: Buffer.from("exact bytes") })).resolves.toMatchObject({ id: "generated-file" });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => (request.requestBody as { id: string }).id)).toEqual(["generated-file", "generated-file"]);
    expect((requests[0].media as { body: unknown }).body).not.toBe((requests[1].media as { body: unknown }).body);
  });
});

const task15LiveReady = process.env.INF_DRIVE_INTEGRATION === "1"
  && Boolean(process.env.INF_DRIVE_TEST_ROOT_ID)
  && Boolean(process.env.GOOGLE_CLIENT_ID)
  && Boolean(process.env.GOOGLE_CLIENT_SECRET)
  && Boolean(process.env.GOOGLE_REFRESH_TOKEN);

(task15LiveReady ? test : test.skip)(
  "live Drive contract is skipped until Task 15 provides credentials and a dedicated test root",
  async () => {
    // Task 15 replaces this guarded placeholder with isolated live fixtures; it must never use production folders.
    expect(process.env.INF_DRIVE_TEST_ROOT_ID).toBeTruthy();
  },
);
