import { parseEntityRef } from "@backstage/catalog-model";

/**
 * Converts a Backstage entity ref (e.g. "component:default/arch") to the
 * slash-delimited, lowercased path format used in URLs and cache keys
 * (e.g. "component/default/arch").
 *
 * Also accepts already-normalized slash format ("component/default/arch")
 * and ensures consistent lowercasing.
 */
export function toEntityPath(entityRef: string): string {
  // If already in slash format (kind/namespace/name), convert to colon format
  // so parseEntityRef can handle it.
  const normalized = !entityRef.includes(":") && entityRef.split("/").length === 3
    ? entityRef.replace("/", ":")
    : entityRef;
  const ref = parseEntityRef(normalized);
  return `${ref.kind}/${ref.namespace}/${ref.name}`.toLocaleLowerCase("en-US");
}
