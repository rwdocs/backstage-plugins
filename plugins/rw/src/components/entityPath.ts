import { parseEntityRef } from "@backstage/catalog-model";

/**
 * Converts an entity ref (e.g. "component:default/arch") or a compound ref
 * object to the slash-delimited, lowercased path used in API URLs
 * (e.g. "component/default/arch").
 *
 * NOTE: The backend plugin has a similar utility at
 * plugins/rw-backend/src/entityPath.ts — keep in sync if changing logic.
 */
export function toEntityPath(
  ref: string | { kind: string; namespace?: string; name: string },
): string {
  const parsed = typeof ref === "string" ? parseEntityRef(ref) : ref;
  const ns = parsed.namespace ?? "default";
  return `${parsed.kind}/${ns}/${parsed.name}`.toLocaleLowerCase("en-US");
}
