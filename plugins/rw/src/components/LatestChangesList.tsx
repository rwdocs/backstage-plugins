import { memo, useEffect, useRef } from "react";
import { useRouteRef } from "@backstage/core-plugin-api";
import { entityRouteRef, useEntityPresentation } from "@backstage/plugin-catalog-react";
import { parseEntityRef } from "@backstage/catalog-model";
import { buildDocsPageLinkSuffix } from "@rwdocs/backstage-plugin-rw-common";
import { Button, Card, CardBody, CardHeader, Flex, Text } from "@backstage/ui";
import { EmptyState, ErrorPanel, Link, Progress } from "@backstage/core-components";
import type { LatestChangeItem } from "../api/RwClient";
import { useLatestChangesData } from "./useLatestChangesData";
import { bucketByTime } from "./recencyBuckets";
import { relativeTime, absoluteTime } from "./timeAgo";

type EntityRoute = (params: { kind: string; namespace: string; name: string }) => string;

/**
 * One latest-changes row. Extracted from the list so the per-row
 * `useEntityPresentation` hook can run (hooks can't be called inside a
 * `.map` callback). Memoised for the same reason as CommentInboxRow: the list
 * re-renders on every loadMore append, but prior rows' props are stable, so
 * they skip re-rendering and re-resolving their entity presentation.
 */
const LatestChangeRow = memo(function LatestChangeRow({
  item,
  entityRoute,
  isLast,
}: {
  item: LatestChangeItem;
  entityRoute: EntityRoute;
  isLast: boolean;
}) {
  const entityTitle = useEntityPresentation(item.entityRef).primaryTitle;
  // The rendered page lives under the entity's Documentation tab (`/docs`) at its
  // viewer path — same location the comment inbox links to, via the shared suffix
  // builder so the two can't drift on the `/docs` segment.
  const href = `${entityRoute(parseEntityRef(item.entityRef))}${buildDocsPageLinkSuffix(
    item.viewerPath,
  )}`;

  return (
    <Flex
      direction="row"
      align="start"
      gap="2"
      py="2"
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--bui-border, rgba(0,0,0,0.08))",
      }}
    >
      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
        <Link
          to={href}
          style={{
            display: "block",
            minWidth: 0,
            color: "var(--bui-fg-primary)",
            textDecorationColor: "currentColor",
          }}
        >
          <Text truncate weight="bold" style={{ display: "block" }}>
            {item.title}
          </Text>
        </Link>
        <Text variant="body-small" color="secondary">
          {entityTitle}
        </Text>
      </Flex>
      {/* Time in a right-aligned column — mirrors CommentInboxRow and lets the
          eye scan recency down the row's trailing edge. */}
      <Text
        as="span"
        variant="body-small"
        color="secondary"
        title={absoluteTime(item.lastModified)}
        style={{ flexShrink: 0, minWidth: 88, textAlign: "right", whiteSpace: "nowrap" }}
      >
        {relativeTime(item.lastModified)}
      </Text>
    </Flex>
  );
});

/**
 * Widen the card's horizontal padding from BUI's default 12px (--bui-space-3)
 * to 20px, matching CommentInboxList so the two tabs share the same reading
 * rhythm. Applied identically to header and body so the bucket heading and
 * the rows share one content edge.
 */
const cardInset = { paddingInline: "var(--bui-space-5)" } as const;

/**
 * Pagination footer with an IntersectionObserver sentinel for auto-loading on
 * scroll and a "Load more" button as the keyboard / no-JS affordance. Unlike
 * InboxFooter, this feed has no total count from the server, so there's no
 * "Showing N of M" status line — the footer renders nothing once hasMore is
 * false.
 */
function LatestChangesFooter({
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return undefined;
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) return null;
  return (
    <Flex direction="column" align="center" gap="2" py="4">
      <div ref={sentinel} aria-hidden style={{ height: 1, width: "100%" }} />
      <Button variant="secondary" size="small" onPress={onLoadMore} isDisabled={loadingMore}>
        {loadingMore ? "Loading…" : "Load more"}
      </Button>
    </Flex>
  );
}

export function LatestChangesList() {
  const entityRoute = useRouteRef(entityRouteRef);
  const { hasAnyDated, items, hasMore, loading, hasLoaded, loadingMore, error, loadMore } =
    useLatestChangesData();

  // Full-page spinner only on the very first load, when there's nothing to
  // show yet (same rule as CommentInboxList).
  if (loading && !hasLoaded) return <Progress />;
  if (error) return <ErrorPanel error={error} />;
  if (items.length === 0) {
    return hasAnyDated ? (
      <EmptyState
        missing="content"
        title="No recent changes"
        description="No documentation pages have been updated recently."
      />
    ) : (
      <EmptyState
        missing="info"
        title="Still indexing…"
        description="Recent changes are being indexed. This page will populate once the first scan completes."
      />
    );
  }

  return (
    // Centre the column to a reading measure, matching CommentInboxList.
    <div style={{ maxWidth: 900, marginInline: "auto" }}>
      <Flex direction="column" gap="3">
        {/* Date.now() is read at render (not memoised): bucket boundaries are
            relative to "now", so a frozen value would mis-bucket items as the
            page stays open. */}
        {bucketByTime(items, (it) => it.lastModified, Date.now()).map((bucket) => (
          <Card key={bucket.key}>
            <CardHeader style={cardInset}>
              <Text as="h2" variant="title-small" weight="bold">
                {bucket.label}
              </Text>
            </CardHeader>
            <CardBody style={cardInset}>
              <Flex direction="column" gap="0">
                {bucket.items.map((item, index) => (
                  <LatestChangeRow
                    key={`${item.entityRef}/${item.viewerPath}`}
                    item={item}
                    entityRoute={entityRoute}
                    isLast={index === bucket.items.length - 1}
                  />
                ))}
              </Flex>
            </CardBody>
          </Card>
        ))}
      </Flex>
      <LatestChangesFooter hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
