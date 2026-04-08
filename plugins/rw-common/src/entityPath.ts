import { parseEntityRef, stringifyEntityRef } from "@backstage/catalog-model";
import { InputError } from "@backstage/errors";

/**
 * Converts an entity ref (e.g. "component:default/arch") or a compound ref
 * object to the slash-delimited, lowercased path used in API URLs
 * (e.g. "default/component/arch").
 *
 * Uses namespace/kind/name ordering to match Backstage catalog URL convention.
 */
export function toEntityPath(
  ref: string | { kind: string; namespace?: string; name: string },
): string {
  const parsed = typeof ref === "string" ? parseEntityRef(ref) : ref;
  const ns = parsed.namespace ?? "default";
  return `${ns}/${parsed.kind}/${parsed.name}`.toLocaleLowerCase("en-US");
}

/**
 * Converts a slash-delimited entity path (e.g. "default/component/arch")
 * back to the standard Backstage entity ref format (e.g. "component:default/arch").
 *
 * This is the inverse of `toEntityPath`. Note that the round-trip always
 * produces lowercased refs since `toEntityPath` lowercases its output.
 */
export function fromEntityPath(path: string): string {
  const parts = path.split("/");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new InputError(`Invalid entity path: "${path}" (expected "namespace/kind/name")`);
  }
  const [namespace, kind, name] = parts;
  return stringifyEntityRef({ kind, namespace, name });
}
