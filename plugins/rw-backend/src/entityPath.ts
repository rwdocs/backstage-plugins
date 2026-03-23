import { parseEntityRef } from "@backstage/catalog-model";
import { InputError } from "@backstage/errors";

/**
 * Converts a Backstage entity ref (e.g. "component:default/arch") to the
 * slash-delimited, lowercased path format used in URLs and cache keys
 * (e.g. "default/component/arch").
 *
 * Uses namespace/kind/name ordering to match Backstage catalog URL convention.
 *
 * NOTE: The frontend plugin has a similar utility at
 * plugins/rw/src/components/entityPath.ts — keep in sync if changing logic.
 */
export function toEntityPath(entityRef: string): string {
  const ref = parseEntityRef(entityRef);
  return `${ref.namespace}/${ref.kind}/${ref.name}`.toLocaleLowerCase("en-US");
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
  return `${kind}:${namespace}/${name}`;
}
