import type { Knex } from "knex";
import type { CommentRow } from "../comments/types";
import { sectionRefOf, subpathOf } from "../comments/types";

export type OwnedThreadRow = CommentRow & {
  entity_ref: string;
  section_path: string;
  document_title: string | null;
};

export interface InboxPageParams {
  filter: "open" | "unanswered";
  sort: "newest" | "oldest";
  lastKey?: [string | number, string];
  limit: number;
}

export interface InboxPage {
  rows: OwnedThreadRow[];
  hasMore: boolean;
}

export class InboxStore {
  constructor(private readonly knex: Knex) {}

  private static titleKeyFor(siteRef: string, sectionRef: string, subpath: string): string {
    return `${siteRef}\0${sectionRef}\0${subpath}`;
  }

  private async titlesFor(
    keys: { site_ref: string; section_ref: string; subpath: string }[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!keys.length) return map;
    const CHUNK = 300; // 3 params × 300 = 900 < SQLite's 999-variable limit
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const rows: Array<{ site_ref: string; section_ref: string; subpath: string; title: string }> =
        await this.knex("pages")
          .where((qb) => {
            for (const k of chunk) {
              qb.orWhere((w) =>
                w
                  .where("site_ref", k.site_ref)
                  .andWhere("section_ref", k.section_ref)
                  .andWhere("subpath", k.subpath),
              );
            }
          })
          .select("site_ref", "section_ref", "subpath", "title");
      for (const r of rows) {
        map.set(InboxStore.titleKeyFor(r.site_ref, r.section_ref, r.subpath), r.title);
      }
    }
    return map;
  }

  /** Resolves document_title for each raw row via titlesFor, returning OwnedThreadRow[]. */
  private async resolveRows(
    rows: Array<CommentRow & { entity_ref: string; section_path: string }>,
  ): Promise<OwnedThreadRow[]> {
    const keys = rows.map((r) => ({
      site_ref: r.site_ref,
      section_ref: sectionRefOf(r.document_id),
      subpath: subpathOf(r.document_id),
    }));
    const titles = await this.titlesFor(keys);
    return rows.map((r, j) => {
      const k = keys[j];
      return {
        ...r, // already carries entity_ref + section_path (typed onto the row)
        document_title:
          titles.get(InboxStore.titleKeyFor(r.site_ref, k.section_ref, k.subpath)) ?? null,
      };
    });
  }

  // Open top-level, non-deleted threads owned by `ownerRefs`. Owners are a user's
  // own + group refs (few), so a single whereIn is safe — no chunking.
  private baseOwnedQuery(ownerRefs: string[]) {
    return this.knex({ c: "comments" })
      .join({ s: "sections" }, function joinSections(this: Knex.JoinClause) {
        this.on("s.site_ref", "c.site_ref").andOn("s.section_ref", "c.section_ref");
      })
      .whereIn("s.entity_owner_ref", ownerRefs)
      .andWhere("c.status", "open")
      .whereNull("c.parent_id")
      .whereNull("c.deleted_at");
  }

  // Shared reply-existence predicate: an open, non-deleted reply to the thread.
  // Do NOT change this predicate (open + non-deleted) without making the same
  // change in CommentStore.replyCountsFor: a mismatch will hide threads the rail
  // still marks "No replies yet" (or vice versa — show threads the rail marks
  // answered), breaking the unanswered filter's accuracy.
  private whereHasNoOpenReply(q: Knex.QueryBuilder) {
    const knex = this.knex;
    return q.whereNotExists(function noReply(this: Knex.QueryBuilder) {
      this.select(knex.raw("1"))
        .from({ r: "comments" })
        .whereRaw("r.parent_id = c.id")
        .andWhere("r.status", "open")
        .whereNull("r.deleted_at");
    });
  }

  async ownedOpenThreadsPage(ownerRefs: string[], params: InboxPageParams): Promise<InboxPage> {
    if (!ownerRefs.length) return { rows: [], hasMore: false };
    const dir = params.sort === "oldest" ? "asc" : "desc";
    const op = params.sort === "oldest" ? ">" : "<";

    let q = this.baseOwnedQuery(ownerRefs);
    if (params.filter === "unanswered") q = this.whereHasNoOpenReply(q);
    if (params.lastKey) {
      const [uv, idv] = params.lastKey;
      q = q.andWhere(function seek(this: Knex.QueryBuilder) {
        this.where("c.updated_at", op, uv).orWhere(function tie(this: Knex.QueryBuilder) {
          this.where("c.updated_at", uv).andWhere("c.id", op, idv);
        });
      });
    }

    const raw: Array<CommentRow & { entity_ref: string; section_path: string }> = await q
      .orderBy("c.updated_at", dir)
      .orderBy("c.id", dir)
      .select("c.*", "s.entity_ref", "s.section_path")
      .limit(params.limit + 1);

    const hasMore = raw.length > params.limit;
    if (hasMore) raw.length = params.limit;
    return { rows: await this.resolveRows(raw), hasMore };
  }

  async counts(ownerRefs: string[]): Promise<{ openCount: number; unansweredCount: number }> {
    if (!ownerRefs.length) return { openCount: 0, unansweredCount: 0 };
    // The two aggregates are independent — run them concurrently.
    const [[openRow], [unansweredRow]] = await Promise.all([
      this.baseOwnedQuery(ownerRefs).count({ cnt: "c.id" }),
      this.whereHasNoOpenReply(this.baseOwnedQuery(ownerRefs)).count({ cnt: "c.id" }),
    ]);
    return { openCount: Number(openRow.cnt), unansweredCount: Number(unansweredRow.cnt) };
  }
}
