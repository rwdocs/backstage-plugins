import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouteRef } from "@backstage/core-plugin-api";
import { entityRouteRef, useEntityPresentation } from "@backstage/plugin-catalog-react";
import { parseEntityRef } from "@backstage/catalog-model";
import { buildDocsPageLinkSuffix } from "@rwdocs/backstage-plugin-rw-common";
import { Button, Flex, Text } from "@backstage/ui";
import { EmptyState, ErrorPanel, Link, Progress } from "@backstage/core-components";
import { BucketCard } from "./BucketCard";
import type { LatestChangeItem } from "../api/RwClient";
import { useLatestChangesData } from "./useLatestChangesData";
import { bucketByTime } from "./recencyBuckets";
import type { RecencyBucket } from "./recencyBuckets";
import { groupByServiceAndDay } from "./serviceGroups";
import type { ServiceGroup } from "./serviceGroups";
import { groupDayLabel, absoluteTime } from "./timeAgo";

type EntityRoute = (params: { kind: string; namespace: string; name: string }) => string;

/** Show at most this many pages inline in a service group; the rest collapse
 *  behind a "+N more" disclosure so a large deploy stays a bounded block. */
const MAX_VISIBLE_PAGES = 5;

const HAIRLINE = "1px solid var(--bui-border, rgba(0,0,0,0.08))";

/** The page lives under the owning entity's Documentation tab (`/docs`) at its
 *  viewer path — the same location the comment inbox links to, via the shared
 *  suffix builder so the two can't drift on the `/docs` segment. */
function pageHref(entityRoute: EntityRoute, item: LatestChangeItem): string {
  return `${entityRoute(parseEntityRef(item.entityRef))}${buildDocsPageLinkSuffix(
    item.viewerPath,
  )}`;
}

/** One page inside an entry: its linked title, regular weight (color, not weight,
 *  marks it as the content). The first page of a group also carries the group's
 *  `meta` on the right of its line — service, count, date — so recency scans down
 *  the right edge; the rest of the pages are title-only. */
function GroupPageLink({
  item,
  entityRoute,
  meta,
}: {
  item: LatestChangeItem;
  entityRoute: EntityRoute;
  meta?: ReactNode;
}) {
  return (
    <li style={{ padding: "3px 0", minWidth: 0 }}>
      <Flex direction="row" align="baseline" gap="2">
        <Link
          to={pageHref(entityRoute, item)}
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--bui-fg-primary)",
            textDecorationColor: "currentColor",
          }}
        >
          <Text truncate style={{ display: "block" }}>
            {item.title}
          </Text>
        </Link>
        {meta}
      </Flex>
    </li>
  );
}

const pageListStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

/** The "Show all" / "Show less" toggle: a bare button styled as a quiet control
 *  (no native disclosure triangle) that trails the service on the entry's footer
 *  line. It inherits the footer's font; color, hover, and keyboard focus live in
 *  `DISCLOSURE_CLASS`'s stylesheet — inline styles can't express
 *  :hover/:focus-visible, and a bare <button> otherwise renders with no visible
 *  keyboard focus (it escapes Backstage's focus baseline). */
const disclosureStyle = {
  appearance: "none",
  background: "none",
  border: 0,
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
} as const;

/** The entry's footer line — muted: the owning service, then the "Show all"
 *  toggle when the batch is truncated. (Count and date ride the first page's
 *  line instead.) */
const footerStyle = {
  display: "flex",
  alignItems: "center",
  marginTop: 4,
  fontSize: "0.75rem",
  color: "var(--bui-fg-secondary)",
} as const;

const DISCLOSURE_CLASS = "rw-changes-disclosure";

/** Rendered once at the feed root. Gives the bare disclosure button its resting
 *  color, a hover affordance (so it looks interactive), and — the quality-floor
 *  fix — a visible keyboard focus ring. */
const disclosureCss = `
.${DISCLOSURE_CLASS} { color: var(--bui-fg-secondary); }
.${DISCLOSURE_CLASS}:hover { color: var(--bui-fg-primary); text-decoration: underline; }
.${DISCLOSURE_CLASS}:focus-visible {
  outline: 2px solid var(--bui-fg-primary, #000);
  outline-offset: 2px;
  border-radius: 4px;
}
`;

const captionSep = { padding: "0 5px" } as const;

