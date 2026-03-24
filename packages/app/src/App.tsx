import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import rwPlugin from '@rwdocs/backstage-plugin-rw';

const app = createApp({
  features: [catalogPlugin, userSettingsPlugin, rwPlugin],
});

export default app.createRoot();
