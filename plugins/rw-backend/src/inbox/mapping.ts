export type { InboxItem, InboxResponse } from "@rwdocs/backstage-plugin-rw-common";
import type { InboxItem } from "@rwdocs/backstage-plugin-rw-common";
import { toIso } from "../comments/timestamps";
import { subpathOf } from "../comments/types";
import { authorFromRow } from "../comments/author";
import { snippetFromHtml } from "./snippet";
import type { OwnedThreadRow } from "./InboxStore";

export function joinNonEmpty(parts: string[], sep: string): string {
  return parts.filter(Boolean).join(sep);
}

/** The keyset sort value bound back into the seek. updated_at reads back as a
 *  number (better-sqlite3), a string (sqlite3/pg-ISO), or a Date (pg's knex
 *  driver returns Date objects for timestamp columns, unlike better-sqlite3
 *  which returns a number). A Date is normalised to ISO so the cursor JSON
 *  round-trip and the SQL seek comparison are both correct. Numbers/strings
 *  pass through unchanged. */
export function rawSortValue(updatedAt: Date | string | number): string | number {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  return updatedAt;
}

export function toInboxItem(row: OwnedThreadRow, replyCount: number): InboxItem {
  const viewerPath = joinNonEmpty([row.section_path, subpathOf(row.page_ref)], "/");
  return {
    commentId: row.id,
    siteRef: row.site_ref,
    pageRef: row.page_ref,
    entityRef: row.entity_ref,
    viewerPath,
    pageTitle: row.page_title ?? viewerPath,
    author: authorFromRow(row),
    bodySnippet: snippetFromHtml(row.body_html),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    replyCount,
  };
}
