import { toEntityPath } from "./entityPath";

export interface ParsedAnnotation {
  entityRef: string;
  scope: string | undefined;
}

export function parseAnnotation(
  value: string | undefined,
  selfEntityRef: string,
): ParsedAnnotation | undefined {
  if (!value) return undefined;

  const hashIndex = value.indexOf("#");
  let entity: string;
  let scope: string | undefined;

  if (hashIndex === -1) {
    entity = value;
    scope = undefined;
  } else {
    entity = value.slice(0, hashIndex);
    scope = value.slice(hashIndex + 1) || undefined;
  }

  if (entity === ".") {
    return { entityRef: selfEntityRef, scope };
  }

  try {
    return { entityRef: toEntityPath(entity), scope };
  } catch {
    return undefined;
  }
}
