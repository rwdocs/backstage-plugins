import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import rwPlugin from '@rwdocs/backstage-plugin-rw';
import { devSignInPage } from './devSignInPage';

const app = createApp({
  // devSignInPage (Alice/Bob picker) is always included: this instance is a
  // demo/test stand for the plugins, never a production build.
  features: [catalogPlugin, searchPlugin, userSettingsPlugin, rwPlugin, devSignInPage],
});

export default app.createRoot();
