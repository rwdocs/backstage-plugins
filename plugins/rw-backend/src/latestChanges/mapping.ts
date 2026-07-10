import type { LatestChangeItem } from "@rwdocs/backstage-plugin-rw-common";
import type { LatestChangeRow } from "./LatestChangesStore";

function joinNonEmpty(parts: string[], sep: string): string {
  return parts.filter(Boolean).join(sep);
}

/** Map a store row to the wire item: derive the viewer path from
 *  (section_path, subpath) and normalise last_modified (driver-native millis)
 *  to an ISO string. */
export function toLatestChangeItem(row: LatestChangeRow): LatestChangeItem {
  return {
    entityRef: row.entity_ref,
    viewerPath: joinNonEmpty([row.section_path, row.subpath], "/"),
    title: row.title,
    lastModified: new Date(Number(row.last_modified)).toISOString(),
  };
}
