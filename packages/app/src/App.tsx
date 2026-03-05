import { createApp } from '@backstage/frontend-defaults';
import rwPlugin from '@rwdocs/backstage-plugin-rw';

const app = createApp({
  features: [rwPlugin],
});

export default app.createRoot();
