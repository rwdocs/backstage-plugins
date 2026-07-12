import { memo, useEffect, useRef } from "react";
import { useRouteRef } from "@backstage/core-plugin-api";
import { entityRouteRef, useEntityPresentation } from "@backstage/plugin-catalog-react";
import { parseEntityRef } from "@backstage/catalog-model";
import { buildCommentDeepLinkSuffix } from "@rwdocs/backstage-plugin-rw-common";
import { Button, Flex, Text, ToggleButton, ToggleButtonGroup } from "@backstage/ui";
import { EmptyState, ErrorPanel, Link, Progress } from "@backstage/core-components";
import { BucketCard } from "./BucketCard";
import type { InboxItem } from "../api/RwClient";
import type { ShowFilter, SortOrder } from "./useInboxFilters";
import { useInboxFilters } from "./useInboxFilters";
import { useInboxData } from "./useInboxData";
import { bucketByActivity } from "./inboxBuckets";
import { relativeTime, absoluteTime } from "./timeAgo";

function replyState(replyCount: number): string {
  if (replyCount <= 0) return "No replies yet";
  return `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`;
}

/**
 * Fallback page title derived from the viewer path: humanize the last path
 * segment. Defensive fallback; the backend always populates pageTitle, so
 * this triggers only for malformed/pre-migration payloads.
 */
function docTitlePlaceholder(viewerPath: string): string {
  const last = viewerPath.split("/").filter(Boolean).pop() ?? "";
  const words = last.replace(/[-_]/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Overview";
}

function Dot() {
  return (
    <Text as="span" variant="body-small" color="secondary">
      ·
    </Text>
  );
}

/**
 * A muted link for the context line. The link colour matches the surrounding
 * secondary text so the hover underline isn't drawn in link-blue under grey.
 * Used for the author — the one navigable facet here (handy when you don't
 * recognise who left the comment); the doc title and entity are plain labels.
 */
function MetaLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} style={{ color: "var(--bui-fg-secondary)", textDecorationColor: "currentColor" }}>
      <Text variant="body-small" color="secondary">
        {label}
      </Text>
    </Link>
  );
}

type EntityRoute = (params: { kind: string; namespace: string; name: string }) => string;

/**
 * Filter + sort controls for the inbox list. Two controls, each placed over the
 * column it acts on: a segmented filter on the left (over the prose) and a
 * click-to-flip sort on the right (over the recency rail). React-Aria-based, so
 * selection/press come through `onSelectionChange`/`onPress`, not `onClick`.
 */
function InboxToolbar({
  show,
  sort,
  allCount,
  unansweredCount,
  onShowChange,
  onSortChange,
}: {
  show: ShowFilter;
  sort: SortOrder;
  allCount: number;
  unansweredCount: number;
  onShowChange: (next: ShowFilter) => void;
  onSortChange: (next: SortOrder) => void;
}) {
  const sortLabel =
    sort === "newest"
      ? "Sort by activity, newest first. Activates oldest first."
      : "Sort by activity, oldest first. Activates newest first.";

  return (
    <Flex direction="row" align="center" justify="between" pt="1" pb="6">
      <ToggleButtonGroup
        aria-label="Filter comments"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[show]}
        onSelectionChange={(keys) => {
          // React-Aria's Key is untyped (string | number), so the ToggleButton
          // `id`s below are coupled to ShowFilter only by this guard: a new
          // segment must add its id here and to ShowFilter, or its clicks no-op.
          const next = [...keys][0];
          if (next === "all" || next === "unanswered") onShowChange(next);
        }}
      >
        {/* "Open" not "All": every thread here is open, so this segment is the
            full open set and its count doubles as the page's headline number.
            Counts are parenthesised so the number reads as a count of the label,
            and kept monochrome — the warning token stays on the per-row rail
            ("No replies yet"), where it's contextual and actionable, rather than
            shouting an aggregate magnitude from a nav control. */}
        <ToggleButton id="all">{`Open (${allCount})`}</ToggleButton>
        <ToggleButton id="unanswered">{`Unanswered (${unansweredCount})`}</ToggleButton>
      </ToggleButtonGroup>
      <Button
        variant="tertiary"
        size="small"
        aria-label={sortLabel}
        onPress={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
      >
        {`Activity ${sort === "newest" ? "↓" : "↑"}`}
      </Button>
    </Flex>
  );
}

