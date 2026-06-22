import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createProxyAuthProviderFactory,
  createProxyAuthenticator,
} from '@backstage/plugin-auth-node';
import type { SignInResolver } from '@backstage/plugin-auth-node';

// Dev-only fixed identities. The provider id IS the user.
const DEV_USERS = ['alice', 'bob'] as const;

// A no-op proxy authenticator: there is nothing to authenticate — the chosen
// provider determines the user.
function fixedUserAuthenticator() {
  return createProxyAuthenticator({
    defaultProfileTransform: async () => ({ profile: {} }),
    initialize(_ctx) {
      return {};
    },
    async authenticate(_options, _ctx) {
      return { result: {} };
    },
  });
}

// Signs the caller in as a fixed catalog user (real profile + ownership);
// falls back to a bare token if the entity isn't in the catalog yet.
function signInAsUser(userEntityRef: string): SignInResolver<{}> {
  return async (_info, ctx) => {
    try {
      return await ctx.signInWithCatalogUser({ entityRef: userEntityRef });
    } catch {
      return ctx.issueToken({
        claims: { sub: userEntityRef, ent: [userEntityRef] },
      });
    }
  };
}

export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'dev-users-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        // The authenticator is stateless and identical for every provider.
        const authenticator = fixedUserAuthenticator();
        for (const name of DEV_USERS) {
          providers.registerProvider({
            providerId: name,
            factory: createProxyAuthProviderFactory({
              authenticator,
              signInResolver: signInAsUser(`user:default/${name}`),
            }),
          });
        }
      },
    });
  },
});
