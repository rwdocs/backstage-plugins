export interface ParsedAnnotation {
  entityRef: string;
  scope: string | undefined;
}

export function parseAnnotation(
  value: string | undefined,
  selfEntityRef: string,
): ParsedAnnotation | undefined {
  if (!value) return undefined;

  const colonIndex = value.indexOf(":");
  let entity: string;
  let scope: string | undefined;

  if (colonIndex === -1) {
    entity = value;
    scope = undefined;
  } else {
    entity = value.slice(0, colonIndex);
    scope = value.slice(colonIndex + 1);
  }

  if (entity === ".") {
    entity = selfEntityRef;
  }

  return { entityRef: entity, scope };
}
