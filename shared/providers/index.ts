import { hdrezkaProvider } from './hdrezka.js';
import type { ProviderRegistry, VideoProvider } from './types.js';

const providers: VideoProvider[] = [hdrezkaProvider];

export const registry: ProviderRegistry = {
  providers,
  matchUrl(url: string) {
    return providers.find((p) => p.matchUrl(url)) ?? null;
  },
  matchHost(hostname: string) {
    return providers.find((p) => p.matchHost(hostname)) ?? null;
  },
};

export { hdrezkaProvider };
export type { VideoProvider };

/** @deprecated use registry.matchUrl */
export function isRezkaUrl(url: string): boolean {
  return registry.matchUrl(url) !== null;
}

/** @deprecated use registry.matchHost */
export function isRezkaHost(hostname: string): boolean {
  return registry.matchHost(hostname) !== null;
}

export function isSupportedWatchUrl(url: string): boolean {
  return registry.matchUrl(url) !== null;
}

export { episodeUrlFromElement, isSamePathDifferentEpisode } from './hdrezka.js';

export function resolveNavigateUrl(hostUrl: string, currentUrl?: string): string {
  const provider = registry.matchUrl(hostUrl) ?? hdrezkaProvider;
  return provider.resolveNavigateUrl(hostUrl, currentUrl);
}

export function watchTargetKey(url: string): string {
  const provider = registry.matchUrl(url) ?? hdrezkaProvider;
  return provider.watchTargetKey(url);
}