/**
 * One feed entry: a service's changed page(s), content first. The changed page
 * titles lead; the page count and most-recent day ride the right of the first
 * (most-recent) page's line, so recency scans down the right edge. A muted footer
 * closes the entry with the owning service and — past MAX_VISIBLE_PAGES — a "Show
 * all" toggle. A single change is just an entry with one page (title + date) and
 * a service footer, so singles and batches share one anatomy.
 *
 * memo can't skip this on loadMore: `group` is rebuilt each render, so the block
 * re-renders and re-resolves its presentation. That's cheap — Backstage's
 * EntityPresentationApi caches by ref — and keeps grouping a pure function of the
 * current list.
 */
const ServiceGroupBlock = memo(function ServiceGroupBlock({
  group,
  entityRoute,
  isLast,
}: {
  group: ServiceGroup;
  entityRoute: EntityRoute;
  isLast: boolean;
}) {
  const entityTitle = useEntityPresentation(group.entityRef).primaryTitle;
  const [expanded, setExpanded] = useState(false);
  const latest = group.items[0];
  const count = group.items.length;
  const overflow = count - MAX_VISIBLE_PAGES;
  const shown = expanded ? group.items : group.items.slice(0, MAX_VISIBLE_PAGES);
  // Day-precise (not bare relative) so two of a service's different days don't
  // both read "1w ago" — the group is one day, so the label names that day.
  const time = groupDayLabel(latest.lastModified);

  // Rides the first page's line, right-aligned: how many changed and when.
  const meta = (
    <Text
      as="span"
      variant="body-small"
      color="secondary"
      style={{ flexShrink: 0, whiteSpace: "nowrap" }}
    >
      {count > 1 && (
        <>
          <span>{count} pages</span>
          <span aria-hidden style={captionSep}>
            ·
          </span>
        </>
      )}
      <span title={absoluteTime(latest.lastModified)}>{time}</span>
    </Text>
  );

  return (
    <div style={{ padding: "10px 0 8px", borderBottom: isLast ? undefined : HAIRLINE }}>
      {/* Content first: the changed page titles lead; count + date ride the first
          page's line on the right. */}
      <ul style={pageListStyle}>
        {shown.map((item, index) => (
          <GroupPageLink
            key={`${item.entityRef}/${item.viewerPath}`}
            item={item}
            entityRoute={entityRoute}
            meta={index === 0 ? meta : undefined}
          />
        ))}
      </ul>

      {/* Footer: the owning service, and the expand toggle when truncated. */}
      <div style={footerStyle}>
        <span>{entityTitle}</span>
        {overflow > 0 && (
          <>
            <span aria-hidden style={captionSep}>
              ·
            </span>
            <button
              type="button"
              className={DISCLOSURE_CLASS}
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              style={disclosureStyle}
            >
              {expanded ? "Show less" : "Show all"}
            </button>
          </>
        )}
      </div>
    </div>
  );
});

/**
 * One recency-bucket section. Its changes are grouped by service and day and
 * every group — one page or many — renders as a `ServiceGroupBlock`, so single
 * changes and batches share one anatomy. Grouping by day (not just service)
 * matters here because "Previous 7 days" and "Earlier" span many days: without it
 * a service's separate days would merge into one entry with one misleading time.
 * A hairline between groups gives one divider rhythm.
 */
function BucketSection({
  bucket,
  entityRoute,
}: {
  bucket: RecencyBucket<LatestChangeItem>;
  entityRoute: EntityRoute;
}) {
  const groups = groupByServiceAndDay(bucket.items);
  return (
    <BucketCard label={bucket.label}>
      <Flex direction="column" gap="0">
        {groups.map((group, index) => (
          // Key on service + the group's most-recent time: a service can now
          // appear more than once in a bucket (different days), so entityRef
          // alone isn't unique. The most-recent item is stable across loadMore
          // (older pages append), so expanded state persists.
          <ServiceGroupBlock
            key={`${group.entityRef} ${group.items[0].lastModified}`}
            group={group}
            entityRoute={entityRoute}
            isLast={index === groups.length - 1}
          />
        ))}
      </Flex>
    </BucketCard>
  );
}

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
      {/* Scoped styles for the disclosure toggle's hover + keyboard focus. */}
      <style>{disclosureCss}</style>
      {/* gap between whole date sections (each is an outside label + its card);
          wider than the 8px label→card gap so a section reads as one unit. */}
      <Flex direction="column" gap="5">
        {/* Date.now() is read at render (not memoised): bucket boundaries are
            relative to "now", so a frozen value would mis-bucket items as the
            page stays open. */}
        {bucketByTime(items, (it) => it.lastModified, Date.now()).map((bucket) => (
          <BucketSection key={bucket.key} bucket={bucket} entityRoute={entityRoute} />
        ))}
      </Flex>
      <LatestChangesFooter hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
