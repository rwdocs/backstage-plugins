import { createApiRef } from "@backstage/core-plugin-api";
import type { DiscoveryApi, FetchApi } from "@backstage/core-plugin-api";
import type { InboxQuery, InboxResponse } from "@rwdocs/backstage-plugin-rw-common";
import type {
  CommentApiClient,
  Comment,
  CreateCommentRequest,
  UpdateCommentRequest,
} from "@rwdocs/viewer";

export type { InboxItem, InboxQuery, InboxResponse } from "@rwdocs/backstage-plugin-rw-common";

export interface RwApi {
  getBaseUrl(): Promise<string>;
  getSiteBaseUrl(entityRef: string): Promise<string>;
  getFetch(): typeof fetch;
  getCommentsEnabled(): Promise<boolean>;
  getCommentInbox(query?: InboxQuery): Promise<InboxResponse>;
  createCommentClient(siteRef: string): CommentApiClient;
}

export const rwApiRef = createApiRef<RwApi>({ id: "plugin.rw.api" });

export class RwClient implements RwApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async getBaseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl("rw");
  }

  async getSiteBaseUrl(entityRef: string): Promise<string> {
    const base = await this.discoveryApi.getBaseUrl("rw");
    return `${base}/site/${entityRef}`;
  }

  getFetch(): typeof fetch {
    return this.fetchApi.fetch;
  }

  async getCommentsEnabled(): Promise<boolean> {
    const base = await this.discoveryApi.getBaseUrl("rw");
    const res = await this.fetchApi.fetch(`${base}/comments/config`);
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body.enabled);
  }

  async getCommentInbox(query: InboxQuery = {}): Promise<InboxResponse> {
    const base = await this.discoveryApi.getBaseUrl("rw");
    const params = new URLSearchParams();
    if (query.cursor) params.set("cursor", query.cursor);
    else {
      if (query.filter) params.set("filter", query.filter);
      if (query.sort) params.set("sort", query.sort);
    }
    if (query.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const res = await this.fetchApi.fetch(`${base}/comments/inbox${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error(`Inbox request failed: ${res.status}`);
    return res.json();
  }

  createCommentClient(siteRef: string): CommentApiClient {
    const json = async (res: Response) => {
      if (!res.ok) throw new Error(`Comment request failed: ${res.status}`);
      return res.json();
    };
    const baseUrl = () => this.discoveryApi.getBaseUrl("rw");
    return {
      list: async (documentId: string, opts?: { signal?: AbortSignal }): Promise<Comment[]> => {
        const base = await baseUrl();
        const q = new URLSearchParams({ siteRef, documentId });
        return json(
          await this.fetchApi.fetch(`${base}/comments?${q.toString()}`, { signal: opts?.signal }),
        );
      },
      create: async (input: CreateCommentRequest): Promise<Comment> => {
        const base = await baseUrl();
        return json(
          await this.fetchApi.fetch(`${base}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteRef, ...input }),
          }),
        );
      },
      update: async (id: string, input: UpdateCommentRequest): Promise<Comment> => {
        const base = await baseUrl();
        return json(
          await this.fetchApi.fetch(`${base}/comments/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        );
      },
      delete: async (id: string): Promise<Comment> => {
        const base = await baseUrl();
        return json(
          await this.fetchApi.fetch(`${base}/comments/${encodeURIComponent(id)}`, {
            method: "DELETE",
          }),
        );
      },
    };
  }
}
