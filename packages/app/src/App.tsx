import { createApp } from '@backstage/frontend-defaults';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { ThemeBlueprint } from '@backstage/plugin-app-react';
import { UnifiedThemeProvider, themes } from '@backstage/theme';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';
import rwPlugin from '@rwdocs/backstage-plugin-rw';

const lightTheme = ThemeBlueprint.make({
  name: 'light',
  params: {
    theme: {
      id: 'light',
      title: 'Light',
      variant: 'light',
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={themes.light} children={children} />
      ),
    },
  },
});

const darkTheme = ThemeBlueprint.make({
  name: 'dark',
  params: {
    theme: {
      id: 'dark',
      title: 'Dark',
      variant: 'dark',
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={themes.dark} children={children} />
      ),
    },
  },
});

const themeModule = createFrontendModule({
  pluginId: 'app',
  extensions: [lightTheme, darkTheme],
});

const app = createApp({
  features: [themeModule, catalogPlugin, userSettingsPlugin, rwPlugin],
});

export default app.createRoot();
