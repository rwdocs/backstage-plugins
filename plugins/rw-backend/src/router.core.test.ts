import * as http from "http";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { mockServices } from "@backstage/backend-test-utils";
import type { RwSite } from "@rwdocs/core";
import express from "express";
import request from "supertest";
import { Hub } from "./hub";
import { createRouter } from "./router";
import { SiteAuthorizer } from "./authorizeSite";

const sectionRef = "system:commerce/payments-api";
const sectionMarkdown = [
  "---",
  "kind: system",
  "namespace: commerce",
  "name: payments-api",
  "title: Payments documentation",
  "---",
  "# Payments",
  "",
].join("\n");
const runbookMarkdown = "# Operations\n\nRestart the payment worker.\n";

describe("createRouter with real core", () => {
  let projectDir: string | undefined;
  let site: RwSite;
  let server: http.Server;

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rw-router-core-"));
    await mkdir(join(projectDir, "docs/payments-guide"), { recursive: true });
    await writeFile(join(projectDir, "rw.toml"), "");
    await writeFile(
      join(projectDir, "docs/index.md"),
      "---\nkind: section\nnamespace: commerce\nname: handbook\n---\n# Home\n",
    );
    await writeFile(join(projectDir, "docs/payments-guide/index.md"), sectionMarkdown);
    await writeFile(join(projectDir, "docs/payments-guide/runbook.md"), runbookMarkdown);

    const hub = new Hub({ projectDir, entity: "component:default/test" });
    site = hub.getSite("default/component/test")!;
    const httpAuth = mockServices.httpAuth.mock();
    const authorizer = new SiteAuthorizer({
      permissions: mockServices.permissions.mock(),
      httpAuth,
      auditor: mockServices.auditor.mock(),
    });
    jest.spyOn(authorizer, "assertReadable").mockResolvedValue(undefined);
    const router = await createRouter({
      logger: mockServices.logger.mock(),
      httpAuth,
      hub,
      authorizer,
    });
    const app = express().use(router);
    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  });

  afterAll(async () => {
    try {
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      try {
        if (projectDir) await rm(projectDir, { recursive: true, force: true });
      } finally {
        jest.restoreAllMocks();
      }
    }
  });

  it("serves the named homepage identity in unscoped navigation", async () => {
    const response = await request(server).get("/site/default/component/test/navigation");
    expect(response.status).toBe(200);
    expect(response.body.scope).toMatchObject({
      path: "/",
      section: { kind: "section", namespace: "commerce", name: "handbook" },
    });
  });

  it("lists and resolves explicit identities independently of page paths", async () => {
    expect(await site.listSections()).toEqual(
      expect.arrayContaining([expect.objectContaining({ sectionRef, path: "payments-guide" })]),
    );
    const pages = await site.listPages();
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionRef,
          subpath: "",
          path: "payments-guide",
          title: "Payments documentation",
        }),
        expect.objectContaining({
          sectionRef,
          subpath: "runbook",
          path: "payments-guide/runbook",
          anchors: expect.arrayContaining([{ sectionRef, subpath: "runbook" }]),
        }),
      ]),
    );
    await expect(site.pagePathFor(sectionRef, "")).resolves.toBe("payments-guide");
    await expect(site.pagePathFor(sectionRef, "runbook")).resolves.toBe("payments-guide/runbook");
  });

  it("serves the scoped section root at its unchanged page path", async () => {
    const response = await request(server)
      .get("/site/default/component/test/pages/")
      .query({ sectionRef });
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      sectionRef,
      subpath: "",
      path: "/payments-guide",
      title: "Payments documentation",
    });
  });

  it.each([
    ["section root", undefined, sectionMarkdown],
    ["nested page", "runbook", runbookMarkdown],
  ] as const)(
    "reads %s Markdown using the explicit identity",
    async (_label, subpath, markdown) => {
      const response = await request(server)
        .get("/site/default/component/test/markdown")
        .query(subpath === undefined ? { sectionRef } : { sectionRef, subpath });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ markdown });
    },
  );
});
