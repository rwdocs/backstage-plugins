import { TestDatabases } from "@backstage/backend-test-utils";
import { resolvePackagePath } from "@backstage/backend-plugin-api";
import type { Knex } from "knex";

// Created once at module scope (TestDatabases registers an afterAll hook, which
// must not run inside a test/beforeEach). Each createTestDb() call gets a fresh DB.
const databases = TestDatabases.create({ ids: ["SQLITE_3"] });

/** Fresh in-memory SQLite DB with all rw-backend migrations applied. */
export async function createTestDb(): Promise<Knex> {
  const knex = await databases.init("SQLITE_3");
  await knex.migrate.latest({
    directory: resolvePackagePath("@rwdocs/backstage-plugin-rw-backend", "migrations"),
  });
  return knex;
}
