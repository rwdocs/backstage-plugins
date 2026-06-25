import { v7 as uuidv7 } from "uuid";
import type { Knex } from "knex";

/** Insert a minimal comment row directly (bypasses CommentStore to avoid @rwdocs/core). */
export async function insertComment(
  knex: Knex,
  overrides: Partial<Record<string, unknown>> & {
    id?: string;
    site_ref: string;
    section_ref: string;
  },
): Promise<string> {
  const now = new Date();
  const id = overrides.id ?? uuidv7();
  await knex("comments").insert({
    id,
    site_ref: overrides.site_ref,
    document_id: overrides.document_id ?? `${overrides.section_ref}#guide`,
    section_ref: overrides.section_ref,
    parent_id: overrides.parent_id ?? null,
    author_ref: overrides.author_ref ?? "user:default/alice",
    author_profile: overrides.author_profile ?? null,
    body: overrides.body ?? "test body",
    body_html: overrides.body_html ?? "<p>test body</p>",
    selectors: overrides.selectors ?? "[]",
    status: overrides.status ?? "open",
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    resolved_at: overrides.resolved_at ?? null,
    resolved_by: overrides.resolved_by ?? null,
    deleted_at: overrides.deleted_at ?? null,
  });
  return id;
}
