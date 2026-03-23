import { parseEntityRef, stringifyEntityRef } from "@backstage/catalog-model";
import { toEntityPath } from "./entityPath";

export interface ParsedAnnotation {
  /** Slash-delimited path for API URLs (e.g. "default/component/arch"). */
  entityPath: string;
  /** Standard Backstage entity ref (e.g. "component:default/arch"). */
  entityRef: string;
  sectionRef: string | undefined;
}

export function parseAnnotation(
  value: string | undefined,
  selfEntityRef: string,
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

  if (entity === ".") {
    return { entityPath: selfEntityRef, entityRef: fromEntityPath(selfEntityRef), sectionRef };
  }

  try {
    return {
      entityPath: toEntityPath(entity),
      entityRef: stringifyEntityRef(parseEntityRef(entity)),
      sectionRef,
    };
  } catch {
    return undefined;
  }
}

/** Convert slash-delimited path (namespace/kind/name) back to colon-format entity ref. */
function fromEntityPath(path: string): string {
  const [namespace, kind, name] = path.split("/");
  return stringifyEntityRef({ kind, namespace, name });
}
