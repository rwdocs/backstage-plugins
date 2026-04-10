export interface Config {
  search?: {
    collators?: {
      rw?: {
        /**
         * Schedule configuration. Parsed by Backstage's
         * readSchedulerServiceTaskScheduleDefinitionFromConfig.
         * Accepts HumanDuration values (minutes, hours, days, etc.) and cron expressions.
         */
        schedule?: object;
        /**
         * Search result type identifier. Set to "techdocs" to unify RW docs
         * results with TechDocs under the same search filter tab.
         * @default 'rw'
         */
        type?: string;
        /** @default '/catalog/:namespace/:kind/:name/docs/:path' */
        locationTemplate?: string;
      };
    };
  };
}
