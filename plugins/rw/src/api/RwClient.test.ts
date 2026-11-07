import { RwClient } from "./RwClient";

describe("RwClient", () => {
  const mockDiscoveryApi = {
    getBaseUrl: jest.fn().mockResolvedValue("http://localhost:7007/api/rw"),
  };
  const mockFetch = jest.fn() as unknown as typeof fetch;
  const mockFetchApi = { fetch: mockFetch };

  let client: RwClient;

  beforeEach(() => {
    client = new RwClient({ discoveryApi: mockDiscoveryApi, fetchApi: mockFetchApi });
  });

  describe("getBaseUrl", () => {
    it("delegates to discoveryApi with plugin id 'rw'", async () => {
      const url = await client.getBaseUrl();
      expect(url).toBe("http://localhost:7007/api/rw");
      expect(mockDiscoveryApi.getBaseUrl).toHaveBeenCalledWith("rw");
    });
  });

  describe("getFetch", () => {
    it("returns the fetchApi fetch function", () => {
      expect(client.getFetch()).toBe(mockFetch);
    });
  });
});

function makeClient() {
  const fetchMock = jest.fn();
  const discoveryApi = { getBaseUrl: jest.fn(async () => "http://backstage/api/rw") };
  const fetchApi = { fetch: fetchMock };
  const client = new RwClient({ discoveryApi: discoveryApi as any, fetchApi: fetchApi as any });
  return { client, fetchMock };
}

