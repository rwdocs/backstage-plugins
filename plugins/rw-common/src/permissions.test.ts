import {
  RESOURCE_TYPE_RW_COMMENT,
  rwCommentReadPermission,
  rwCommentCreatePermission,
  rwCommentResolvePermission,
  rwCommentEditPermission,
  rwCommentDeletePermission,
  rwCommentPermissions,
  rwCommentResourcePermissions,
} from "./permissions";

describe("rw comment permissions", () => {
  it("read and create are basic permissions (no resourceType)", () => {
    expect(rwCommentReadPermission.name).toBe("rwComment.read");
    expect(rwCommentReadPermission.attributes.action).toBe("read");
    expect((rwCommentReadPermission as { resourceType?: string }).resourceType).toBeUndefined();

    expect(rwCommentCreatePermission.name).toBe("rwComment.create");
    expect(rwCommentCreatePermission.attributes.action).toBe("create");
    expect((rwCommentCreatePermission as { resourceType?: string }).resourceType).toBeUndefined();
  });

  it("resolve/edit/delete are resource permissions of type rw-comment", () => {
    expect(RESOURCE_TYPE_RW_COMMENT).toBe("rw-comment");
    for (const p of [
      rwCommentResolvePermission,
      rwCommentEditPermission,
      rwCommentDeletePermission,
    ]) {
      expect((p as { resourceType?: string }).resourceType).toBe("rw-comment");
    }
    expect(rwCommentResolvePermission.name).toBe("rwComment.resolve");
    expect(rwCommentResolvePermission.attributes.action).toBe("update");
    expect(rwCommentEditPermission.name).toBe("rwComment.edit");
    expect(rwCommentEditPermission.attributes.action).toBe("update");
    expect(rwCommentDeletePermission.name).toBe("rwComment.delete");
    expect(rwCommentDeletePermission.attributes.action).toBe("delete");
  });

  it("aggregate arrays contain the right members", () => {
    expect(rwCommentPermissions).toHaveLength(5);
    expect(rwCommentResourcePermissions).toEqual([
      rwCommentResolvePermission,
      rwCommentEditPermission,
      rwCommentDeletePermission,
    ]);
  });

  it("permission names are unique", () => {
    const names = rwCommentPermissions.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
