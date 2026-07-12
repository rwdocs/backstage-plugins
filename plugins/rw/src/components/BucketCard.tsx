import type { ReactNode } from "react";
import { Card, CardBody, Text } from "@backstage/ui";

/**
 * The card's horizontal content inset — 20px, widened from BUI's default 12px
 * (--bui-space-3), which sits too tight against the card border at this reading
 * width. The outside bucket label uses the same inset, so the label and the
 * card's content share one left edge.
 */
const cardInset = { paddingInline: "var(--bui-space-5)" } as const;

/**
 * The bucket date label — a quiet recency marker, not a headline. It sits
 * outside the card as a section divider on the page background: small,
 * uppercase, letter-spaced and muted so the content below leads; inset to the
 * card's content edge so the label and content share one left edge. Stays an
 * <h2> for a11y (an h2 under the route's h1).
 */
const bucketLabelStyle = {
  margin: "0 0 8px",
  paddingInline: "var(--bui-space-5)",
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--bui-fg-secondary)",
} as const;

/**
 * One date-bucket section: a demoted date label outside the card, then a card
 * holding that bucket's rows. Shared by the Changes feed and the Comments inbox
 * so the two tabs stay in visual lockstep — put every date-bucketed list on this.
 */
export function BucketCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text as="h2" style={bucketLabelStyle}>
        {label}
      </Text>
      <Card>
        <CardBody style={cardInset}>{children}</CardBody>
      </Card>
    </div>
  );
}
