export interface VideoProvider {
  id: string;
  name: string;
  matchHost(hostname: string): boolean;
  matchUrl(url: string): boolean;
  resolveNavigateUrl(hostUrl: string, currentUrl?: string): string;
  buildWatchUrl?(href?: string): string;
  watchTargetKey(url: string): string;
  episodeSelectors: string;
  videoSelectors: string[];
}

export interface ProviderRegistry {
  providers: VideoProvider[];
  matchUrl(url: string): VideoProvider | null;
  matchHost(hostname: string): VideoProvider | null;
}
