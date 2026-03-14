export interface Config {
  rw?: {
    /**
     * Entity ref for the standalone /docs page.
     * Format: "namespace/kind/name"
     *
     * @visibility frontend
     */
    rootEntity?: string;
  };
}
