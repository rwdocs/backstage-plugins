/** The prefix-free, shared portion of a comment deep link: the docs path under an
 *  entity plus the comment anchor. The catalog-route prefix (`/catalog/<ns>/<kind>/<name>`)
 *  is NOT included — the frontend resolves it via its catalog routeRef, and the
 *  notifications backend module composes it from the convention. Keeping the prefix out
 *  of here is deliberate: no frontend routing assumption leaks into shared/backend code. */
export function buildCommentDeepLinkSuffix(args: {
  viewerPath: string;
  commentId: string;
}): string {
  const seg = args.viewerPath ? `/${args.viewerPath}` : "";
  return `/docs${seg}#comment-${args.commentId}`;
}
