import { parseEntityRef } from "@backstage/catalog-model";

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
    const ref = parseEntityRef(entity);
    return {
      entityRef:
        `${ref.kind}/${ref.namespace}/${ref.name}`.toLocaleLowerCase("en-US"),
      scope,
    };
  } catch {
    return undefined;
  }
}
