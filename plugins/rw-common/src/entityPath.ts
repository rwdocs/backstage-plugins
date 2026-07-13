import { parseEntityRef, stringifyEntityRef } from "@backstage/catalog-model";
import { InputError } from "@backstage/errors";

/**
 * A path segment that cannot traverse: no "/", no "..", no ".", never empty.
 *
 * Deliberately narrower than Backstage's entity-name policy (which also caps length
 * and constrains the trailing character): this is a path-safety gate, not a name
 * validator, and every rule beyond the one we need is a rule that can diverge from
 * Backstage's and reject a legitimate entity. Every entity admitted under Backstage's
 * *default* policy passes this once lowercased — but a catalog with a custom entity
 * policy can still yield a ref this rejects, so a caller that fans out over the whole
 * catalog has to survive one (see `collectSiteClaims`).
 */
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

function assertSegment(value: string, field: string, context: string): void {
  if (!SEGMENT.test(value)) {
    throw new InputError(`Invalid entity ${field}: "${value}" in "${context}"`);
  }
}

/**
 * Converts an entity ref (e.g. "component:default/arch") or a compound ref
 * object to the slash-delimited, lowercased path used in API URLs
 * (e.g. "default/component/arch").
 *
 * Uses namespace/kind/name ordering to match Backstage catalog URL convention.
 *
 * `parseEntityRef` is a parser, not a validator — it happily accepts a name of "..",
 * which would traverse once interpolated into a URL path. This function and
 * `fromEntityPath` are the only bridge between a ref and a path, so this is where
 * that is caught, once, for every consumer.
 *
 * @throws InputError if any segment is not a valid path segment.
 */
export function toEntityPath(
  ref: string | { kind: string; namespace?: string; name: string },
): string {
  const parsed = typeof ref === "string" ? parseEntityRef(ref) : ref;
  const namespace = (parsed.namespace || "default").toLocaleLowerCase("en-US");
  const kind = parsed.kind.toLocaleLowerCase("en-US");
  const name = parsed.name.toLocaleLowerCase("en-US");

  const context = `${kind}:${namespace}/${name}`;
  assertSegment(namespace, "namespace", context);
  assertSegment(kind, "kind", context);
  assertSegment(name, "name", context);

  return `${namespace}/${kind}/${name}`;
}

/**
 * Converts a slash-delimited entity path (e.g. "default/component/arch")
 * back to the standard Backstage entity ref format (e.g. "component:default/arch").
 *
 * This is the inverse of `toEntityPath`. Note that the round-trip always
 * produces lowercased refs since `toEntityPath` lowercases its output.
 *
 * @throws InputError if the path is not three valid path segments.
 */
export function fromEntityPath(path: string): string {
  const parts = path.split("/");
  if (parts.length !== 3) {
    throw new InputError(`Invalid entity path: "${path}" (expected "namespace/kind/name")`);
  }
  const [namespace, kind, name] = parts;
  assertSegment(namespace, "namespace", path);
  assertSegment(kind, "kind", path);
  assertSegment(name, "name", path);
  return stringifyEntityRef({ kind, namespace, name });
}
