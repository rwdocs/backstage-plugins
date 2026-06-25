import type {
  AuthService,
  BackstageCredentials,
  UserInfoService,
} from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import { parseEntityRef } from "@backstage/catalog-model";
import { AuthorProfile, CommentRow } from "./types";

/**
 * Shapes the display author ({ id, name, avatarUrl? }) from a comment row's
 * stored author_ref + author_profile snapshot. Shared by the thread view
 * (toCommentResponse) and the inbox (toInboxItem) so both render an author
 * identically; the name falls back to the humanized entity name when there's
 * no profile snapshot.
 */
export function authorFromRow(row: Pick<CommentRow, "author_ref" | "author_profile">): {
  id: string;
  name: string;
  avatarUrl?: string;
} {
  const profile: AuthorProfile | null = row.author_profile ? JSON.parse(row.author_profile) : null;
  return {
    id: row.author_ref,
    name: profile?.displayName ?? parseEntityRef(row.author_ref).name,
    ...(profile?.picture ? { avatarUrl: profile.picture } : {}),
  };
}

export async function resolveAuthor(deps: {
  userInfo: UserInfoService;
  auth: AuthService;
  catalog: CatalogService;
  credentials: BackstageCredentials;
}): Promise<{ authorRef: string; authorProfile?: AuthorProfile }> {
  const { userInfo, auth, catalog, credentials } = deps;
  const { userEntityRef } = await userInfo.getUserInfo(credentials);

  const serviceCreds = await auth.getOwnServiceCredentials();
  let entity: Awaited<ReturnType<typeof catalog.getEntityByRef>>;
  try {
    entity = await catalog.getEntityByRef(userEntityRef, { credentials: serviceCreds });
  } catch {
    return { authorRef: userEntityRef };
  }

  const profile = entity?.spec?.profile as { displayName?: string; picture?: string } | undefined;
  if (profile?.displayName || profile?.picture) {
    return {
      authorRef: userEntityRef,
      authorProfile: {
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        ...(profile.picture ? { picture: profile.picture } : {}),
      },
    };
  }
  return { authorRef: userEntityRef };
}
