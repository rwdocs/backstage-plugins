import { CommentActivity } from "@rwdocs/backstage-plugin-rw-node";
import { CommentRecipientResolver } from "./CommentRecipientResolver";
import { isNewThread } from "./activityKind";

/** The built-in recipient policy: a new top-level thread notifies the section's effective owner;
 *  a reply or resolve notifies the thread's prior participants. Stateless and never throws, so a
 *  custom resolver can construct one and delegate the audiences it doesn't override. */
export class DefaultCommentRecipientResolver implements CommentRecipientResolver {
  getName(): string {
    return "rw-default-recipients";
  }

  async resolveRecipients(activity: CommentActivity): Promise<string[]> {
    if (isNewThread(activity)) {
      return activity.sectionOwnerRef ? [activity.sectionOwnerRef] : [];
    }
    return activity.participants;
  }
}
