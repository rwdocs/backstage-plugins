import { Container } from "@backstage/ui";
import { LatestChangesList } from "./LatestChangesList";

export function LatestChangesPage() {
  // No <Header>: this is the "Latest Changes" tab body of the Docs page; the
  // framework PageLayout renders the "Docs" header + tab strip for this route.
  // <Container> (not core-components <Page>/<Content>) so the page scrolls at the
  // document level and the plugin header scrolls away with the content.
  return (
    <Container>
      <LatestChangesList />
    </Container>
  );
}
