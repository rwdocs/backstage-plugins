// plugins/rw/src/components/inboxBuckets.ts
import type { InboxItem } from "../api/RwClient";
import { bucketByTime } from "./recencyBuckets";
import type { BucketKey, RecencyBucket } from "./recencyBuckets";

export type { BucketKey };
export type InboxBucket = RecencyBucket<InboxItem>;

/** Chunk an already-sorted inbox list into recency buckets by `updatedAt`. */
export function bucketByActivity(items: InboxItem[], now: number): InboxBucket[] {
  return bucketByTime(items, (it) => it.updatedAt, now);
}