/**
 * One inbox row. Extracted from the list so the per-row `useEntityPresentation`
 * hooks can run (hooks can't be called inside a `.map` callback). The presentation
 * API resolves the author ref and the owning-entity ref to display names client-side
 * (live from the catalog: an entity's title, or "namespace/name" for a non-default
 * namespace; humanized for refs with no entity, e.g. a guest) — no backend call.
 *
 * Memoised: the list re-renders on every loadMore append, but each row's props
 * (item identity is stable per page, entityRoute and isLast unchanged) don't, so
 * prior rows skip re-rendering and re-running their useEntityPresentation hooks.
 */
const CommentInboxRow = memo(function CommentInboxRow({
  item,
  entityRoute,
  isLast,
}: {
  item: InboxItem;
  entityRoute: EntityRoute;
  isLast: boolean;
}) {
  const authorHref = entityRoute(parseEntityRef(item.author.id));
  const authorName = useEntityPresentation(item.author.id).primaryTitle;

  const entityTitle = useEntityPresentation(item.entityRef).primaryTitle;

  const href = `${entityRoute(parseEntityRef(item.entityRef))}${buildCommentDeepLinkSuffix({ viewerPath: item.viewerPath, commentId: item.commentId })}`;
  const needsReply = item.replyCount <= 0;

  return (
    <Flex
      direction="row"
      align="start"
      gap="2"
      py="2"
      style={{
        // Only vertical padding here: horizontal insets come from CardBody, so
        // the comment text and this divider sit on the card's content edge —
        // flush with the bucket heading above, instead of 12px deeper.
        // The divider separates rows, so the last row in a card omits it — its
        // border would otherwise double up against the card's own bottom edge.
        borderBottom: isLast ? undefined : "1px solid var(--bui-border, rgba(0,0,0,0.08))",
      }}
    >
      {/* Left block — grows. Line 1 is the comment (the hero you read); line 2
          is doc/entity/author context. */}
      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
        {/* Text `truncate` only clips when its own box has a width, so it needs
            display:block — inside the Link it would otherwise be inline (width 0)
            and overflow past the row into the right rail. */}
        <Link
          to={href}
          title={item.bodySnippet}
          // Match the link colour to the bold snippet text (primary fg) and draw
          // the hover underline in currentColor, so it's not the default link-blue
          // under black text — same colour-matching fix as MetaLink below.
          style={{
            display: "block",
            minWidth: 0,
            color: "var(--bui-fg-primary)",
            textDecorationColor: "currentColor",
          }}
        >
          <Text truncate weight="bold" style={{ display: "block" }}>
            {item.bodySnippet}
          </Text>
        </Link>
        {/* One uniform run of muted metadata: doc · entity · author. Deliberately
            doc-first (not the broad→narrow breadcrumb order): the doc title is the
            unique, descriptive field, so leading with it makes each row's context
            line immediately distinct while scanning a date-sorted list. The entity
            (the broader container) follows as a category; the author, least
            decisive for triage, comes last.
            Only the author is a link: the snippet above already links into the
            doc, and the entity's catalog page isn't a triage destination, so doc
            and entity are plain labels. entityTitle/authorName come from
            useEntityPresentation, so the entity already shows its title (or
            "namespace/name" for a non-default namespace) and the author its
            display name. */}
        <Flex direction="row" align="center" gap="1" style={{ flexWrap: "wrap" }}>
          <Text variant="body-small" color="secondary">
            {item.pageTitle || docTitlePlaceholder(item.viewerPath)}
          </Text>
          <Dot />
          <Text variant="body-small" color="secondary">
            {entityTitle}
          </Text>
          <Dot />
          <MetaLink to={authorHref} label={authorName} />
        </Flex>
      </Flex>
      {/* Right rail — fixed width, right-aligned: reply state over recency, so
          the eye scans recency straight down the right edge. */}
      <Flex
        direction="column"
        align="end"
        gap="1"
        style={{ flexShrink: 0, minWidth: 88, textAlign: "right", whiteSpace: "nowrap" }}
      >
        <Text variant="body-small" color={needsReply ? "warning" : "secondary"}>
          {replyState(item.replyCount)}
        </Text>
        <Text as="span" variant="body-small" color="secondary" title={absoluteTime(item.updatedAt)}>
          {relativeTime(item.updatedAt)}
        </Text>
      </Flex>
    </Flex>
  );
});

