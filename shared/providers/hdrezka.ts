import type { VideoProvider } from './types.js';

function isRezkaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return /^(?:[\w-]+\.)*(?:hd)?rezka[\w.-]*\.\w{2,}$/.test(host)
    || /^rezka-[\w.-]+\.\w{2,}$/.test(host);
}

function watchTargetKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

function resolveNavigateUrl(hostUrl: string, currentUrl = ''): string {
  try {
    const target = new URL(hostUrl);
    const current = new URL(currentUrl || (typeof window !== 'undefined' ? window.location.href : hostUrl));
    return `${current.origin}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return hostUrl;
  }
}

function parseEpisodeHash(hash: string): { translator: string; season: string; episode: string } | null {
  const match = hash.match(/#?t:?(\d+)-s:?(\d+)-e:?(\d+)/i);
  if (!match) return null;
  return { translator: match[1], season: match[2], episode: match[3] };
}

function readActiveEpisodeIds(): { translator: string; season: string; episode: string } | null {
  if (typeof document === 'undefined') return null;

  const activeEpisode =
    document.querySelector<HTMLElement>('[data-episode_id].active, .b-simple_episode__item.active') ??
    document.querySelector<HTMLElement>('[data-episode_id].selected, .b-simple_episode__item.selected');

  const activeSeason =
    document.querySelector<HTMLElement>('[data-season_id].active, .b-simple_season__item.active') ??
    document.querySelector<HTMLElement>('[data-season_id].selected, .b-simple_seasons__item.active, .b-seasons__item.active');

  const activeTranslator =
    document.querySelector<HTMLElement>('[data-translator_id].active, .b-translator__item.active');

  const episode =
    activeEpisode?.getAttribute('data-episode_id') ??
    activeEpisode?.dataset.episodeId ??
    null;
  const season =
    activeEpisode?.getAttribute('data-season_id') ??
    activeEpisode?.dataset.seasonId ??
    activeSeason?.getAttribute('data-season_id') ??
    activeSeason?.dataset.seasonId ??
    null;
  const translator =
    activeTranslator?.getAttribute('data-translator_id') ??
    activeTranslator?.dataset.translatorId ??
    '1';

  if (season && episode) {
    return { translator, season, episode };
  }

  return null;
}

function buildEpisodeHash(translator: string, season: string, episode: string): string {
  return `#t:${translator}-s:${season}-e:${episode}`;
}

function buildWatchUrl(href = typeof location !== 'undefined' ? location.href : ''): string {
  if (typeof document === 'undefined') return href;

  try {
    const url = new URL(href);
    const fromHash = parseEpisodeHash(url.hash);
    if (fromHash) return url.toString();

    const ids = readActiveEpisodeIds();
    if (ids) {
      url.hash = buildEpisodeHash(ids.translator, ids.season, ids.episode);
    }

    return url.toString();
  } catch {
    return href;
  }
}

export function clickEpisodeByHash(hashOrUrl: string): boolean {
  if (typeof document === 'undefined') return false;

  const ids = (() => {
    if (hashOrUrl.startsWith('#')) return parseEpisodeHash(hashOrUrl);
    try {
      return parseEpisodeHash(new URL(hashOrUrl).hash);
    } catch {
      return null;
    }
  })();
  if (!ids) return false;

  const seasonEl =
    document.querySelector<HTMLElement>(`[data-season_id="${ids.season}"].active`) ??
    document.querySelector<HTMLElement>(`[data-season_id="${ids.season}"]`) ??
    document.querySelector<HTMLElement>(`[data-season-id="${ids.season}"]`);

  if (seasonEl && !seasonEl.classList.contains('active')) {
    seasonEl.click();
  }

  const translatorEl = document.querySelector<HTMLElement>(
    `[data-translator_id="${ids.translator}"].active, .b-translator__item.active`
  );
  if (!translatorEl) {
    const translatorTarget = document.querySelector<HTMLElement>(
      `[data-translator_id="${ids.translator}"]`
    );
    translatorTarget?.click();
  }

  const episodeEl =
    document.querySelector<HTMLElement>(
      `[data-episode_id="${ids.episode}"][data-season_id="${ids.season}"]`
    ) ??
    document.querySelector<HTMLElement>(
      `[data-episode-id="${ids.episode}"][data-season-id="${ids.season}"]`
    ) ??
    document.querySelector<HTMLElement>(`[data-episode_id="${ids.episode}"]`) ??
    document.querySelector<HTMLElement>(`[data-episode-id="${ids.episode}"]`);

  if (episodeEl) {
    episodeEl.click();
    return true;
  }

  return false;
}

export function isSamePathDifferentEpisode(tabUrl: string, targetUrl: string): boolean {
  try {
    const tab = new URL(tabUrl);
    const target = new URL(targetUrl);
    return (
      tab.origin === target.origin &&
      tab.pathname === target.pathname &&
      Boolean(target.hash) &&
      tab.hash !== target.hash
    );
  } catch {
    return false;
  }
}

export function episodeUrlFromElement(el: Element, baseHref = location.href): string | null {
  const url = new URL(baseHref);
  const anchor =
    el instanceof HTMLAnchorElement ? el : el.closest('a') ?? el.querySelector('a');

  if (anchor instanceof HTMLAnchorElement) {
    if (anchor.hash) {
      url.hash = anchor.hash;
      return url.toString();
    }
    const onclick = anchor.getAttribute('onclick') ?? '';
    const fromOnclick = onclick.match(/#?t:?(\d+)-s:?(\d+)-e:?(\d+)/i);
    if (fromOnclick) {
      url.hash = buildEpisodeHash(fromOnclick[1], fromOnclick[2], fromOnclick[3]);
      return url.toString();
    }
  }

  const htmlEl = el as HTMLElement;
  const episode =
    htmlEl.getAttribute('data-episode_id') ??
    htmlEl.getAttribute('data-episode-id') ??
    htmlEl.dataset.episodeId;
  const season =
    htmlEl.getAttribute('data-season_id') ??
    htmlEl.getAttribute('data-season-id') ??
    htmlEl.dataset.seasonId ??
    el.closest('[data-season_id]')?.getAttribute('data-season_id') ??
    el.closest('[data-season-id]')?.getAttribute('data-season-id');

  if (season && episode) {
    const translatorEl = document.querySelector<HTMLElement>('.b-translator__item.active, [data-translator_id].active');
    const translator =
      translatorEl?.getAttribute('data-translator_id') ??
      translatorEl?.dataset.translatorId ??
      '1';
    url.hash = buildEpisodeHash(translator, season, episode);
    return url.toString();
  }

  return null;
}

export const hdrezkaProvider: VideoProvider = {
  id: 'hdrezka',
  name: 'HDRezka',
  matchHost: isRezkaHost,
  matchUrl(url: string) {
    try {
      return isRezkaHost(new URL(url).hostname);
    } catch {
      return /(?:hd)?rezka/i.test(url);
    }
  },
  resolveNavigateUrl,
  buildWatchUrl,
  watchTargetKey,
  episodeSelectors:
    '.b-simple_episode__item, .b-simple_episode, .b-simple_season__item, .b-simple_seasons__item, .b-seasons__item, .b-translator__item, [data-season_id], [data-episode_id], [data-season-id], [data-episode-id]',
  videoSelectors: ['#cdnplayer video', '.b-player video', '#player video', 'video'],
};
