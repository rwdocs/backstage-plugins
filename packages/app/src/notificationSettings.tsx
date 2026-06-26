import { createFrontendModule, SubPageBlueprint } from '@backstage/frontend-plugin-api';
import { Content } from '@backstage/core-components';
import { UserNotificationSettingsCard } from '@backstage/plugin-notifications';

// The new-frontend-system notifications plugin (@backstage/plugin-notifications/alpha)
// ships only a page + api — it does NOT contribute a user-settings tab. Upstream calls
// this out explicitly under "User Settings Tab (Not Included by Default)". This module
// wires the settings card into the user-settings page as a "Notifications" sub-tab,
// using the same SubPageBlueprint mechanism as the built-in "General" tab: its default
// attachTo resolves to the un-named settings page (page:user-settings), so no explicit
// attachTo is required.
const notificationsSettingsSubPage = SubPageBlueprint.make({
  name: 'notifications',
  params: {
    path: 'notifications',
    title: 'Notifications',
    // originNames maps notification origin ids to human-readable labels in the toggles.
    // The notifications backend records origin = credentials.principal.subject; our
    // doc-comment notifications are sent by the rw plugin's notifications module, whose
    // service principal subject is "plugin:rw". topicNames does the same for the
    // per-kind topic ids (see the module README's "Notification topics").
    loader: async () => (
      <Content>
        <UserNotificationSettingsCard
          originNames={{ 'plugin:rw': 'Docs' }}
          topicNames={{
            'comment:thread:created': 'New threads',
            'comment:reply:created': 'Replies',
            'comment:thread:resolved': 'Resolved threads',
          }}
        />
      </Content>
    ),
  },
});

// pluginId "user-settings" so the sub-page attaches to that plugin's settings page.
export const notificationSettingsModule = createFrontendModule({
  pluginId: 'user-settings',
  extensions: [notificationsSettingsSubPage],
});
