export interface ListingSection {
  sectionRef: string;
  path: string;
  ancestors: string[];
}

export interface ListingPage {
  sectionRef: string;
  subpath: string;
  path: string;
  anchors: Array<{ sectionRef: string; subpath: string }>;
}

function enclosingRefs(path: string, byPath: Map<string, string>): string[] {
  const refs: string[] = [];
  let cursor = path;
  while (cursor !== "") {
    const slash = cursor.lastIndexOf("/");
    cursor = slash < 0 ? "" : cursor.slice(0, slash);
    const ref = byPath.get(cursor);
    if (ref !== undefined) refs.push(ref);
  }
  return refs;
}

function joinedPath(root: string | undefined, subpath: string): string | undefined {
  if (root === undefined) return undefined;
  return root && subpath ? `${root}/${subpath}` : root || subpath;
}

/**
 * Projects physical listings onto canonical section identities.
 *
 * Uses `resolveSectionPath` to select roots for duplicate section refs.
 * Independently named descendants remain, with only valid physical ancestry.
 *
 * @throws If a duplicate ref resolves to null or a path absent from its group.
 * @throws Propagates errors from `resolveSectionPath`.
 */
export async function projectSiteListing<S extends ListingSection, P extends ListingPage>(
  sections: S[],
  pages: P[],
  resolveSectionPath: (sectionRef: string) => Promise<string | null>,
): Promise<{
  sections: S[];
  pages: P[];
  diagnostics: { collidingRefs: number; omittedSections: number; omittedPages: number };
}> {
  const groups = new Map<string, S[]>();
  for (const section of sections) {
    const group = groups.get(section.sectionRef);
    if (group) group.push(section);
    else groups.set(section.sectionRef, [section]);
  }
  const selected = await Promise.all(
    Array.from(groups, async ([ref, group]) => {
      if (group.length === 1) return group[0];
      const path = await resolveSectionPath(ref);
      const winner = path === null ? undefined : group.find((section) => section.path === path);
      if (!winner) throw new Error(`Cannot resolve canonical section root for ${ref}`);
      return winner;
    }),
  );
  const rootByRef = new Map(selected.map((section) => [section.sectionRef, section.path]));
  const refByPath = new Map(selected.map((section) => [section.path, section.sectionRef]));
  const projectedSections = selected.map((section) => ({
    ...section,
    ancestors: enclosingRefs(section.path, refByPath),
  }));
  const projectedPages = pages
    .filter((page) => joinedPath(rootByRef.get(page.sectionRef), page.subpath) === page.path)
    .map((page) => ({
      ...page,
      anchors: page.anchors.filter(
        (anchor) => joinedPath(rootByRef.get(anchor.sectionRef), anchor.subpath) === page.path,
      ),
    }));
  return {
    sections: projectedSections,
    pages: projectedPages,
    diagnostics: {
      collidingRefs: Array.from(groups.values()).filter((group) => group.length > 1).length,
      omittedSections: sections.length - projectedSections.length,
      omittedPages: pages.length - projectedPages.length,
    },
  };
}
