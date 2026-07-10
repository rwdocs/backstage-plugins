/** Where a rendered doc page lives under its entity: the Documentation
 *  content-tab path (`/docs`) plus the viewer path. The catalog-route prefix
 *  (`/catalog/<ns>/<kind>/<name>`) is NOT included — the frontend resolves it via
 *  its catalog routeRef, and the notifications backend module composes it from the
 *  convention. Keeping the prefix out of here is deliberate: no frontend routing
 *  assumption leaks into shared/backend code.
 *
 *  This is the single source of truth for that path so the comment deep link and
 *  the Latest Changes feed can't drift on the `/docs` tab segment. */
export function buildDocsPageLinkSuffix(viewerPath: string): string {
  const seg = viewerPath ? `/${viewerPath}` : "";
  return `/docs${seg}`;
}

/** The prefix-free, shared portion of a comment deep link: the docs-page path
 *  (see {@link buildDocsPageLinkSuffix}) plus the comment anchor. */
export function buildCommentDeepLinkSuffix(args: {
  viewerPath: string;
  commentId: string;
}): string {
  return `${buildDocsPageLinkSuffix(args.viewerPath)}#comment-${args.commentId}`;
}
