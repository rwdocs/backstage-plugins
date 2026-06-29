import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
// Dev Alice/Bob auth providers — this instance is a demo/test stand, never a
// production build.
backend.add(import('./devUsersAuthModule'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'));
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'));
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@rwdocs/backstage-plugin-rw-backend'));
backend.add(import('@rwdocs/backstage-plugin-search-backend-module-rw'));
// Doc-comment notifications: the native notifications + signals backends, plus
// the opt-in rw notifications module that registers a CommentProcessor on rw-backend's
// comment-processing extension point.
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));
backend.add(import('@rwdocs/backstage-plugin-rw-backend-module-notifications'));

backend.start();
