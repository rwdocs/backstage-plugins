export interface Config {
  /** @visibility backend */
  rw?: {
    /**
     * Local directory containing documentation source files.
     * Mutually exclusive with `s3`.
     */
    projectDir?: string;
    /**
     * Entity ref that the local projectDir serves as (required when projectDir is set).
     * Format: "namespace/kind/name"
     */
    entity?: string;
    /** URL prefix for generated links (e.g. "/docs"). Shared across all sites. */
    linkPrefix?: string;
    /**
     * Entity ref for the standalone /docs page.
     * Format: "namespace/kind/name"
     * @visibility frontend
     */
    rootEntity?: string;
    /** Maximum number of cached RwSite instances. Default: 20. */
    cacheSize?: number;
    /**
     * S3 storage configuration. Shared across all entity sites.
     * Mutually exclusive with `projectDir`.
     */
    s3?: {
      /** S3 bucket name. */
      bucket: string;
      /** AWS region. */
      region?: string;
      /** Custom S3 endpoint URL. */
      endpoint?: string;
      /** Root path within the bucket. */
      bucketRootPath?: string;
      /** AWS access key ID. */
      accessKeyId?: string;
      /**
       * AWS secret access key.
       * @visibility secret
       */
      secretAccessKey?: string;
    };
    /** Diagram rendering configuration. Shared across all sites. */
    diagrams?: {
      /** Kroki server URL for rendering diagrams. */
      krokiUrl?: string;
      /** Diagram rendering DPI. */
      dpi?: number;
    };
  };
}
