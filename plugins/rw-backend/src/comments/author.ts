import type {
  AuthService,
  BackstageCredentials,
  UserInfoService,
} from "@backstage/backend-plugin-api";
import type { CatalogService } from "@backstage/plugin-catalog-node";
import { AuthorProfile } from "./types";

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
