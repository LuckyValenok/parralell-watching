export const DEFAULT_GITHUB_REPO = 'LuckyValenok/parralell-watching';

/** extension-v1.2.3 or v1.2.3 → 1.2.3 */
export function normalizeReleaseVersion(tagOrVersion: string): string {
  return tagOrVersion.replace(/^extension-v/i, '').replace(/^v/i, '');
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeReleaseVersion(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalizeReleaseVersion(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export interface ExtensionUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  downloadUrl: string | null;
  checkedAt: number;
  error?: string;
}
