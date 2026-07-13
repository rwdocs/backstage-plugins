import { parseEntityRef, stringifyEntityRef } from "@backstage/catalog-model";
import { toEntityPath, fromEntityPath } from "./entityPath";

export interface ParsedAnnotation {
  /** Slash-delimited path for API URLs (e.g. "default/component/arch"). */
  entityPath: string;
  /** Standard Backstage entity ref (e.g. "component:default/arch"). */
  entityRef: string;
  sectionRef: string | undefined;
}

/**
 * Parses an `rwdocs.org/ref` annotation value into its component parts.
 *
 * The annotation format is `<entityRef>[#<sectionRef>]`, where `entityRef` is
 * a standard Backstage entity ref and `sectionRef` is an optional path within
 * the documentation site.
 *
 * A special value of `"."` refers to the entity itself; this requires the
 * `selfEntityPath` parameter to resolve.
 *
 * @param value - The raw annotation value
 * @param selfEntityPath - The entity path of the entity bearing the annotation,
 *   required to resolve `"."` self-references
 */
export function parseAnnotation(
  value: string | undefined,
  selfEntityPath?: string,
): ParsedAnnotation | undefined {
  if (!value) return undefined;

  const hashIndex = value.indexOf("#");
  let entity: string;
  let sectionRef: string | undefined;

  if (hashIndex === -1) {
    entity = value;
    sectionRef = undefined;
  } else {
    entity = value.slice(0, hashIndex);
    sectionRef = value.slice(hashIndex + 1) || undefined;
  }

  // Bad data yields undefined, never a throw — callers treat an unparseable
  // annotation as "this entity documents nothing". Both branches convert between a
  // ref and a path, and both of those reject a segment that cannot be one, so both
  // belong inside the catch.
  try {
    if (entity === ".") {
      if (!selfEntityPath) return undefined;
      return { entityPath: selfEntityPath, entityRef: fromEntityPath(selfEntityPath), sectionRef };
    }

    return {
      entityPath: toEntityPath(entity),
      entityRef: stringifyEntityRef(parseEntityRef(entity)),
      sectionRef,
    };
  } catch {
    return undefined;
  }
}