describe("RwClient HTTP errors", () => {
  it.each([
    ["navigation", (client: RwClient) => client.getSiteRootSectionRef("default/component/arch")],
    ["inbox", (client: RwClient) => client.getCommentInbox()],
    ["latest changes", (client: RwClient) => client.getLatestChanges()],
    ["comments", (client: RwClient) => client.createCommentClient("site").list("doc")],
  ])("%s rejects HTTP failures with the server reason", async (_name, request) => {
    const { client, fetchMock } = makeClient();
    const payload = {
      error: { name: "NotAllowedError", message: "Access denied" },
      response: { statusCode: 403 },
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(request(client)).rejects.toMatchObject({
      statusCode: 403,
      cause: { message: "Access denied" },
    });
  });
});

describe("RwClient comment methods", () => {
  it("getCommentsEnabled reads /comments/config", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) });
    await expect(client.getCommentsEnabled()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://backstage/api/rw/comments/config");
  });

  it("getCommentsEnabled returns false (not throws) on a non-ok response", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(client.getCommentsEnabled()).resolves.toBe(false);
  });

  it("getCommentsEnabled propagates fetch rejection (caller is responsible for catching and degrading to disabled)", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockRejectedValue(new Error("network timeout"));
    await expect(client.getCommentsEnabled()).rejects.toThrow("network timeout");
  });

  it("list() GETs /comments with siteRef + documentId", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const cc = client.createCommentClient("component:default/arch");
    await cc.list("section:default/root#guide");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/comments?");
    expect(url).toContain("siteRef=component%3Adefault%2Farch");
    expect(url).toContain("documentId=section%3Adefault%2Froot%23guide");
  });

  it("create() POSTs /comments with siteRef merged into the body", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
    const cc = client.createCommentClient("component:default/arch");
    await cc.create({ documentId: "d#p", body: "hi", selectors: [] } as any);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backstage/api/rw/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      siteRef: "component:default/arch",
      documentId: "d#p",
      body: "hi",
    });
  });

  it("update() PATCHes /comments/:id and delete() DELETEs it", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
    const cc = client.createCommentClient("component:default/arch");
    await cc.update("c1", { status: "resolved" });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[0][0]).toBe("http://backstage/api/rw/comments/c1");
    await cc.delete("c1");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("getCommentInbox() GETs /comments/inbox and returns InboxResponse", async () => {
    const { client, fetchMock } = makeClient();
    const payload = {
      built: true,
      items: [{ commentId: "1" }],
      pageInfo: {},
      openCount: 1,
      unansweredCount: 0,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await client.getCommentInbox();
    expect(fetchMock).toHaveBeenCalledWith("http://backstage/api/rw/comments/inbox");
    expect(result).toEqual(payload);
  });

  it("getCommentInbox({ filter, sort }) encodes both params and no cursor", async () => {
    const { client, fetchMock } = makeClient();
    const payload = { built: true, items: [], pageInfo: {}, openCount: 0, unansweredCount: 0 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    await client.getCommentInbox({ filter: "unanswered", sort: "oldest" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("filter=unanswered");
    expect(url).toContain("sort=oldest");
    expect(url).not.toContain("cursor=");
  });

  it("getCommentInbox({ cursor }) sends cursor only — filter/sort are dropped", async () => {
    const { client, fetchMock } = makeClient();
    const payload = { built: true, items: [], pageInfo: {}, openCount: 0, unansweredCount: 0 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    await client.getCommentInbox({ cursor: "ABC123", filter: "unanswered" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("cursor=ABC123");
    expect(url).not.toContain("filter=");
  });

  describe("getLatestChanges", () => {
    it("GETs /pages/latest with no params", async () => {
      const { client, fetchMock } = makeClient();
      const payload = { hasAnyDated: true, items: [], pageInfo: {} };
      fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
      const result = await client.getLatestChanges();
      expect(fetchMock).toHaveBeenCalledWith("http://backstage/api/rw/pages/latest");
      expect(result).toEqual(payload);
    });

    it("encodes limit and cursor query params when present", async () => {
      const { client, fetchMock } = makeClient();
      const payload = { hasAnyDated: true, items: [], pageInfo: {} };
      fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
      await client.getLatestChanges({ limit: 25, cursor: "ABC123" });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("/pages/latest?");
      expect(url).toContain("cursor=ABC123");
      expect(url).toContain("limit=25");
    });
  });

  it("createCommentClient stays on the documentId viewer wire", async () => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const comments = client.createCommentClient("site:default/x");

    await comments.list("section:default/root#guide");
    const listUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(listUrl.searchParams.get("documentId")).toBe("section:default/root#guide");

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
    await comments.create({
      siteRef: "site:default/x",
      documentId: "section:default/root#guide",
      body: "hi",
      selectors: [],
    } as any);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.documentId).toBe("section:default/root#guide");
  });
});

describe("RwClient.getSiteRootSectionRef", () => {
  it.each([
    [{ kind: "section", namespace: "default", name: "root" }, "section:default/root"],
    [{ kind: "section", namespace: "commerce", name: "root" }, "section:commerce/root"],
    [{ kind: "domain", namespace: "Commerce", name: "Handbook" }, "domain:Commerce/Handbook"],
  ])("reads the exact root identity %j", async (section, expected) => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ scope: { path: "/", section } })));
    await expect(client.getSiteRootSectionRef("default/component/arch")).resolves.toBe(expected);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backstage/api/rw/site/default/component/arch/navigation",
    );
  });

  it.each([
    null,
    {},
    { scope: { path: "/child", section: { kind: "section", namespace: "default", name: "root" } } },
    { scope: { path: "/" } },
    ...["kind", "namespace", "name"].flatMap((field) =>
      [undefined, "", 42].map((value) => ({
        scope: {
          path: "/",
          section: { kind: "section", namespace: "default", name: "root", [field]: value },
        },
      })),
    ),
  ])("rejects invalid root navigation %j", async (body) => {
    const { client, fetchMock } = makeClient();
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });
    await expect(client.getSiteRootSectionRef("default/component/arch")).rejects.toThrow(
      "Site navigation is missing a valid root section",
    );
  });

  it("propagates fetch rejection", async () => {
    const { client, fetchMock } = makeClient();
    const error = new Error("network timeout");
    fetchMock.mockRejectedValue(error);
    await expect(client.getSiteRootSectionRef("default/component/arch")).rejects.toBe(error);
  });
});