/**
 * Pagination footer with an IntersectionObserver sentinel for auto-loading on
 * scroll, a "Showing N of M" / "All N shown" status line, and a "Load more"
 * button as the keyboard / no-JS affordance.
 */
function InboxFooter({
  shown,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  // Re-created whenever hasMore or onLoadMore changes so the observer always
  // holds the current callback (avoids a stale closure firing the wrong page's
  // loadMore). The 1px sentinel div stays in the DOM when !hasMore; the early
  // return just skips attaching the observer.
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

  return (
    <Flex direction="column" align="center" gap="2" py="4">
      <Text variant="body-small" color="secondary">
        {hasMore ? `Showing ${shown} of ${total}` : `All ${total} shown`}
      </Text>
      {hasMore && (
        <>
          <div ref={sentinel} aria-hidden style={{ height: 1, width: "100%" }} />
          <Button variant="secondary" size="small" onPress={onLoadMore} isDisabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </>
      )}
    </Flex>
  );
}

export function CommentInboxList() {
  const entityRoute = useRouteRef(entityRouteRef);
  const { show, sort, setShow, setSort } = useInboxFilters();
  const {
    built,
    items,
    openCount,
    unansweredCount,
    hasMore,
    loading,
    hasLoaded,
    loadingMore,
    error,
    loadMore,
  } = useInboxData({ show, sort });

  // Full-page spinner only on the very first load, when there's nothing to show.
  // A filter/sort change refetches with hasLoaded already true: keep the toolbar
  // and the previous results mounted while the new page loads (stale-while-
  // revalidate) so the page updates in place instead of blanking to a spinner.
  if (loading && !hasLoaded) return <Progress />;
  if (error) return <ErrorPanel error={error} />;
  if (!built) {
    return (
      <EmptyState
        missing="info"
        title="Attribution still building…"
        description="Comment ownership is being computed. This page will populate once the first build completes."
      />
    );
  }
  if (openCount === 0) {
    return (
      <EmptyState
        missing="content"
        title="No open comments"
        description="There are no open comments on docs your teams own."
      />
    );
  }

  return (
    // Centre the column to a reading measure. The filter is the page's lead
    // element; each date bucket is its own card below it.
    <div style={{ maxWidth: 900, marginInline: "auto" }}>
      <InboxToolbar
        show={show}
        sort={sort}
        allCount={openCount}
        unansweredCount={unansweredCount}
        onShowChange={setShow}
        onSortChange={setSort}
      />
      {items.length === 0 ? (
        <Text variant="body-small" color="secondary" style={{ padding: "8px 12px" }}>
          No unanswered threads — every open thread has at least one reply.
        </Text>
      ) : (
        // Date.now() is read at render (not memoised): bucket boundaries are
        // relative to "now", so a frozen value would mis-bucket threads as the
        // page stays open. items is already filtered + sorted by the backend, and
        // bucket order is derived from that item order (not the `sort` flag) so the
        // headers can't flip ahead of the rows during a sort-change refetch.
        <Flex direction="column" gap="5">
          {bucketByActivity(items, Date.now()).map((bucket) => (
            <BucketCard key={bucket.key} label={bucket.label}>
              <Flex direction="column" gap="0">
                {bucket.items.map((item, index) => (
                  <CommentInboxRow
                    key={item.commentId}
                    item={item}
                    entityRoute={entityRoute}
                    isLast={index === bucket.items.length - 1}
                  />
                ))}
              </Flex>
            </BucketCard>
          ))}
        </Flex>
      )}
      {/* Auto-load on scroll: the sentinel sits just below the last card; when it
          enters the viewport we fetch the next page. The button is the keyboard/no-JS
          fallback and the visible affordance. */}
      <InboxFooter
        shown={items.length}
        total={show === "unanswered" ? unansweredCount : openCount}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
