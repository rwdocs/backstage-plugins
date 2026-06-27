/**
 * S2 conditional-path test: verifies that a CONDITIONAL PolicyDecision returned by
 * authorizeConditional is correctly evaluated against the in-memory comment via
 * the isCommentAuthor rule. A non-author edit must be denied (403) and the author
 * must be allowed (200).
 */
import * as http from "http";
import express from "express";
import request from "supertest";
import { mockServices, TestDatabases } from "@backstage/backend-test-utils";
import { catalogServiceMock } from "@backstage/plugin-catalog-node/testUtils";
import { MiddlewareFactory } from "@backstage/backend-defaults/rootHttpRouter";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import { AuthorizeResult } from "@backstage/plugin-permission-common";
import type { ConditionalPolicyDecision } from "@backstage/plugin-permission-common";
import type { PermissionsService, PermissionsRegistryService } from "@backstage/backend-plugin-api";
import type { PermissionRuleset } from "@backstage/plugin-permission-node";
import { RESOURCE_TYPE_RW_COMMENT } from "@rwdocs/backstage-plugin-rw-common";
import { CommentStore } from "./CommentStore";
import { createCommentsRouter } from "./router";
import { isCommentAuthor } from "./permissions";
import type { CommentResponse } from "./mapping";

jest.mock("@rwdocs/core", () => ({
  renderCommentBody: jest.fn(async (md: string) => `<p>${md}</p>`),
}));

const ARCH = "component:default/arch";
const DOC = "section:default/root#guide";

const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

// All servers created by buildConditionalApp are registered here and torn down after each test.
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers.length = 0;
});

/**
 * Build an express app whose permissions mock returns a CONDITIONAL decision
 * wrapping the isCommentAuthor rule. The permissionsRegistry mock returns a
 * ruleset that contains isCommentAuthor.
 *
 * mockServices.userInfo() returns user:default/mock as the caller.
 * authorRef controls who owns the comment.
 */
async function buildConditionalApp(authorRef: string) {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  const store = new CommentStore(knex);

  // The CONDITIONAL decision that carries an isCommentAuthor condition.
  // The policy says: allow only if IS_COMMENT_AUTHOR holds for the caller.
  // The caller's userRef is embedded in params; we use "user:default/mock" because
  // that is what mockServices.userInfo() resolves to.
  const conditionalDecision: ConditionalPolicyDecision = {
    result: AuthorizeResult.CONDITIONAL,
    pluginId: "rw",
    resourceType: RESOURCE_TYPE_RW_COMMENT,
    conditions: {
      rule: isCommentAuthor.name,
      resourceType: RESOURCE_TYPE_RW_COMMENT,
      params: { userRef: "user:default/mock" },
    },
  };

  // Permissions mock: authorizeConditional always returns our hand-built CONDITIONAL decision.
  const permissionsMock: PermissionsService = {
    authorize: jest.fn(async (requests) => requests.map(() => ({ result: AuthorizeResult.ALLOW }))),
    authorizeConditional: jest.fn(async (requests) => requests.map(() => conditionalDecision)),
  };

  // Ruleset that exposes isCommentAuthor under its rule name.
  const ruleset: PermissionRuleset<CommentResponse> = {
    getRuleByName(name: string) {
      if (name === isCommentAuthor.name) return isCommentAuthor as any;
      throw new Error(`Unknown rule: ${name}`);
    },
  };

  // PermissionsRegistry mock: getPermissionRuleset returns our ruleset.
  // Cast through unknown because the generic return type is parameterized by the resourceRef
  // argument, but for testing purposes any resourceRef resolves to our fixed ruleset.
  const getPermissionRuleset = jest.fn(
    () => ruleset,
  ) as unknown as PermissionsRegistryService["getPermissionRuleset"];
  const permissionsRegistryMock: Partial<PermissionsRegistryService> = {
    getPermissionRuleset,
    addResourceType: jest.fn(),
  };

  const app = express();
  app.use(
    createCommentsRouter({
      store,
      logger: mockServices.logger.mock(),
      httpAuth: mockServices.httpAuth(),
      auth: mockServices.auth(),
      userInfo: mockServices.userInfo(),
      permissions: permissionsMock,
      permissionsRegistry: permissionsRegistryMock as PermissionsRegistryService,
      catalog: catalogServiceMock({
        entities: [
          {
            apiVersion: "backstage.io/v1alpha1",
            kind: "Component",
            metadata: { name: "arch", namespace: "default" },
          },
        ],
      }) as any,
      commentsEnabled: true,
    }),
  );
  app.use(
    MiddlewareFactory.create({
      logger: mockServices.logger.mock(),
      config: mockServices.rootConfig(),
    }).error(),
  );

  // Pre-seed a comment with the given authorRef
  const row = await store.create(ARCH, {
    pageRef: DOC,
    authorRef,
    body: "original",
    selectors: [],
  });

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  servers.push(server);
  return { server, store, commentId: row.id };
}

describe("S2: conditional permission path — isCommentAuthor rule evaluation", () => {
  it("denies edit (403) when the CONDITIONAL condition does not match (non-author caller)", async () => {
    // Comment authored by user:default/other; caller is user:default/mock.
    // isCommentAuthor checks comment.author.id === "user:default/mock" → false for this comment.
    const { server, commentId } = await buildConditionalApp("user:default/other");

    const res = await request(server).patch(`/comments/${commentId}`).send({ body: "tampered" });
    expect(res.status).toBe(403);
  });

  it("allows edit (200) when the CONDITIONAL condition matches (author caller)", async () => {
    // Comment authored by user:default/mock; caller is user:default/mock.
    // isCommentAuthor checks comment.author.id === "user:default/mock" → true.
    const { server, commentId } = await buildConditionalApp("user:default/mock");

    const res = await request(server)
      .patch(`/comments/${commentId}`)
      .send({ body: "updated body" });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("updated body");
  });
});
