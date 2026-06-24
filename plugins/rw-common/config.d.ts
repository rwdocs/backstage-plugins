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
     * Standard Backstage entity ref format: "kind:namespace/name" (e.g. "component:default/my-docs")
     */
    entity?: string;
    /** Maximum number of cached RwSite instances. Default: 20. */
    cacheSize?: number;
    /**
     * How often to check cached sites for upstream changes and reload if needed.
     * If not set, no periodic reloading is performed.
     *
     * @example
     * ```yaml
     * rw:
     *   reloadInterval: { minutes: 5 }
     * ```
     */
    reloadInterval?: import("@backstage/types").HumanDuration;
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
    /**
     * Inline/page comments in the embedded viewer.
     */
    comments?: {
      /**
       * Enable comments. The frontend reads this via GET /comments/config and
       * gates client injection on it; the backend defaults it to true in code
       * (this @default annotation is a docs/UI hint only — Backstage does not apply it).
       * @default true
       */
      enabled?: boolean;
    };
    /**
     * Site index rebuild (catalog scan + per-site worker queue).
     */
    siteIndex?: {
      /** Schedule for the catalog scan (producer). Parsed by
       *  readSchedulerServiceTaskScheduleDefinitionFromConfig. Accepts HumanDuration / cron. */
      schedule?: object;
      /** Schedule for the worker tick (queue drain). Same parser as `schedule`. */
      worker?: object;
    };
  };
}
