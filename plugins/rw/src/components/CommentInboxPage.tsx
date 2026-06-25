import { Container } from "@backstage/ui";
import { CommentInboxList } from "./CommentInboxList";

export function CommentInboxPage() {
  // No <Header>: this is the "Comments" tab body of the Docs page; the framework
  // PageLayout already renders the "Docs" header + tab strip for this route.
  // BUI's <Container> (page-level padding + max width) instead of core-components
  // <Page>/<Content>: the latter wrap the page in an inner overflow:auto pane that
  // pins the app-shell plugin header, whereas Container is a plain flow wrapper, so
  // — like the catalog — the page scrolls at the document level and the header
  // scrolls away with the content.
  return (
    <Container>
      <CommentInboxList />
    </Container>
  );
}
