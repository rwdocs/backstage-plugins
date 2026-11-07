import { mockServices, startTestBackend } from "@backstage/backend-test-utils";
import { catalogServiceMock } from "@backstage/plugin-catalog-node/testUtils";
import { rwPlugin } from "./plugin";

jest.mock("@rwdocs/core", () => ({ createSite: jest.fn() }));

it("registers cookie access only for site files, not other site routes", async () => {
  const httpRouter = mockServices.httpRouter.mock();
  await startTestBackend({
    features: [
      rwPlugin,
      catalogServiceMock.factory(),
      httpRouter.factory,
      mockServices.rootConfig.factory({
        data: { rw: { projectDir: "/test/docs", entity: "component:default/test" } },
      }),
      mockServices.scheduler.mock().factory,
      mockServices.database.factory({
        knex: { client: { config: { client: "sqlite3" } } } as never,
        migrations: { skip: true },
      }),
    ],
  });

  expect(httpRouter.addAuthPolicy.mock.calls).toEqual([
    [{ path: "/site/:namespace/:kind/:name/files", allow: "user-cookie" }],
    [{ path: "/health", allow: "unauthenticated" }],
  ]);
});
