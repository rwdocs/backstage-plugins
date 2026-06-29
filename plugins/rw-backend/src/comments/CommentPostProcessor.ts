import { LoggerService } from "@backstage/backend-plugin-api";
import { CommentAction, CommentProcessor } from "@rwdocs/backstage-plugin-rw-node";
import { CommentActivityResolver } from "./CommentActivityResolver";
import { CommentRow } from "./types";

/** Resolves a CommentActivity once and fans it out to every registered CommentProcessor.
 *  Injected into the comments router and called synchronously after the write responds;
 *  postProcess returns immediately and does its work detached, so notification side-effects
 *  never block or fail the comment write. Per-processor and outer try/catch ensure no floating
 *  rejection and no cross-processor failure propagation. Zero processors => no DB work. */
export class CommentPostProcessor {
  private readonly resolver: CommentActivityResolver;
  private readonly processors: CommentProcessor[];
  private readonly logger: LoggerService;

  constructor(opts: {
    resolver: CommentActivityResolver;
    processors: CommentProcessor[];
    logger: LoggerService;
  }) {
    this.resolver = opts.resolver;
    this.processors = opts.processors;
    this.logger = opts.logger;
  }

  /** Fire-and-forget: returns immediately; resolve + fan-out run detached. */
  postProcess(action: CommentAction, row: CommentRow, actorRef: string): void {
    if (this.processors.length === 0) return; // no DB work when nobody's listening
    void (async () => {
      try {
        const activity = await this.resolver.resolve(action, row, actorRef);
        if (!activity) return; // suppressed (deleted trigger)
        for (const processor of this.processors) {
          try {
            await processor.process(activity);
          } catch (e) {
            this.logger.error(`Comment processor ${processor.getName()} failed: ${e}`);
          }
        }
      } catch (e) {
        this.logger.error(`Comment post-processing failed: ${e}`);
      }
    })();
  }
}
