import type { Knex } from "knex";
import { v7 as uuidv7 } from "uuid";
import { renderCommentBody } from "@rwdocs/core";
import { CommentRow, CommentStatus, CreateCommentInput, ListFilter, sectionRefOf } from "./types";

const TABLE = "comments";

export class CommentStore {
  constructor(private readonly knex: Knex) {}

  async create(siteRef: string, input: CreateCommentInput): Promise<CommentRow> {
    const now = new Date();
    const row: CommentRow = {
      id: uuidv7(),
      site_ref: siteRef,
      page_ref: input.pageRef,
      section_ref: sectionRefOf(input.pageRef),
      parent_id: input.parentId ?? null,
      author_ref: input.authorRef,
      author_profile: input.authorProfile ? JSON.stringify(input.authorProfile) : null,
      body: input.body,
      body_html: await renderCommentBody(input.body),
      selectors: JSON.stringify(input.selectors),
      status: "open",
      created_at: now,
      updated_at: now,
      resolved_at: null,
      resolved_by: null,
      deleted_at: null,
    };
    await this.knex(TABLE).insert(row);
    return row;
  }

  /**
   * By global uuid; includes soft-deleted rows.
   *
   * Pass `opts.executor` (a transaction) to read inside an open transaction, and
   * `opts.forUpdate` to lock the row for the rest of the transaction (real
   * `SELECT ... FOR UPDATE` on Postgres; ignored/no-op on better-sqlite3, whose
   * transactions already serialize writes).
   */
  async get(
    id: string,
    opts?: { executor?: Knex.Transaction; forUpdate?: boolean },
  ): Promise<CommentRow | undefined> {
    const q = (opts?.executor ?? this.knex)<CommentRow>(TABLE).where({ id });
    if (opts?.forUpdate) q.forUpdate();
    return q.first();
  }

  /** Run `fn` inside a single database transaction. */
  async transaction<T>(fn: (tx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.knex.transaction(fn);
  }

  /**
   * Site-scoped; ALWAYS excludes soft-deleted rows; ORDER BY created_at ASC.
   *
   * Forward hook: the router currently reads only by `pageRef`. The additional
   * `ListFilter` fields (`sectionRef`, `status`, `parentId`, `topLevelOnly`) and the
   * corresponding `section_ref` column + `comments_section_idx` index are intentional
   * forward hooks for the planned cross-section / entity-scoped querying direction (v1
   * design). They are not dead code.
   */
  async list(siteRef: string, filter: ListFilter): Promise<CommentRow[]> {
    const q = this.knex<CommentRow>(TABLE).where({ site_ref: siteRef }).whereNull("deleted_at");
    if (filter.pageRef !== undefined) q.andWhere({ page_ref: filter.pageRef });
    if (filter.sectionRef !== undefined) q.andWhere({ section_ref: filter.sectionRef });
    if (filter.status !== undefined) q.andWhere({ status: filter.status });
    if (filter.parentId !== undefined) q.andWhere({ parent_id: filter.parentId });
    if (filter.topLevelOnly) q.whereNull("parent_id");
    return q.orderBy("created_at", "asc").orderBy("id", "asc");
  }

  async update(
    id: string,
    patch: { body?: string; status?: CommentStatus; selectors?: unknown[]; resolverRef?: string },
  ): Promise<CommentRow | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    const now = new Date();
    const changes: Partial<CommentRow> = { updated_at: now };
    if (patch.body !== undefined) {
      changes.body = patch.body;
      changes.body_html = await renderCommentBody(patch.body);
    }
    if (patch.selectors !== undefined) {
      changes.selectors = JSON.stringify(patch.selectors);
    }
    if (patch.status !== undefined) {
      changes.status = patch.status;
      if (patch.status === "resolved") {
        // Push the idempotency guard into SQL — concurrent resolves can't double-stamp.
        // COALESCE leaves existing stamps intact; works on both better-sqlite3 and Postgres.
        (changes as any).resolved_at = this.knex.raw("COALESCE(resolved_at, ?)", [now]);
        (changes as any).resolved_by = this.knex.raw("COALESCE(resolved_by, ?)", [
          patch.resolverRef ?? null,
        ]);
      } else {
        changes.resolved_at = null;
        changes.resolved_by = null;
      }
    }
    await this.knex(TABLE).where({ id }).update(changes);
    return this.get(id);
  }

  /**
   * Conditional soft-delete: only applies to a currently-live row (`deleted_at IS
   * NULL`). Returns the fresh row when it applied, or `undefined` when 0 rows
   * matched (the row was already deleted — a lost race). Pass `executor` to run
   * inside an open transaction.
   */
  async softDelete(id: string, executor?: Knex.Transaction): Promise<CommentRow | undefined> {
    const db = executor ?? this.knex;
    const now = new Date();
    const count = await db(TABLE)
      .where({ id })
      .whereNull("deleted_at")
      .update({ deleted_at: now, updated_at: now });
    if (count === 0) return undefined;
    return this.get(id, { executor });
  }

  /**
   * Conditional restore: only applies to a currently-deleted row (`deleted_at IS
   * NOT NULL`). Returns the fresh row when it applied, or `undefined` when 0 rows
   * matched (the row was already live — a lost race). Pass `executor` to run
   * inside an open transaction.
   */
  async restore(id: string, executor?: Knex.Transaction): Promise<CommentRow | undefined> {
    const db = executor ?? this.knex;
    const count = await db(TABLE)
      .where({ id })
      .whereNotNull("deleted_at")
      .update({ deleted_at: null, updated_at: new Date() });
    if (count === 0) return undefined;
    return this.get(id, { executor });
  }

  /**
   * Distinct author refs participating in a thread: the root comment plus its direct,
   * non-deleted replies (threads are one level deep, so `rootId` is the parent of every
   * reply). Used by the comment-event publisher to address commenter-side notifications.
   * Order is stable (creation order) so notification recipient lists are deterministic.
   */
  async participantsOf(rootId: string): Promise<string[]> {
    const rows = await this.knex(TABLE)
      .where(function whereInThread(this: Knex.QueryBuilder) {
        this.where("id", rootId).orWhere("parent_id", rootId);
      })
      .whereNull("deleted_at")
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .select("author_ref");
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of rows) {
      const ref = row.author_ref as string;
      if (!seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
    return out;
  }

  /**
   * Returns a map from parent_id → open reply count for a given set of
   * top-level comment ids. Uses a single grouped query (no N+1).
   * Only counts open, non-deleted replies.
   */
  async replyCountsFor(parentIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!parentIds.length) return map;
    const rows = await this.knex(TABLE)
      .whereIn("parent_id", parentIds)
      .andWhere("status", "open")
      .whereNull("deleted_at")
      .groupBy("parent_id")
      .select("parent_id")
      .count("id as cnt");
    for (const row of rows) {
      map.set(row.parent_id as string, Number(row.cnt));
    }
    return map;
  }
}
