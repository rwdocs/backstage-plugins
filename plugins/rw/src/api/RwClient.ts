import { createApiRef } from "@backstage/core-plugin-api";
import type { DiscoveryApi, FetchApi } from "@backstage/core-plugin-api";

export interface RwApi {
  getBaseUrl(): Promise<string>;
  getSiteBaseUrl(entityRef: string): Promise<string>;
  getFetch(): typeof fetch;
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
}
