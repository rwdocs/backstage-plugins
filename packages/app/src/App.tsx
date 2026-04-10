import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import rwPlugin from '@rwdocs/backstage-plugin-rw';

const app = createApp({
  features: [catalogPlugin, searchPlugin, userSettingsPlugin, rwPlugin],
});

export default app.createRoot();
