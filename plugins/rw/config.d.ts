export interface Config {
  rw?: {
    /**
     * Entity ref for the standalone /docs page.
     * Standard Backstage entity ref format: "kind:namespace/name" (e.g. "component:default/my-docs")
     *
     * @visibility frontend
     */
    rootEntity?: string;
  };
}
