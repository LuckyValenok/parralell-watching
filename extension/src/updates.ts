import {
  DEFAULT_GITHUB_REPO,
  isNewerVersion,
  normalizeReleaseVersion,
  type ExtensionUpdateInfo,
} from '../../shared/extension-release.js';

declare const __PW_EXTENSION_VERSION__: string;
declare const __PW_GITHUB_REPO__: string;

const CURRENT_VERSION = __PW_EXTENSION_VERSION__;
const GITHUB_REPO = __PW_GITHUB_REPO__ || DEFAULT_GITHUB_REPO;

const UPDATE_ALARM = 'pw-update-check';
const UPDATE_CHECK_HOURS = 6;
const STORAGE_KEY = 'pwUpdateInfo';
const DISMISSED_KEY = 'pwDismissedUpdateVersion';

interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets?: { name: string; browser_download_url: string }[];
}

function findZipAsset(release: GithubRelease): string | null {
  const asset = release.assets?.find((a) =>
    /^parallel-watching-extension-v.+\.zip$/i.test(a.name)
  );
  return asset?.browser_download_url ?? null;
}

export async function checkForExtensionUpdate(
  force = false
): Promise<ExtensionUpdateInfo> {
  const stored = await browser.storage.local.get([STORAGE_KEY, DISMISSED_KEY]);
  const cached = stored[STORAGE_KEY] as ExtensionUpdateInfo | undefined;
  const dismissed = stored[DISMISSED_KEY] as string | undefined;

  if (!force && cached && Date.now() - cached.checkedAt < UPDATE_CHECK_HOURS * 60 * 60 * 1000) {
    return cached;
  }

  const base: ExtensionUpdateInfo = {
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    hasUpdate: false,
    releaseUrl: null,
    downloadUrl: null,
    checkedAt: Date.now(),
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );

    if (res.status === 404) {
      const info = { ...base, error: 'no-releases' };
      await browser.storage.local.set({ [STORAGE_KEY]: info });
      return info;
    }

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`);
    }

    const release = (await res.json()) as GithubRelease;
    const latestVersion = normalizeReleaseVersion(release.tag_name);
    const hasUpdate =
      isNewerVersion(latestVersion, CURRENT_VERSION) && latestVersion !== dismissed;

    const info: ExtensionUpdateInfo = {
      currentVersion: CURRENT_VERSION,
      latestVersion,
      hasUpdate,
      releaseUrl: release.html_url,
      downloadUrl: findZipAsset(release),
      checkedAt: Date.now(),
    };

    await browser.storage.local.set({ [STORAGE_KEY]: info });
    await updateActionBadge(info);
    return info;
  } catch (err) {
    const info: ExtensionUpdateInfo = {
      ...base,
      error: err instanceof Error ? err.message : 'check-failed',
    };
    if (cached) return cached;
    await browser.storage.local.set({ [STORAGE_KEY]: info });
    return info;
  }
}

export async function getExtensionUpdateInfo(): Promise<ExtensionUpdateInfo> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const cached = stored[STORAGE_KEY] as ExtensionUpdateInfo | undefined;
  if (cached) return cached;
  return checkForExtensionUpdate(true);
}

export async function dismissExtensionUpdate(version: string): Promise<void> {
  await browser.storage.local.set({ [DISMISSED_KEY]: version });
  const info = await getExtensionUpdateInfo();
  if (info.latestVersion === version) {
    const next = { ...info, hasUpdate: false };
    await browser.storage.local.set({ [STORAGE_KEY]: next });
    await updateActionBadge(next);
  }
}

async function updateActionBadge(info: ExtensionUpdateInfo): Promise<void> {
  if (info.hasUpdate) {
    await browser.action.setBadgeText({ text: '↑' });
    await browser.action.setBadgeBackgroundColor({ color: '#e17055' });
  } else {
    await browser.action.setBadgeText({ text: '' });
  }
}

export function initExtensionUpdateChecks(): void {
  void checkForExtensionUpdate();
  browser.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_HOURS * 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) void checkForExtensionUpdate(true);
  });
}
