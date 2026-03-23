export interface Config {
  rw?: {
    /**
     * Entity ref for the standalone /docs page.
     * Standard Backstage entity ref format: "kind:namespace/name" (e.g. "component:default/my-docs")
     *
     * @visibility frontend
     */
    rootEntity?: string;
    /**
     * Section ref for the standalone /docs page.
     * If not set, defaults to rootEntity value.
     *
     * @visibility frontend
     */
    rootSectionRef?: string;
  };
}
