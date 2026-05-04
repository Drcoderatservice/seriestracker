const STATUS_OPTIONS = new Set([
  "Planned",
  "Watching",
  "Completed",
  "Paused",
  "Dropped"
]);
const SEASON_STATUS_OPTIONS = new Set([
  "Planned",
  "Watching",
  "Completed",
  "Paused",
  "Dropped"
]);
const ACTIVE_SEASON_STATUSES = new Set(["Watching", "Paused", "Dropped"]);
const CATEGORY_OPTIONS = new Set([
  "Anime",
  "Donghua",
  "CDrama",
  "KDrama",
  "Movies",
  "WebSeries"
]);
const ANILIST_SCHEDULE_CATEGORIES = new Set(["Anime", "Donghua"]);
const AIRING_TAB_OPTIONS = new Set(["episodes", "seasons"]);
const AIRING_CATEGORY_FILTER_OPTIONS = new Set([
  "All",
  "Anime",
  "Donghua",
  "CDrama",
  "KDrama",
  "WebSeries"
]);
const SORT_OPTIONS = new Set(["Newest", "Oldest", "AZ", "ZA"]);
const DEFAULT_VIEW_CATEGORY_OPTIONS = new Set(["Home", ...CATEGORY_OPTIONS]);
const THEME_OPTIONS = new Set(["default", "netflix-red", "ocean-night"]);
const DEFAULT_THEME = "default";
const THEME_STORAGE_KEY = "seriestracker_theme";
const DEFAULT_CATEGORY_STORAGE_KEY = "seriestracker_default_category";
const DEFAULT_SORT_STORAGE_KEY = "seriestracker_default_sort";
const SHARE_HASH_KEY = "share";
const SHARE_COLLECTION = "sharedLists";

let currentUser = null;
let currentUsername = "";
let tracker = [];
let currentCategory = "Home";
let selectedCategory = "Anime";
let selectedStatus = "Planned";
let activeCategoryFilter = "All";
let activeStatusFilter = "All";
let activeSortFilter = "Newest";
let activeFavoritesOnly = false;
let preferredDefaultCategory = "Home";
let preferredDefaultSort = "Newest";
let searchQuery = "";
let shareSelectionQuery = "";
let shareCategoryFilter = "All";
let shareStatusFilter = "All";
let searchResultsCache = [];
let shareSelection = new Set();
let editingTitle = "";
let editingSeasonContext = null;
let deletingTitle = "";
let activeSeasonsTitle = "";
let activeAiringTab = "episodes";
let activeAiringCategoryFilter = "All";
let activeAiringSortFilter = "Oldest";
let profileAvatarData = "";
let saveQueue = Promise.resolve();
let authListenerStarted = false;
let authLoadToken = 0;
let seasonLoadToken = 0;
let airingLoadToken = 0;
let airingCountdownTimer = null;
let sharedListFromLink = null;
let activeCardCopyTitle = "";
let airingScheduleState = {
  isLoading: false,
  candidateCount: 0,
  failedCount: 0,
  episodes: [],
  seasons: [],
  updatedAt: ""
};

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getFirebaseApi() {
  return {
    auth: window.auth,
    db: window.db,
    collection: window.collection,
    doc: window.doc,
    setDoc: window.setDoc,
    getDoc: window.getDoc,
    getDocs: window.getDocs,
    query: window.query,
    where: window.where,
    limit: window.limit,
    deleteDoc: window.deleteDoc,
    signOut: window.signOut,
    signInWithEmailAndPassword: window.signInWithEmailAndPassword,
    createUserWithEmailAndPassword: window.createUserWithEmailAndPassword,
    sendPasswordResetEmail: window.sendPasswordResetEmail,
    onAuthStateChanged: window.onAuthStateChanged
  };
}

function isFirebaseReady() {
  const api = getFirebaseApi();

  return Boolean(
    api.auth &&
      api.db &&
      api.doc &&
      api.setDoc &&
      api.getDoc &&
      api.signOut &&
      api.signInWithEmailAndPassword &&
      api.createUserWithEmailAndPassword &&
      api.sendPasswordResetEmail &&
      api.onAuthStateChanged
  );
}

async function waitForFirebase(maxAttempts = 80) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isFirebaseReady()) {
      return true;
    }

    await delay(100);
  }

  return false;
}

function getUserEmail() {
  return currentUser?.email || "";
}

function getProfileStorageKey(email = getUserEmail()) {
  return email ? `profile_avatar_${email}` : "profile_avatar_guest";
}

function getUserDocRef(uid) {
  const { db, doc } = getFirebaseApi();
  return doc(db, "users", uid);
}

function getUsernameDocRef(usernameKey) {
  const { db, doc } = getFirebaseApi();
  return doc(db, "usernames", usernameKey);
}

function getShareDocRef(shareId) {
  const { db, doc } = getFirebaseApi();
  return doc(db, SHARE_COLLECTION, shareId);
}

function normalizeUsernameValue(value) {
  return String(value ?? "").trim().replace(/^@+/, "");
}

function getUsernameKey(value) {
  return normalizeUsernameValue(value).toLowerCase();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9._-]{3,20}$/.test(normalizeUsernameValue(value));
}

function looksLikeEmail(value) {
  return String(value ?? "").trim().includes("@");
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeFilterValue(value, allowedValues, fallback = "All") {
  return allowedValues.has(value) ? value : fallback;
}

function normalizeDefaultCategoryValue(value) {
  return DEFAULT_VIEW_CATEGORY_OPTIONS.has(value) ? value : "Home";
}

function normalizeDefaultSortValue(value) {
  return SORT_OPTIONS.has(value) ? value : "Newest";
}

function getTimestampValue(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function createTrackerTimestamp() {
  return new Date().toISOString();
}

function touchTrackerItem(item, includeCreatedAt = false) {
  if (!item) {
    return;
  }

  const timestamp = createTrackerTimestamp();

  if (includeCreatedAt && !item.createdAt) {
    item.createdAt = timestamp;
  }

  item.updatedAt = timestamp;
}

function touchTrackerProgress(item) {
  if (!item) {
    return;
  }

  item.lastProgressAt = createTrackerTimestamp();
}

function getProgressTimestamp(item) {
  if (!item) {
    return 0;
  }

  return getTimestampValue(item.lastProgressAt || item.updatedAt || item.createdAt);
}

function getTmdbImageUrl(path, size = "w500") {
  const normalizedPath = String(path ?? "").trim();

  if (!normalizedPath) {
    return "";
  }

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith("/")) {
    return `https://image.tmdb.org/t/p/${size}${normalizedPath}`;
  }

  return normalizedPath;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeSeasonList(seasons, fallbackImage = "") {
  if (!Array.isArray(seasons)) {
    return [];
  }

  return seasons
    .map((season) => {
      const seasonNumber = Math.max(
        0,
        Number.parseInt(season.seasonNumber ?? season.season_number, 10) || 0
      );
      const episodeCount = Math.max(
        0,
        Number.parseInt(season.episodeCount ?? season.episode_count, 10) || 0
      );
      const label = seasonNumber === 0 ? "Specials" : `Season ${seasonNumber || 1}`;
      const name = String(season.name || label).trim() || label;

      return {
        id: season.id ?? `${seasonNumber}-${name}`,
        name,
        seasonNumber,
        episodeCount,
        airDate: String(season.airDate ?? season.air_date ?? "").trim(),
        overview: String(season.overview || "").trim(),
        image: getTmdbImageUrl(season.image || season.poster_path || fallbackImage),
        status: SEASON_STATUS_OPTIONS.has(String(season.status || "").trim())
          ? String(season.status).trim()
          : ""
      };
    })
    .filter((season) => season.episodeCount > 0)
    .sort((left, right) => {
      const leftOrder = left.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : left.seasonNumber;
      const rightOrder =
        right.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : right.seasonNumber;
      return leftOrder - rightOrder;
    });
}

function hydrateSeasonStatuses(seasons, watchedTotal = 0, fallbackStatus = "Planned") {
  if (!Array.isArray(seasons) || !seasons.length) {
    return [];
  }

  let remainingWatched = Math.max(0, Number.parseInt(watchedTotal, 10) || 0);
  let activeAssigned = false;
  const normalizedFallback = SEASON_STATUS_OPTIONS.has(fallbackStatus)
    ? fallbackStatus
    : "Planned";

  return seasons.map((season, index) => {
    let status = SEASON_STATUS_OPTIONS.has(season.status) ? season.status : "";

    if (!status) {
      if (normalizedFallback === "Completed") {
        status = "Completed";
        remainingWatched = Math.max(0, remainingWatched - season.episodeCount);
      } else if (remainingWatched >= season.episodeCount && season.episodeCount > 0) {
        status = "Completed";
        remainingWatched -= season.episodeCount;
      } else if (
        !activeAssigned &&
        (
          remainingWatched > 0 ||
          (ACTIVE_SEASON_STATUSES.has(normalizedFallback) && index === 0)
        )
      ) {
        status =
          ACTIVE_SEASON_STATUSES.has(normalizedFallback) && index === 0
            ? normalizedFallback
            : "Watching";
        activeAssigned = true;
        remainingWatched = 0;
      } else {
        status = "Planned";
      }
    } else if (ACTIVE_SEASON_STATUSES.has(status)) {
      if (activeAssigned) {
        status = "Planned";
      } else {
        activeAssigned = true;
      }
    }

    return {
      ...season,
      status
    };
  });
}

function normalizeSeasonState(item) {
  if (!item || item.mediaType !== "tv") {
    return [];
  }

  const seasons = hydrateSeasonStatuses(
    sanitizeSeasonList(item.seasons, item.image),
    item.watched,
    item.status
  );

  item.seasons = seasons;
  item.seasonCount = Math.max(seasons.length, Number.parseInt(item.seasonCount, 10) || 0);

  return seasons;
}

function getInitialWatchedCount(total) {
  if (selectedStatus === "Completed") {
    return total;
  }

  if (ACTIVE_SEASON_STATUSES.has(selectedStatus)) {
    return Math.min(1, total);
  }

  return 0;
}

function getSeasonCount(item) {
  if (!item || item.mediaType !== "tv") {
    return 0;
  }

  const storedCount = Math.max(0, Number.parseInt(item.seasonCount, 10) || 0);
  const listCount = Array.isArray(item.seasons) ? item.seasons.length : 0;
  return Math.max(storedCount, listCount);
}

async function fetchTitleDetails(itemId, mediaType) {
  const response = await fetch(
    `https://little-mountain-71e9.sharmarishav2100.workers.dev?details=${itemId}&type=${mediaType}`
  );

  if (!response.ok) {
    throw new Error("Details request failed");
  }

  return response.json();
}

const ANILIST_AIRING_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME) {
        id
        status
        episodes
        seasonYear
        title {
          romaji
          english
          native
          userPreferred
        }
        coverImage {
          large
          medium
        }
        startDate {
          year
          month
          day
        }
        nextAiringEpisode {
          airingAt
          episode
          timeUntilAiring
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              format
              status
              episodes
              seasonYear
              title {
                romaji
                english
                native
                userPreferred
              }
              coverImage {
                large
                medium
              }
              startDate {
                year
                month
                day
              }
              nextAiringEpisode {
                airingAt
                episode
                timeUntilAiring
              }
            }
          }
        }
      }
    }
  }
`;

function isAnimeScheduleCategory(category) {
  return ANILIST_SCHEDULE_CATEGORIES.has(String(category || "").trim());
}

function getAiringScheduleCandidates() {
  return tracker.filter(
    (item) => item && item.mediaType === "tv" && item.category !== "Movies"
  );
}

function isWatchingScheduleItem(item) {
  return item?.status === "Watching";
}

function matchesAiringCategoryFilter(entry) {
  return (
    activeAiringCategoryFilter === "All" ||
    entry?.category === activeAiringCategoryFilter
  );
}

function getTodayStartTime() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function isUpcomingTimestamp(timestamp) {
  return Number.isFinite(timestamp) && timestamp >= getTodayStartTime();
}

function createLocalDateFromYmd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());

  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function getAniListDateTimestamp(dateParts) {
  const year = Number.parseInt(dateParts?.year, 10);
  const month = Number.parseInt(dateParts?.month, 10);
  const day = Number.parseInt(dateParts?.day, 10);

  if (!year || !month || !day) {
    return 0;
  }

  return new Date(year, month - 1, day).getTime();
}

function getAniListPreferredTitle(media) {
  return (
    media?.title?.userPreferred ||
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    "Untitled"
  );
}

function normalizeScheduleTitle(value) {
  return normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/\b(season|part|cour)\s+\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAniListTitleValues(media) {
  return [
    media?.title?.userPreferred,
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native
  ].filter(Boolean);
}

function isLikelyAniListMatch(itemTitle, media) {
  const target = normalizeScheduleTitle(itemTitle);
  const titles = getAniListTitleValues(media).map(normalizeScheduleTitle);

  if (!target || !titles.length) {
    return true;
  }

  if (titles.some((title) => title.includes(target) || target.includes(title))) {
    return true;
  }

  const targetTokens = target.split(" ").filter((token) => token.length > 1);

  return targetTokens.length > 0 && targetTokens.every((token) =>
    titles.some((title) => title.includes(token))
  );
}

function getAniListImage(media, fallbackImage = "") {
  return media?.coverImage?.large || media?.coverImage?.medium || fallbackImage || "";
}

function getAniListAiringTimestamp(media) {
  const airingAt = Number.parseInt(media?.nextAiringEpisode?.airingAt, 10);

  if (airingAt > 0) {
    return airingAt * 1000;
  }

  return getAniListDateTimestamp(media?.startDate);
}

function getScheduleDateLabel(timestamp, dateOnly = false) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "TBA";
  }

  const date = new Date(timestamp);
  const options = dateOnly
    ? { day: "numeric", month: "short", year: "numeric" }
    : {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      };

  try {
    return new Intl.DateTimeFormat("en-IN", options).format(date);
  } catch (error) {
    return dateOnly ? date.toLocaleDateString() : date.toLocaleString();
  }
}

function getCountdownLabel(timestamp, dateOnly = false) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "TBA";
  }

  if (dateOnly) {
    const targetDate = new Date(timestamp);
    const targetStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    ).getTime();
    const dayDiff = Math.round((targetStart - getTodayStartTime()) / 86400000);

    if (dayDiff < 0) {
      return "Aired";
    }

    if (dayDiff === 0) {
      return "Today";
    }

    if (dayDiff === 1) {
      return "Tomorrow";
    }

    try {
      return new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(targetDate);
    } catch (error) {
      return targetDate.toLocaleDateString(undefined, { weekday: "long" });
    }
  }

  const diff = timestamp - Date.now();

  if (diff <= -6 * 60 * 60 * 1000) {
    return "Aired";
  }

  if (diff <= 0) {
    return "Airing now";
  }

  const totalMinutes = Math.max(1, Math.ceil(diff / (60 * 1000)));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function getEpisodeCode(seasonNumber, episodeNumber) {
  const season = Number.parseInt(seasonNumber, 10);
  const episode = Number.parseInt(episodeNumber, 10);
  const parts = [];

  if (season > 0) {
    parts.push(`S${season}`);
  }

  if (episode > 0) {
    parts.push(`E${episode}`);
  }

  return parts.join(" ") || "Next episode";
}

function createAniListEpisodeEntry(item, media) {
  const nextEpisode = media?.nextAiringEpisode;
  const timestamp = getAniListAiringTimestamp(media);

  if (!nextEpisode || !isUpcomingTimestamp(timestamp)) {
    return null;
  }

  const episodeNumber = Number.parseInt(nextEpisode.episode, 10) || 0;
  const aniTitle = getAniListPreferredTitle(media);

  return {
    kind: "episode",
    source: "AniList",
    badge: "Exact",
    title: item.title,
    subtitle: aniTitle === item.title ? "Next episode" : aniTitle,
    category: item.category,
    image: getAniListImage(media, item.image),
    timestamp,
    dateOnly: false,
    code: episodeNumber > 0 ? `Episode ${episodeNumber}` : "Next episode",
    detail: "Live airing schedule"
  };
}

function createAniListSeasonEntry(item, media, fallbackImage = item.image) {
  const timestamp = getAniListAiringTimestamp(media);
  const nextEpisode = media?.nextAiringEpisode;
  const episodeNumber = Number.parseInt(nextEpisode?.episode, 10) || 0;
  const hasExactPremiere = Boolean(nextEpisode?.airingAt);
  const isPremiere =
    media?.status === "NOT_YET_RELEASED" || episodeNumber === 1 || !nextEpisode;

  if (!isPremiere || !isUpcomingTimestamp(timestamp)) {
    return null;
  }

  const totalEpisodes = Number.parseInt(media?.episodes, 10);
  const title = getAniListPreferredTitle(media);

  return {
    kind: "season",
    source: "AniList",
    badge: hasExactPremiere ? "Exact" : "Date only",
    title: item.title,
    subtitle: title,
    category: item.category,
    image: getAniListImage(media, fallbackImage),
    timestamp,
    dateOnly: !hasExactPremiere,
    code: hasExactPremiere ? "First episode" : "Season start",
    detail: totalEpisodes > 0 ? `${totalEpisodes} episodes` : "Episodes TBA"
  };
}

async function fetchAniListScheduleForItem(item) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: ANILIST_AIRING_QUERY,
      variables: { search: item.title }
    })
  });

  if (!response.ok) {
    throw new Error("AniList schedule request failed");
  }

  const data = await response.json();

  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error("AniList returned schedule errors");
  }

  const mediaResults = Array.isArray(data?.data?.Page?.media)
    ? data.data.Page.media
    : [];
  const matchedMedia = mediaResults.filter((media) =>
    isLikelyAniListMatch(item.title, media)
  );
  const mediaList = matchedMedia.length ? matchedMedia : mediaResults;

  if (!mediaList.length) {
    return { episodes: [], seasons: [] };
  }

  const episodes = [];
  const seasons = [];

  mediaList.forEach((media) => {
    const episodeEntry = createAniListEpisodeEntry(item, media);
    const ownSeasonEntry = createAniListSeasonEntry(item, media);

    if (episodeEntry) {
      episodes.push(episodeEntry);
    }

    if (ownSeasonEntry) {
      seasons.push(ownSeasonEntry);
    }

    const relations = Array.isArray(media?.relations?.edges)
      ? media.relations.edges
      : [];

    relations.forEach((edge) => {
      const node = edge?.node;

      if (edge?.relationType !== "SEQUEL" || node?.type !== "ANIME") {
        return;
      }

      const seasonEntry = createAniListSeasonEntry(
        item,
        node,
        getAniListImage(media, item.image)
      );

      if (seasonEntry) {
        seasons.push(seasonEntry);
      }
    });
  });

  return {
    episodes,
    seasons
  };
}

function createTmdbEpisodeEntry(item, details) {
  const nextEpisode = details?.next_episode_to_air;
  const airDate = createLocalDateFromYmd(nextEpisode?.air_date);

  if (!nextEpisode || !airDate || !isUpcomingTimestamp(airDate.getTime())) {
    return null;
  }

  return {
    kind: "episode",
    source: "TMDB",
    badge: "Date only",
    title: item.title,
    subtitle: nextEpisode.name || "Next episode",
    category: item.category,
    image: getTmdbImageUrl(details?.poster_path) || item.image,
    timestamp: airDate.getTime(),
    dateOnly: true,
    code: getEpisodeCode(nextEpisode.season_number, nextEpisode.episode_number),
    detail: "Time TBA"
  };
}

function createTmdbSeasonEntry(item, details, season) {
  const airDate = createLocalDateFromYmd(season?.air_date);
  const seasonNumber = Number.parseInt(season?.season_number, 10);

  if (!airDate || !seasonNumber || !isUpcomingTimestamp(airDate.getTime())) {
    return null;
  }

  const episodeCount = Number.parseInt(season?.episode_count, 10);

  return {
    kind: "season",
    source: "TMDB",
    badge: "Date only",
    title: item.title,
    subtitle: season?.name || `Season ${seasonNumber}`,
    category: item.category,
    image: getTmdbImageUrl(season?.poster_path || details?.poster_path) || item.image,
    timestamp: airDate.getTime(),
    dateOnly: true,
    code: `Season ${seasonNumber}`,
    detail: episodeCount > 0 ? `${episodeCount} episodes` : "Episodes TBA"
  };
}

async function fetchTmdbScheduleForItem(item) {
  if (!item.id) {
    return { episodes: [], seasons: [] };
  }

  const details = await fetchTitleDetails(item.id, item.mediaType);
  const episodes = [];
  const seasons = [];
  const episodeEntry = createTmdbEpisodeEntry(item, details);

  if (episodeEntry) {
    episodes.push(episodeEntry);
  }

  if (Array.isArray(details?.seasons)) {
    details.seasons.forEach((season) => {
      const seasonEntry = createTmdbSeasonEntry(item, details, season);

      if (seasonEntry) {
        seasons.push(seasonEntry);
      }
    });
  }

  return {
    episodes,
    seasons
  };
}

async function resolveAiringScheduleForItem(item) {
  if (isAnimeScheduleCategory(item.category)) {
    try {
      const aniListSchedule = await fetchAniListScheduleForItem(item);

      if (
        aniListSchedule.episodes.length ||
        aniListSchedule.seasons.length ||
        !item.id
      ) {
        return aniListSchedule;
      }
    } catch (error) {
      if (!item.id) {
        throw error;
      }
    }
  }

  return fetchTmdbScheduleForItem(item);
}

function sortAiringEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.MAX_SAFE_INTEGER;
    const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.MAX_SAFE_INTEGER;

    return (
      leftTime - rightTime ||
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
    );
  });
}

function dedupeAiringEntries(entries) {
  const seen = new Set();

  return entries.filter((entry) => {
    const key = [
      entry.kind,
      normalizeText(entry.source),
      normalizeText(entry.title),
      normalizeText(entry.subtitle),
      entry.timestamp || ""
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createTrackerEntry(searchItem, details, mediaType) {
  const title = searchItem.title || searchItem.name || details.title || details.name || "Untitled";
  const image = getTmdbImageUrl(searchItem.poster_path || details.poster_path);
  const overview = String(searchItem.overview || details.overview || "").trim();
  const baseSeasons = mediaType === "movie" ? [] : sanitizeSeasonList(details.seasons, image);
  const totalFromSeasons = baseSeasons.reduce(
    (count, season) => count + season.episodeCount,
    0
  );
  const seasonCount =
    mediaType === "movie"
      ? 0
      : Math.max(
          1,
          Number.parseInt(details.number_of_seasons, 10) || baseSeasons.length || 1
        );
  const total =
    mediaType === "movie"
      ? 1
      : Math.max(
          1,
          Number.parseInt(details.number_of_episodes, 10) ||
            totalFromSeasons ||
            seasonCount ||
            1
        );
  const watched = getInitialWatchedCount(total);
  const seasons =
    mediaType === "movie"
      ? []
      : hydrateSeasonStatuses(baseSeasons, watched, selectedStatus);
  const timestamp = createTrackerTimestamp();

  return {
    id: searchItem.id ?? details.id ?? null,
    title,
    image,
    isFavorite: false,
    watched,
    total,
    status: selectedStatus,
    category: selectedCategory,
    mediaType,
    seasonCount,
    seasons,
    overview,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastProgressAt: watched > 0 ? timestamp : ""
  };
}

function sanitizeTrackerList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && (item.title || item.name))
    .map((item) => {
      const title = String(item.title || item.name || "Untitled").trim() || "Untitled";
      const image = getTmdbImageUrl(item.image);
      const mediaType = item.mediaType === "movie" ? "movie" : "tv";
      const seasons = mediaType === "movie" ? [] : sanitizeSeasonList(item.seasons, image);
      const fallbackTotal =
        mediaType === "movie"
          ? 1
          : seasons.reduce((count, season) => count + season.episodeCount, 0) || 1;
      const total = Math.max(1, Number.parseInt(item.total, 10) || fallbackTotal);
      const watched = Math.min(
        total,
        Math.max(0, Number.parseInt(item.watched, 10) || 0)
      );
      let status = String(item.status || "").trim();

      if (!STATUS_OPTIONS.has(status)) {
        status =
          watched === 0 ? "Planned" : watched < total ? "Watching" : "Completed";
      }

      const hydratedSeasons =
        mediaType === "movie" ? [] : hydrateSeasonStatuses(seasons, watched, status);

      return {
        id: item.id ?? null,
        title,
        image,
        isFavorite: Boolean(item.isFavorite),
        watched,
        total,
        status,
        category: String(item.category || "Anime").trim() || "Anime",
        mediaType,
        seasonCount:
          mediaType === "movie"
            ? 0
            : Math.max(
                hydratedSeasons.length,
                Number.parseInt(item.seasonCount, 10) || 0
              ),
        seasons: hydratedSeasons,
        overview: String(item.overview || "").trim(),
        createdAt: String(item.createdAt || "").trim(),
        updatedAt: String(item.updatedAt || item.createdAt || "").trim(),
        lastProgressAt: String(
          item.lastProgressAt || item.updatedAt || item.createdAt || ""
        ).trim()
      };
    });
}

function createCloudSeasonPayload(season) {
  const seasonNumber = Math.max(
    0,
    Number.parseInt(season?.seasonNumber ?? season?.season_number, 10) || 0
  );
  const episodeCount = Math.max(
    0,
    Number.parseInt(season?.episodeCount ?? season?.episode_count, 10) || 0
  );
  const label = seasonNumber === 0 ? "Specials" : `Season ${seasonNumber || 1}`;
  const status = SEASON_STATUS_OPTIONS.has(String(season?.status || "").trim())
    ? String(season.status).trim()
    : "";

  return {
    id: season?.id ?? `${seasonNumber}-${label}`,
    name: String(season?.name || label).trim() || label,
    seasonNumber,
    episodeCount,
    status
  };
}

function createCloudTrackerPayload(items) {
  return sanitizeTrackerList(items).map((item) => ({
    id: item.id ?? null,
    title: item.title,
    image: item.image,
    isFavorite: Boolean(item.isFavorite),
    watched: item.watched,
    total: item.total,
    status: item.status,
    category: item.category,
    mediaType: item.mediaType,
    seasonCount: getSeasonCount(item),
    seasons:
      item.mediaType === "movie"
        ? []
        : sanitizeSeasonList(item.seasons, "").map(createCloudSeasonPayload),
    overview: String(item.overview || "").trim().slice(0, 280),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastProgressAt: item.lastProgressAt
  }));
}

function getTrackerLatestTimestamp(items) {
  return sanitizeTrackerList(items).reduce((latest, item) => {
    return Math.max(
      latest,
      getTimestampValue(item.lastProgressAt || item.updatedAt || item.createdAt)
    );
  }, 0);
}

function persistTrackerLocally(email, items) {
  if (!email) {
    return false;
  }

  try {
    localStorage.setItem("tracker_" + email, JSON.stringify(createCloudTrackerPayload(items)));
    return true;
  } catch (error) {
    return false;
  }
}

function readLegacyTracker(email) {
  if (!email) {
    return [];
  }

  try {
    return sanitizeTrackerList(JSON.parse(localStorage.getItem("tracker_" + email)));
  } catch (error) {
    return [];
  }
}

async function writeTrackerToCloud(user, trackerPayload, options = {}) {
  const { setDoc } = getFirebaseApi();
  const payload = {
    email: user.email || "",
    tracker: createCloudTrackerPayload(trackerPayload),
    updatedAt: new Date().toISOString()
  };

  if (options.migratedFromLocal) {
    payload.migratedFromLocal = true;
  }

  await setDoc(getUserDocRef(user.uid), payload, { merge: true });
}

async function syncProfileAvatarToCloud(user, avatarData) {
  const { setDoc } = getFirebaseApi();

  await setDoc(
    getUserDocRef(user.uid),
    {
      email: user.email || "",
      profileAvatar: String(avatarData || ""),
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

async function fetchUsernameRecord(username) {
  const { getDoc } = getFirebaseApi();
  const usernameKey = getUsernameKey(username);

  if (!usernameKey) {
    return {
      exists: false,
      email: "",
      username: "",
      uid: ""
    };
  }

  try {
    const snapshot = await getDoc(getUsernameDocRef(usernameKey));

    if (snapshot.exists()) {
      const data = snapshot.data() || {};

      return {
        exists: true,
        email: String(data.email || ""),
        username: String(data.username || ""),
        uid: String(data.uid || "")
      };
    }
  } catch (error) {
    // Fall through to the user-profile query fallback below.
  }

  return fetchUsernameRecordFromUsers(usernameKey);
}

async function fetchUsernameRecordFromUsers(usernameKey) {
  const { db, collection, getDocs, limit, query, where } = getFirebaseApi();

  if (!db || !collection || !getDocs || !query || !where || !limit) {
    return {
      exists: false,
      email: "",
      username: "",
      uid: ""
    };
  }

  try {
    const usersQuery = query(
      collection(db, "users"),
      where("usernameKey", "==", usernameKey),
      limit(1)
    );
    const snapshot = await getDocs(usersQuery);
    const firstMatch = snapshot.docs[0];

    if (!firstMatch) {
      return {
        exists: false,
        email: "",
        username: "",
        uid: ""
      };
    }

    const data = firstMatch.data() || {};

    return {
      exists: true,
      email: String(data.email || ""),
      username: String(data.username || ""),
      uid: String(data.uid || firstMatch.id || "")
    };
  } catch (error) {
    return {
      exists: false,
      email: "",
      username: "",
      uid: ""
    };
  }
}

async function syncUsernameToCloud(user, username, email = user?.email || "", options = {}) {
  const { setDoc, deleteDoc } = getFirebaseApi();
  const { previousUsername = "" } = options;
  const normalizedUsername = normalizeUsernameValue(username);
  const usernameKey = getUsernameKey(normalizedUsername);
  const previousUsernameKey = getUsernameKey(previousUsername);

  if (!user?.uid || !normalizedUsername || !usernameKey) {
    return;
  }

  const identityPayload = {
    uid: user.uid,
    email: email || "",
    username: normalizedUsername,
    usernameKey,
    updatedAt: new Date().toISOString()
  };

  await setDoc(getUserDocRef(user.uid), identityPayload, { merge: true });

  let mappingSynced = true;

  try {
    await setDoc(getUsernameDocRef(usernameKey), identityPayload, { merge: true });

    if (
      deleteDoc &&
      previousUsernameKey &&
      previousUsernameKey !== usernameKey
    ) {
      await deleteDoc(getUsernameDocRef(previousUsernameKey));
    }
  } catch (error) {
    mappingSynced = false;
  }

  return {
    mappingSynced
  };
}

async function resolveIdentifierToEmail(identifier) {
  const normalizedIdentifier = String(identifier ?? "").trim();

  if (!normalizedIdentifier) {
    return "";
  }

  if (looksLikeEmail(normalizedIdentifier)) {
    return normalizedIdentifier;
  }

  const usernameRecord = await fetchUsernameRecord(normalizedIdentifier);

  if (!usernameRecord.exists || !usernameRecord.email) {
    const error = new Error("No account was found for this username.");
    error.code = "auth/user-not-found";
    throw error;
  }

  return usernameRecord.email;
}

async function fetchRemoteUserData(user) {
  const { getDoc } = getFirebaseApi();
  const snapshot = await getDoc(getUserDocRef(user.uid));

  if (!snapshot.exists()) {
    return {
      exists: false,
      tracker: [],
      profileAvatar: "",
      username: ""
    };
  }

  const data = snapshot.data() || {};

  return {
    exists: true,
    tracker: sanitizeTrackerList(data.tracker),
    profileAvatar: String(data.profileAvatar || ""),
    username: normalizeUsernameValue(data.username || "")
  };
}

async function loadUserDataForUser(user) {
  const remote = await fetchRemoteUserData(user);
  const localTracker = readLegacyTracker(user.email || "");
  const localAvatar = readStoredProfileAvatar(user.email || "");
  const guestAvatar = readStoredProfileAvatar("");
  const nextLocalAvatar = localAvatar || guestAvatar;

  if (remote.exists) {
    const shouldPreferLocalTracker =
      localTracker.length &&
      (
        !remote.tracker.length ||
        getTrackerLatestTimestamp(localTracker) > getTrackerLatestTimestamp(remote.tracker)
      );
    const nextTracker = shouldPreferLocalTracker ? localTracker : remote.tracker;

    persistTrackerLocally(user.email || "", nextTracker);

    if (shouldPreferLocalTracker) {
      void writeTrackerToCloud(user, localTracker).catch(() => false);
    }

    if (remote.profileAvatar) {
      persistProfileAvatarLocally(remote.profileAvatar, user.email || "");
    } else if (nextLocalAvatar) {
      persistProfileAvatarLocally(nextLocalAvatar, user.email || "");
      await syncProfileAvatarToCloud(user, nextLocalAvatar);
    }

    return {
      tracker: nextTracker,
      profileAvatar: remote.profileAvatar || nextLocalAvatar || "",
      username: remote.username || ""
    };
  }

  const nextTracker = localTracker.length ? localTracker : [];

  persistTrackerLocally(user.email || "", nextTracker);

  if (localTracker.length) {
    await writeTrackerToCloud(user, localTracker, { migratedFromLocal: true });
  } else {
    await writeTrackerToCloud(user, []);
  }

  if (nextLocalAvatar) {
    persistProfileAvatarLocally(nextLocalAvatar, user.email || "");
    await syncProfileAvatarToCloud(user, nextLocalAvatar);
  }

  return {
    tracker: nextTracker,
    profileAvatar: nextLocalAvatar,
    username: ""
  };
}

function getCloudSaveErrorMessage(error, savedLocally = false) {
  switch (error?.code) {
    case "resource-exhausted":
      return savedLocally
        ? "Cloud document was too large, but your changes are safe locally on this device."
        : "Cloud document was too large. Please try again.";
    case "permission-denied":
      return savedLocally
        ? "Cloud write was blocked, but your changes are safe locally on this device."
        : "Cloud write was blocked. Please try again.";
    default:
      return savedLocally
        ? "Cloud save failed, but your changes are safe locally on this device."
        : "Cloud save failed. Please try again.";
  }
}

function queueTrackerSync() {
  if (!currentUser) {
    return Promise.resolve(false);
  }

  const userSnapshot = currentUser;
  const trackerSnapshot = sanitizeTrackerList(tracker);
  const savedLocally = persistTrackerLocally(userSnapshot.email || "", trackerSnapshot);

  saveQueue = saveQueue
    .catch(() => false)
    .then(async () => {
      try {
        await writeTrackerToCloud(userSnapshot, trackerSnapshot);
        return true;
      } catch (error) {
        showError(getCloudSaveErrorMessage(error, savedLocally));
        return false;
      }
    });

  return saveQueue;
}

function resolveMediaType(item) {
  if (selectedCategory === "Movies" || item.media_type === "movie") {
    return "movie";
  }

  if (item.title && item.release_date) {
    return "movie";
  }

  return "tv";
}

function updateSearchPlaceholder() {
  const input = document.getElementById("animeSearchInput");

  if (!input) {
    return;
  }

  input.placeholder =
    selectedCategory === "Movies" ? "Search movies here..." : "Search series here...";
}

function resetSearchModal() {
  const input = document.getElementById("animeSearchInput");
  const results = document.getElementById("searchResults");

  if (input) {
    input.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  searchResultsCache = [];
}

function resetShareModalState() {
  shareSelectionQuery = "";
  shareCategoryFilter = "All";
  shareStatusFilter = "All";
  shareSelection = new Set();

  const input = document.getElementById("shareSearchInput");
  const categoryFilter = document.getElementById("shareCategoryFilter");
  const statusFilter = document.getElementById("shareStatusFilter");

  if (input) {
    input.value = "";
  }

  if (categoryFilter) {
    categoryFilter.value = "All";
  }

  if (statusFilter) {
    statusFilter.value = "All";
  }

  updateShareSelectionSummary();
}

function setSharePanelButtonState(isOpen) {
  const button = document.getElementById("sharePanelButton");

  if (!button) {
    return;
  }

  button.classList.toggle("active", isOpen);
  button.setAttribute("aria-pressed", String(isOpen));
}

function openShareModal() {
  if (!currentUser) {
    openLogin();
    showWarning("Log in first to share your list.");
    return;
  }

  if (!tracker.length) {
    showWarning("Add a few titles first, then you can share them.");
    return;
  }

  closeProfileMenu();
  resetShareModalState();
  document.getElementById("shareInlinePanel")?.classList.remove("hidden");
  setSharePanelButtonState(true);
  renderShareSelection();
}

function closeShareModal() {
  document.getElementById("shareInlinePanel")?.classList.add("hidden");
  setSharePanelButtonState(false);
  resetShareModalState();
}

function toggleSharePanel() {
  const panel = document.getElementById("shareInlinePanel");

  if (!panel) {
    return;
  }

  if (panel.classList.contains("hidden")) {
    openShareModal();
    return;
  }

  closeShareModal();
}

function pruneShareSelection() {
  const validTitles = new Set(tracker.map((item) => item.title));

  shareSelection = new Set(
    [...shareSelection].filter((title) => validTitles.has(title))
  );
}

function getShareSelectionItems() {
  pruneShareSelection();

  return sortShareSelectionItems(
    tracker.filter((item) => shareSelection.has(item.title))
  );
}

function updateShareSelectionSummary() {
  pruneShareSelection();

  const count = shareSelection.size;
  const countLabel = document.getElementById("shareSelectionCount");
  const submitButton = document.getElementById("shareSubmitButton");
  const copyLinkButton = document.getElementById("shareCopyLinkButton");

  if (countLabel) {
    countLabel.textContent = `${count} ${count === 1 ? "title" : "titles"} selected`;
  }

  if (submitButton) {
    submitButton.disabled = count === 0;
    submitButton.textContent = count ? `Share to Apps (${count})` : "Share to Apps";
  }

  if (copyLinkButton) {
    copyLinkButton.disabled = count === 0;
  }
}

function renderShareEmptyState(title, message) {
  return `
    <div class="share-empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function getShareableItems() {
  return sortShareSelectionItems(
    tracker.filter((item) => {
      if (shareCategoryFilter !== "All" && item.category !== shareCategoryFilter) {
        return false;
      }

      if (shareStatusFilter !== "All" && item.status !== shareStatusFilter) {
        return false;
      }

      if (!shareSelectionQuery) {
        return true;
      }

      return normalizeText(`${item.title} ${item.category} ${item.status}`).includes(
        shareSelectionQuery
      );
    })
  );
}

function renderShareSelectionCard(item) {
  const isSelected = shareSelection.has(item.title);
  const posterMarkup = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)} poster" loading="lazy" decoding="async">`
    : escapeHtml(item.title.slice(0, 2).toUpperCase() || "ST");
  const progressLabel =
    item.mediaType === "movie" || item.total <= 1
      ? item.status
      : `${item.watched}/${item.total}`;

  return `
    <button
      type="button"
      class="share-selection-card${isSelected ? " is-selected" : ""}"
      data-share-title="${encodeURIComponent(item.title)}"
      aria-pressed="${isSelected}"
    >
      <span class="share-selection-poster">${posterMarkup}</span>
      <span class="share-selection-copy">
        <span class="share-selection-title">${escapeHtml(item.title)}</span>
        <span class="share-selection-summary">${escapeHtml(item.overview || `Share this ${item.category} entry with your friends.`)}</span>
        <span class="share-selection-meta">
          <span>${escapeHtml(item.category)}</span>
          <span>${escapeHtml(item.status)}</span>
          <span>${escapeHtml(progressLabel)}</span>
        </span>
      </span>
      <span class="share-selection-check" aria-hidden="true">${isSelected ? "&#10003;" : "+"}</span>
    </button>
  `;
}

function renderShareSelection() {
  const list = document.getElementById("shareSelectionList");

  if (!list) {
    return;
  }

  updateShareSelectionSummary();

  if (!tracker.length) {
    list.innerHTML = renderShareEmptyState(
      "No titles to share yet",
      "Add a few anime, dramas, or movies first and they will appear here."
    );
    return;
  }

  const items = getShareableItems();

  list.innerHTML = items.length
    ? items.map(renderShareSelectionCard).join("")
    : renderShareEmptyState(
        "Nothing matches that search",
        "Try a different title, category, or status keyword."
      );
}

function filterShareSelection() {
  shareSelectionQuery = normalizeText(
    document.getElementById("shareSearchInput")?.value
  );
  shareCategoryFilter = normalizeFilterValue(
    document.getElementById("shareCategoryFilter")?.value,
    new Set(["All", ...CATEGORY_OPTIONS]),
    "All"
  );
  shareStatusFilter = normalizeFilterValue(
    document.getElementById("shareStatusFilter")?.value,
    new Set(["All", ...STATUS_OPTIONS]),
    "All"
  );
  renderShareSelection();
}

function toggleShareSelection(title) {
  if (!title) {
    return;
  }

  if (shareSelection.has(title)) {
    shareSelection.delete(title);
  } else {
    shareSelection.add(title);
  }

  renderShareSelection();
}

function selectAllShareItems() {
  const items = getShareableItems();

  if (!items.length) {
    showWarning("There are no visible titles to select right now.");
    return;
  }

  items.forEach((item) => {
    shareSelection.add(item.title);
  });
  renderShareSelection();
}

function clearShareSelection() {
  if (!shareSelection.size) {
    return;
  }

  shareSelection.clear();
  renderShareSelection();
}

function sortShareSelectionItems(items) {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      return (
        left.item.title.localeCompare(right.item.title, undefined, {
          sensitivity: "base"
        }) || left.index - right.index
      );
    })
    .map((entry) => entry.item);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fallback below for browsers that block clipboard access here.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  textarea.remove();
  return copied;
}

function encodeSharePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSharePayload(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
}

function createSharePayload(items) {
  return {
    v: 1,
    u: currentUsername || "",
    i: items.map((item) => ({
      t: item.title,
      c: item.category,
      s: item.status,
      w: Math.max(0, Number.parseInt(item.watched, 10) || 0),
      e: Math.max(0, Number.parseInt(item.total, 10) || 0),
      m: item.mediaType === "movie" ? "movie" : "tv"
    }))
  };
}

function createShareId() {
  const bytes = new Uint8Array(9);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function buildShareLinkFromId(shareId) {
  const url = new URL(window.location.href);

  url.search = "";
  url.hash = `${SHARE_HASH_KEY}=${encodeURIComponent(shareId)}`;

  return url.toString();
}

async function createShortShareLink(items) {
  if (!currentUser) {
    throw new Error("Login required to create a share link.");
  }

  const ready = await waitForFirebase();

  if (!ready) {
    throw new Error("Firebase is not ready.");
  }

  const { setDoc } = getFirebaseApi();
  const shareId = createShareId();

  await setDoc(getShareDocRef(shareId), {
    ...createSharePayload(items),
    ownerUid: currentUser.uid,
    createdAt: new Date().toISOString()
  });

  return buildShareLinkFromId(shareId);
}

function sanitizeSharedListPayload(payload) {
  const rawItems = Array.isArray(payload?.i)
    ? payload.i
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  const items = rawItems
    .map((item) => {
      const title = String(item?.t ?? item?.title ?? "").trim();
      const category = normalizeFilterValue(
        String(item?.c ?? item?.category ?? ""),
        CATEGORY_OPTIONS,
        "Anime"
      );
      const status = normalizeFilterValue(
        String(item?.s ?? item?.status ?? ""),
        STATUS_OPTIONS,
        "Planned"
      );

      return {
        title,
        category,
        status,
        watched: Math.max(0, Number.parseInt(item?.w ?? item?.watched, 10) || 0),
        total: Math.max(0, Number.parseInt(item?.e ?? item?.total, 10) || 0),
        mediaType: item?.m === "movie" || item?.mediaType === "movie" ? "movie" : "tv"
      };
    })
    .filter((item) => item.title);

  if (!items.length) {
    return null;
  }

  return {
    username: String(payload?.u ?? payload?.username ?? payload?.by ?? "").trim(),
    items
  };
}

function readShareHashValue() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);

  return params.get(SHARE_HASH_KEY);
}

function readEmbeddedSharedList(value) {
  if (!value) {
    return null;
  }

  try {
    return sanitizeSharedListPayload(decodeSharePayload(value));
  } catch (error) {
    return null;
  }
}

async function loadSharedListFromLocation() {
  const shareValue = readShareHashValue();

  if (!shareValue) {
    return null;
  }

  const embeddedList = readEmbeddedSharedList(shareValue);

  if (embeddedList) {
    return embeddedList;
  }

  if (!/^[A-Za-z0-9_-]{6,32}$/.test(shareValue)) {
    return null;
  }

  const ready = await waitForFirebase();

  if (!ready) {
    return null;
  }

  const { getDoc } = getFirebaseApi();
  const snapshot = await getDoc(getShareDocRef(shareValue));

  if (!snapshot.exists()) {
    return null;
  }

  return sanitizeSharedListPayload(snapshot.data());
}

async function syncSharedListFromLocation() {
  try {
    sharedListFromLink = await loadSharedListFromLocation();
  } catch (error) {
    sharedListFromLink = null;
  }

  render();
}

function renderSharedListView(sharedList) {
  const owner = sharedList.username
    ? `@${sharedList.username}'s SeriesTracker list`
    : "Shared SeriesTracker list";
  const rows = sharedList.items
    .map((item, index) => {
      const progress =
        item.mediaType === "movie" || item.total <= 1
          ? item.status
          : `${item.watched}/${item.total}`;

      return `
        <article class="shared-list-item">
          <span class="shared-list-rank">${index + 1}</span>
          <span class="shared-list-copy">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.category)} | ${escapeHtml(item.status)} | ${escapeHtml(progress)}</small>
          </span>
        </article>
      `;
    })
    .join("");

  return `
    <div class="shared-list-view">
      <div class="shared-list-head">
        <span class="login-kicker">SeriesTracker Share</span>
        <h1>${escapeHtml(owner)}</h1>
      </div>
      <div class="shared-list-items">${rows}</div>
      <button type="button" class="hero-btn" onclick="openLogin()">Open My Tracker</button>
    </div>
  `;
}

function buildShareMessage(items, options = {}) {
  const includeLink = options.includeLink !== false;
  const link = options.link || "";
  const header = currentUsername
    ? `@${currentUsername}'s SeriesTracker list`
    : "My SeriesTracker list";
  const entries = items.map((item, index) => {
    const details =
      item.mediaType === "movie" || item.total <= 1
        ? `${item.category} • ${item.status}`
        : `${item.category} • ${item.status} • ${item.watched}/${item.total}`;

    return `${index + 1}. ${item.title} - ${details}`;
  });
  const shareUrl = includeLink && link ? `\n\nView this list: ${link}` : "";

  return `${header}\n\n${entries.join("\n")}${shareUrl}`;
}

async function copyShareLink() {
  const selectedItems = getShareSelectionItems();

  if (!selectedItems.length) {
    showWarning("Select at least one title to make a share link.");
    return;
  }

  let link = "";

  try {
    link = await createShortShareLink(selectedItems);
  } catch (error) {
    const fallbackText = buildShareMessage(selectedItems, { includeLink: false });

    if (await copyTextToClipboard(fallbackText)) {
      closeShareModal();
      showWarning("Short link needs Firebase sharing rules. Share text copied instead.");
      return;
    }

    showError("Could not copy your share list right now.");
    return;
  }

  if (await copyTextToClipboard(link)) {
    closeShareModal();
    showSuccess("Share link copied.");
    return;
  }

  showError("Could not copy the share link right now.");
}

async function shareSelectedTitles() {
  const selectedItems = getShareSelectionItems();

  if (!selectedItems.length) {
    showWarning("Select at least one title to share.");
    return;
  }

  let link = "";

  try {
    link = await createShortShareLink(selectedItems);
  } catch (error) {
    showWarning("Short link could not be created, so sharing text only.");
  }

  const text = buildShareMessage(selectedItems, {
    includeLink: Boolean(link),
    link
  });
  const shareData = {
    title: "SeriesTracker List",
    text
  };

  if (link) {
    shareData.url = link;
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      closeShareModal();
      showSuccess("Share sheet opened.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }

  if (await copyTextToClipboard(text)) {
    closeShareModal();
    showSuccess("Share text copied to your clipboard.");
    return;
  }

  showError("Could not share your list right now.");
}

function isAiringModalOpen() {
  return !document.getElementById("airingModal")?.classList.contains("hidden");
}

function setAiringRefreshBusy(isBusy) {
  const button = document.getElementById("airingRefreshButton");

  if (!button) {
    return;
  }

  button.disabled = isBusy;
  button.textContent = isBusy ? "Checking..." : "Refresh";
}

function startAiringCountdownTimer() {
  if (airingCountdownTimer) {
    return;
  }

  airingCountdownTimer = window.setInterval(() => {
    if (isAiringModalOpen()) {
      renderAiringSchedule();
      return;
    }

    stopAiringCountdownTimer();
  }, 30 * 1000);
}

function stopAiringCountdownTimer() {
  if (!airingCountdownTimer) {
    return;
  }

  window.clearInterval(airingCountdownTimer);
  airingCountdownTimer = null;
}

function syncAiringTabs() {
  document.querySelectorAll("#airingTabs .airing-tab").forEach((button) => {
    const isActive = button.dataset.airingTab === activeAiringTab;

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document
    .getElementById("airingEpisodesPanel")
    ?.classList.toggle("hidden", activeAiringTab !== "episodes");
  document
    .getElementById("airingSeasonsPanel")
    ?.classList.toggle("hidden", activeAiringTab !== "seasons");
}

function syncAiringCategoryFilters() {
  document
    .querySelectorAll("#airingCategoryFilters .airing-filter-btn")
    .forEach((button) => {
      const isActive = button.dataset.airingCategory === activeAiringCategoryFilter;

      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
}

function syncAiringSortControl() {
  const sortFilter = document.getElementById("airingSortFilter");

  if (sortFilter) {
    sortFilter.value = activeAiringSortFilter;
  }
}

function setAiringTab(tab) {
  if (!AIRING_TAB_OPTIONS.has(tab)) {
    return;
  }

  activeAiringTab = tab;
  syncAiringTabs();
}

function setAiringCategoryFilter(category) {
  if (!AIRING_CATEGORY_FILTER_OPTIONS.has(category)) {
    return;
  }

  activeAiringCategoryFilter = category;
  renderAiringSchedule();
}

function setAiringSortFilter(sortValue) {
  activeAiringSortFilter = normalizeFilterValue(
    sortValue,
    SORT_OPTIONS,
    "Oldest"
  );
  renderAiringSchedule();
}

function sortVisibleAiringEntries(entries) {
  return [...entries].sort((left, right) => {
    switch (activeAiringSortFilter) {
      case "AZ":
        return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
      case "ZA":
        return right.title.localeCompare(left.title, undefined, { sensitivity: "base" });
      case "Newest":
        return (
          right.timestamp - left.timestamp ||
          left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
        );
      case "Oldest":
      default:
        return (
          left.timestamp - right.timestamp ||
          left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
        );
    }
  });
}

function getVisibleAiringEntries(kind) {
  const entries = kind === "seasons"
    ? airingScheduleState.seasons
    : airingScheduleState.episodes;

  return sortVisibleAiringEntries(entries.filter(matchesAiringCategoryFilter));
}

function renderAiringPoster(entry) {
  if (entry.image) {
    return `<img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.title)} poster" loading="lazy" decoding="async">`;
  }

  return '<span class="airing-poster-placeholder">No poster</span>';
}

function renderAiringCard(entry) {
  const facts = [
    entry.code,
    getScheduleDateLabel(entry.timestamp, entry.dateOnly),
    entry.detail
  ].filter(Boolean);
  const countdown = getCountdownLabel(entry.timestamp, entry.dateOnly);

  return `
    <article class="airing-card">
      <span class="airing-poster">${renderAiringPoster(entry)}</span>
      <div class="airing-card-copy">
        <div class="airing-card-meta">
          <span>${escapeHtml(entry.category)}</span>
          <span>${escapeHtml(entry.source)}</span>
          <span>${escapeHtml(entry.badge)}</span>
        </div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p class="airing-subtitle">${escapeHtml(entry.subtitle)}</p>
        <div class="airing-facts">
          ${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}
        </div>
      </div>
      <div class="airing-countdown">
        <strong>${escapeHtml(countdown)}</strong>
        <span>${entry.dateOnly ? "Date countdown" : "Countdown"}</span>
      </div>
    </article>
  `;
}

function renderAiringEmpty(title, message) {
  return `
    <div class="airing-empty">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderAiringPanel(kind) {
  if (airingScheduleState.isLoading) {
    return renderAiringEmpty(
      "Checking schedule...",
      "AniList and TMDB are being checked for your added titles."
    );
  }

  if (!airingScheduleState.candidateCount) {
    return renderAiringEmpty(
      "No series to check",
      "Add anime or series titles first, then open Airing again."
    );
  }

  const entries = getVisibleAiringEntries(kind);

  if (!entries.length) {
    const filterLabel =
      activeAiringCategoryFilter === "All" ? "selected titles" : activeAiringCategoryFilter;

    return renderAiringEmpty(
      kind === "seasons" ? "No upcoming seasons found" : "No next episodes found",
      kind === "seasons"
        ? `No announced next season date was found for ${filterLabel} yet.`
        : `Only Watching titles are shown here. No next episode date was found for ${filterLabel} yet.`
    );
  }

  return `<div class="airing-list">${entries.map(renderAiringCard).join("")}</div>`;
}

function renderAiringSchedule() {
  const summaryNode = document.getElementById("airingSummary");
  const statusNode = document.getElementById("airingStatus");
  const episodesPanel = document.getElementById("airingEpisodesPanel");
  const seasonsPanel = document.getElementById("airingSeasonsPanel");

  if (!summaryNode || !statusNode || !episodesPanel || !seasonsPanel) {
    return;
  }

  syncAiringTabs();
  syncAiringCategoryFilters();
  syncAiringSortControl();

  if (airingScheduleState.isLoading) {
    summaryNode.textContent =
      `Checking ${airingScheduleState.candidateCount} added titles...`;
    statusNode.innerHTML = "<p>Loading latest airing data.</p>";
  } else if (airingScheduleState.updatedAt) {
    const visibleEpisodes = getVisibleAiringEntries("episodes");
    const visibleSeasons = getVisibleAiringEntries("seasons");
    const updatedAt = getScheduleDateLabel(
      Date.parse(airingScheduleState.updatedAt),
      false
    );
    summaryNode.textContent =
      `${visibleEpisodes.length} episodes, ${visibleSeasons.length} seasons. Updated ${updatedAt}.`;
    statusNode.innerHTML = airingScheduleState.failedCount
      ? `<p>${airingScheduleState.failedCount} titles could not be checked right now.</p>`
      : "";
  } else {
    summaryNode.textContent = "Upcoming episodes and seasons will appear here.";
    statusNode.innerHTML = "";
  }

  episodesPanel.innerHTML = renderAiringPanel("episodes");
  seasonsPanel.innerHTML = renderAiringPanel("seasons");
  syncAiringTabs();
  syncAiringCategoryFilters();
  syncAiringSortControl();
}

function openAiringModal() {
  if (!currentUser) {
    openLogin();
    showWarning("Log in first to check your airing schedule.");
    return;
  }

  activeAiringTab = "episodes";
  document.getElementById("airingModal")?.classList.remove("hidden");
  renderAiringSchedule();
  startAiringCountdownTimer();
  void refreshAiringSchedule();
}

function closeAiringModal() {
  document.getElementById("airingModal")?.classList.add("hidden");
  stopAiringCountdownTimer();
}

async function refreshAiringSchedule() {
  if (!currentUser || airingScheduleState.isLoading) {
    return;
  }

  const candidates = getAiringScheduleCandidates();
  const loadToken = ++airingLoadToken;

  airingScheduleState = {
    isLoading: true,
    candidateCount: candidates.length,
    failedCount: 0,
    episodes: [],
    seasons: [],
    updatedAt: ""
  };

  setAiringRefreshBusy(true);
  renderAiringSchedule();

  if (!candidates.length) {
    airingScheduleState = {
      isLoading: false,
      candidateCount: 0,
      failedCount: 0,
      episodes: [],
      seasons: [],
      updatedAt: new Date().toISOString()
    };
    setAiringRefreshBusy(false);
    renderAiringSchedule();
    return;
  }

  const settled = await Promise.allSettled(
    candidates.map((item) => resolveAiringScheduleForItem(item))
  );

  if (loadToken !== airingLoadToken) {
    return;
  }

  const episodes = [];
  const seasons = [];
  let failedCount = 0;

  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      failedCount += 1;
      return;
    }

    if (isWatchingScheduleItem(candidates[index])) {
      episodes.push(...(result.value?.episodes || []));
    }

    seasons.push(...(result.value?.seasons || []));
  });

  airingScheduleState = {
    isLoading: false,
    candidateCount: candidates.length,
    failedCount,
    episodes: sortAiringEntries(dedupeAiringEntries(episodes)),
    seasons: sortAiringEntries(dedupeAiringEntries(seasons)),
    updatedAt: new Date().toISOString()
  };

  setAiringRefreshBusy(false);
  renderAiringSchedule();
}

function openAddSeries() {
  if (!currentUser) {
    openLogin();
    showWarning("Log in first to save your tracker.");
    return;
  }

  selectedCategory = currentCategory === "Home" ? "Anime" : currentCategory;
  selectedStatus = "Planned";

  setChoiceSelection("#categoryChoiceButtons", "categoryValue", selectedCategory);
  setChoiceSelection("#statusChoiceButtons", "statusValue", selectedStatus);

  closeModal();
  document.getElementById("categoryModal").classList.remove("hidden");
}

function confirmCategory() {
  selectedCategory =
    getActiveChoiceValue("#categoryChoiceButtons", "categoryValue") || "Anime";
  selectedStatus =
    getActiveChoiceValue("#statusChoiceButtons", "statusValue") || "Planned";

  document.getElementById("categoryModal").classList.add("hidden");
  document.getElementById("searchModal").classList.remove("hidden");
  updateSearchPlaceholder();
}

function confirmAdd() {
  confirmCategory();
}

function closeModal() {
  document.getElementById("searchModal").classList.add("hidden");
  resetSearchModal();
}

function closeCategoryModal() {
  document.getElementById("categoryModal").classList.add("hidden");
}

function closeSettingsModal() {
  setUsernamePanelVisibility(false);
  setDefaultViewPanelVisibility(false);
  setThemePanelVisibility(false);
  document.getElementById("settingsModal")?.classList.add("hidden");
}

function openSettingsModal() {
  closeProfileMenu();
  setUsernamePanelVisibility(false);
  setDefaultViewPanelVisibility(false);
  setThemePanelVisibility(false);
  updateThemeSelectionUI();
  updateDefaultViewSelectionUI();
  updateUsernameSettingsUI();
  document.getElementById("settingsModal")?.classList.remove("hidden");
}

function updateUsernameSettingsUI() {
  const currentValue = document.getElementById("settingsUsernameCurrentValue");
  const input = document.getElementById("settingsUsernameInput");
  const button = document.getElementById("usernameToggleButton");
  const hasUsername = Boolean(currentUsername);

  if (currentValue) {
    currentValue.textContent = hasUsername ? `@${currentUsername}` : "Not set yet";
  }

  if (input) {
    input.value = currentUsername;
  }

  if (button) {
    button.textContent = hasUsername ? "Change Username" : "Set Username";
  }
}

async function saveUsernameChange() {
  const nextUsername = normalizeUsernameValue(
    document.getElementById("settingsUsernameInput")?.value
  );

  if (!currentUser) {
    showWarning("Log in first to set your username.");
    return;
  }

  if (!nextUsername) {
    showWarning("Enter a username to save.");
    return;
  }

  if (!isValidUsername(nextUsername)) {
    showWarning(
      "Username must be 3-20 characters and can use letters, numbers, dots, underscores, or hyphens."
    );
    return;
  }

  if (!isFirebaseReady()) {
    showWarning("Firebase is still initializing. Please try again in a moment.");
    return;
  }

  try {
    const existingUsername = await fetchUsernameRecord(nextUsername);

    if (existingUsername.exists && existingUsername.uid !== currentUser.uid) {
      showWarning("That username is already taken. Try another one.");
      return;
    }

    const syncResult = await syncUsernameToCloud(currentUser, nextUsername, currentUser.email || "", {
      previousUsername: currentUsername
    });
    currentUsername = nextUsername;
    updateUsernameSettingsUI();
    setUsernamePanelVisibility(false);

    if (syncResult.mappingSynced) {
      showSuccess(
        existingUsername.exists && existingUsername.uid === currentUser.uid
          ? "Username refreshed successfully."
          : "Username saved successfully."
      );
    } else {
      showWarning(
        "Username saved to your profile. If username login does not work yet, your Firestore rules may still need an update."
      );
    }
  } catch (error) {
    showError("Could not update your username.");
  }
}

function setUsernamePanelVisibility(isOpen) {
  const panel = document.getElementById("settingsUsernamePanel");
  const button = document.getElementById("usernameToggleButton");

  if (!panel || !button) {
    return;
  }

  panel.classList.toggle("hidden", !isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  button.classList.toggle("active", isOpen);

  if (!isOpen) {
    updateUsernameSettingsUI();
  }
}

function toggleUsernamePanel() {
  const panel = document.getElementById("settingsUsernamePanel");
  const shouldOpen = panel?.classList.contains("hidden");

  setUsernamePanelVisibility(Boolean(shouldOpen));

  if (shouldOpen) {
    setDefaultViewPanelVisibility(false);
    setThemePanelVisibility(false);
    updateUsernameSettingsUI();
  }
}

function setDefaultViewPanelVisibility(isOpen) {
  const panel = document.getElementById("settingsDefaultViewPanel");
  const button = document.getElementById("defaultViewToggleButton");

  if (!panel || !button) {
    return;
  }

  panel.classList.toggle("hidden", !isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  button.classList.toggle("active", isOpen);
}

function toggleDefaultViewPanel() {
  const panel = document.getElementById("settingsDefaultViewPanel");
  const shouldOpen = panel?.classList.contains("hidden");

  setDefaultViewPanelVisibility(Boolean(shouldOpen));

  if (shouldOpen) {
    setUsernamePanelVisibility(false);
    setThemePanelVisibility(false);
    updateDefaultViewSelectionUI();
  }
}

function setThemePanelVisibility(isOpen) {
  const panel = document.getElementById("settingsThemePanel");
  const button = document.getElementById("themeToggleButton");

  if (!panel || !button) {
    return;
  }

  panel.classList.toggle("hidden", !isOpen);
  button.setAttribute("aria-expanded", String(isOpen));
  button.classList.toggle("active", isOpen);
}

function toggleThemePanel() {
  const panel = document.getElementById("settingsThemePanel");
  const shouldOpen = panel?.classList.contains("hidden");

  setThemePanelVisibility(Boolean(shouldOpen));

  if (shouldOpen) {
    setUsernamePanelVisibility(false);
    setDefaultViewPanelVisibility(false);
    updateThemeSelectionUI();
  }
}

function closeProfileMenu() {
  document.getElementById("profileDropdown")?.classList.add("hidden");
  closeSettingsModal();
}

function updateDefaultViewSelectionUI() {
  setChoiceSelection("#defaultCategoryButtons", "defaultCategory", preferredDefaultCategory);
  setChoiceSelection("#defaultSortButtons", "sortValue", preferredDefaultSort);
}

function saveDefaultViewPreferences() {
  try {
    localStorage.setItem(DEFAULT_CATEGORY_STORAGE_KEY, preferredDefaultCategory);
    localStorage.setItem(DEFAULT_SORT_STORAGE_KEY, preferredDefaultSort);
  } catch (error) {
    showError("Could not save the default view.");
  }
}

function loadDefaultViewPreferences() {
  try {
    preferredDefaultCategory = normalizeDefaultCategoryValue(
      localStorage.getItem(DEFAULT_CATEGORY_STORAGE_KEY)
    );
    preferredDefaultSort = normalizeDefaultSortValue(
      localStorage.getItem(DEFAULT_SORT_STORAGE_KEY)
    );
  } catch (error) {
    preferredDefaultCategory = "Home";
    preferredDefaultSort = "Newest";
  }

  updateDefaultViewSelectionUI();
}

function applyCategoryView(category) {
  currentCategory = normalizeDefaultCategoryValue(category);
  document.getElementById("pageTitle").innerText = currentCategory;
}

function applyDefaultViewPreferences(options = {}) {
  const { resetTransientFilters = false } = options;

  applyCategoryView(preferredDefaultCategory);
  activeSortFilter = preferredDefaultSort;

  if (resetTransientFilters) {
    activeCategoryFilter = "All";
    activeStatusFilter = "All";
    activeFavoritesOnly = false;
    searchQuery = "";

    const searchInput = document.getElementById("searchInput");

    if (searchInput) {
      searchInput.value = "";
    }
  }
}

function setDefaultCategoryPreference(category) {
  preferredDefaultCategory = normalizeDefaultCategoryValue(category);
  saveDefaultViewPreferences();
  updateDefaultViewSelectionUI();
  applyDefaultViewPreferences();
  render();
}

function setDefaultSortPreference(sort) {
  preferredDefaultSort = normalizeDefaultSortValue(sort);
  saveDefaultViewPreferences();
  updateDefaultViewSelectionUI();
  applyDefaultViewPreferences();
  render();
}

function toggleProfileMenu() {
  const dropdown = document.getElementById("profileDropdown");

  if (!dropdown) {
    return;
  }

  dropdown.classList.toggle("hidden");
  closeSettingsModal();
}

function applyProfileAvatar() {
  const avatar = document.getElementById("profileAvatar");
  const fallback = document.getElementById("profileFallback");
  const button = document.querySelector(".profile-icon");

  if (!avatar || !fallback || !button) {
    return;
  }

  const hasAvatar = Boolean(profileAvatarData);
  avatar.src = hasAvatar ? profileAvatarData : "";
  avatar.classList.toggle("hidden", !hasAvatar);
  fallback.classList.toggle("hidden", hasAvatar);
  button.classList.toggle("has-avatar", hasAvatar);
}

function readStoredProfileAvatar(email = getUserEmail()) {
  try {
    return localStorage.getItem(getProfileStorageKey(email)) || "";
  } catch (error) {
    return "";
  }
}

function persistProfileAvatarLocally(dataUrl, email = getUserEmail()) {
  try {
    localStorage.setItem(getProfileStorageKey(email), dataUrl);
    return true;
  } catch (error) {
    return false;
  }
}

function loadProfileAvatar() {
  profileAvatarData = readStoredProfileAvatar();
  applyProfileAvatar();
}

function saveProfileAvatar(dataUrl) {
  profileAvatarData = dataUrl;

  if (!persistProfileAvatarLocally(dataUrl)) {
    showError("Could not save the profile picture.");
    return;
  }

  applyProfileAvatar();
  showSuccess("Profile picture updated.");

  if (currentUser) {
    void syncProfileAvatarToCloud(currentUser, dataUrl).catch(() => {
      showWarning("Profile picture was saved locally, but cloud sync failed.");
    });
  }
}

function triggerProfileUpload() {
  closeProfileMenu();
  document.getElementById("profileUploadInput").click();
}

function handleProfileUpload(event) {
  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showWarning("Please choose an image file.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      saveProfileAvatar(reader.result);
    } else {
      showError("Could not read that image file.");
    }
  };
  reader.onerror = () => {
    showError("Could not upload that profile picture.");
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

function localSearch() {
  searchQuery = normalizeText(document.getElementById("searchInput").value);
  render();
}

async function searchAnime() {
  const query = document.getElementById("animeSearchInput").value.trim();
  const resultsNode = document.getElementById("searchResults");

  if (query.length < 2) {
    searchResultsCache = [];
    resultsNode.innerHTML = "";
    return;
  }

  resultsNode.innerHTML = '<p class="muted">Searching...</p>';

  try {
    const response = await fetch(
      `https://little-mountain-71e9.sharmarishav2100.workers.dev?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      throw new Error("Search request failed");
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, 8) : [];

    searchResultsCache = results;

    if (!results.length) {
      resultsNode.innerHTML = '<p class="muted">No results found for that search.</p>';
      return;
    }

    resultsNode.innerHTML = results
      .map((item) => {
        const title = escapeHtml(item.title || item.name || "Untitled");
        const year =
          item.release_date?.slice(0, 4) ||
          item.first_air_date?.slice(0, 4) ||
          "N/A";
        const mediaType = resolveMediaType(item);

        return `
          <div class="search-item">
            <div>
              <h3>${title}</h3>
              <p>${year}</p>
            </div>
            <button type="button" data-action="add-result" data-id="${item.id}" data-media-type="${mediaType}">
              Add
            </button>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    searchResultsCache = [];
    resultsNode.innerHTML =
      '<p class="muted">The search service is unavailable right now. Please try again in a moment.</p>';
  }
}

async function finalAddTMDB(itemId, mediaType) {
  if (!currentUser) {
    openLogin();
    showWarning("Log in first to save your tracker.");
    return;
  }

  const item = searchResultsCache.find((entry) => String(entry.id) === String(itemId));

  if (!item) {
    showWarning("That search result expired. Please search again.");
    return;
  }

  try {
    const data = await fetchTitleDetails(item.id, mediaType);
    const nextEntry = createTrackerEntry(item, data, mediaType);
    const title = nextEntry.title;

    const duplicate = tracker.some(
      (entry) =>
        normalizeText(entry.title) === normalizeText(title) &&
        entry.category === selectedCategory
    );

    if (duplicate) {
      closeModal();
      showWarning("This title is already added in this category.");
      return;
    }

    tracker.unshift(nextEntry);

    closeModal();
    save();
    showSuccess("The title was added to your tracker.");
  } catch (error) {
    showError("Could not load the series details.");
  }
}

function findItem(title) {
  return tracker.find((entry) => entry.title === title);
}

function increaseWatch(title) {
  const item = findItem(title);

  if (!item) {
    return;
  }

  if (item.watched < item.total) {
    item.watched += 1;
  }

  updateStatus(item, true);
  touchTrackerProgress(item);
  touchTrackerItem(item);
  save();
}

function decreaseWatch(title) {
  const item = findItem(title);

  if (!item) {
    return;
  }

  if (item.watched > 0) {
    item.watched -= 1;
  }

  updateStatus(item, true);
  touchTrackerProgress(item);
  touchTrackerItem(item);
  save();
}

function deleteAnime(title) {
  deletingTitle = title;
  document.getElementById("deleteModalMessage").innerText =
    `Are you sure you want to delete "${title}" from your tracker?`;
  document.getElementById("deleteModal").classList.remove("hidden");
}

function editAnime(title) {
  const item = findItem(title);

  if (!item) {
    return;
  }

  editingTitle = item.title;
  document.getElementById("editTitleInput").value = item.title;
  document.getElementById("editTotalInput").value = item.total;
  document.getElementById("editWatchedInput").value = item.watched;
  setEditStatusSelection(STATUS_OPTIONS.has(item.status) ? item.status : "Watching");
  document.getElementById("editModal").classList.remove("hidden");
}

function closeEditModal() {
  editingTitle = "";
  document.getElementById("editModal").classList.add("hidden");
}

function closeDeleteModal() {
  deletingTitle = "";
  document.getElementById("deleteModal").classList.add("hidden");
}

function buildSeasonAirDate(existingAirDate, yearValue) {
  const normalizedYear = String(yearValue || "").trim();

  if (!normalizedYear) {
    return "";
  }

  const suffixMatch = String(existingAirDate || "").match(/^\d{4}-(\d{2}-\d{2})$/);
  return suffixMatch ? `${normalizedYear}-${suffixMatch[1]}` : `${normalizedYear}-01-01`;
}

function getSeasonLabel(season) {
  return season.seasonNumber === 0 ? "Specials" : `Season ${season.seasonNumber || 1}`;
}

function getSeasonDisplayName(season) {
  const label = getSeasonLabel(season);
  return normalizeText(season.name) === normalizeText(label) ? label : season.name || label;
}

function getEpisodesBeforeSeason(seasons, seasonId) {
  let count = 0;

  for (const season of seasons) {
    if (String(season.id) === String(seasonId)) {
      break;
    }

    count += season.episodeCount;
  }

  return count;
}

function renderSeasonEmptyState(title, message) {
  return `
    <div class="season-empty">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderSeasonPoster(season, title) {
  if (season.image) {
    return `<img src="${season.image}" alt="${escapeHtml(title)} ${escapeHtml(season.name)} poster" loading="lazy" decoding="async">`;
  }

  return '<div class="season-poster placeholder">No season poster</div>';
}

function renderSeasonStatusControls(title, season) {
  const encodedTitle = encodeURIComponent(title);
  const encodedSeasonId = encodeURIComponent(String(season.id));
  const currentStatus = SEASON_STATUS_OPTIONS.has(season.status) ? season.status : "Planned";
  const badgeClass = normalizeText(currentStatus);

  return `
    <div class="season-status-row">
      <span class="season-status-badge ${badgeClass}">${escapeHtml(currentStatus)}</span>
      <div class="season-status-actions" role="group" aria-label="Season status">
        ${["Planned", "Watching", "Completed", "Paused", "Dropped"]
          .map((status) => {
            const isActive = status === currentStatus;

            return `
              <button
                type="button"
                class="season-tag-btn${isActive ? " active" : ""}"
                data-action="season-status"
                data-title="${encodedTitle}"
                data-season-id="${encodedSeasonId}"
                data-status="${status}"
                aria-pressed="${isActive ? "true" : "false"}"
              >
                ${status}
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderSeasonEditButton(title, season) {
  const encodedTitle = encodeURIComponent(title);
  const encodedSeasonId = encodeURIComponent(String(season.id));

  return `
    <button
      type="button"
      class="season-card-edit-btn"
      data-action="edit-season"
      data-title="${encodedTitle}"
      data-season-id="${encodedSeasonId}"
    >
      Edit Season
    </button>
  `;
}

function renderSeasonCard(title, season, seriesOverview = "") {
  const label = getSeasonLabel(season);
  const displayName = getSeasonDisplayName(season);
  const hasCustomName = normalizeText(displayName) !== normalizeText(label);
  const year = season.airDate ? season.airDate.slice(0, 4) : "TBA";
  const overview =
    season.overview ||
    String(seriesOverview || "").trim() ||
    "No season description is available yet.";

  return `
    <article class="season-card">
      ${renderSeasonPoster(season, title)}
      <div class="season-copy">
        ${hasCustomName ? `<p class="season-kicker">${escapeHtml(label)}</p>` : ""}
        <div class="season-header-row">
          <div class="season-title-block">
            <h3>${escapeHtml(displayName)}</h3>
            <p class="season-meta">${season.episodeCount} episodes | ${escapeHtml(year)}</p>
          </div>
          ${renderSeasonEditButton(title, season)}
        </div>
        ${renderSeasonStatusControls(title, season)}
        <p class="season-overview">${escapeHtml(overview)}</p>
      </div>
    </article>
  `;
}

function buildSeasonsSummary(item, seasonTotal, seasons = []) {
  const completedCount = seasons.filter((season) => season.status === "Completed").length;
  const detailParts = [
    item.category,
    seasonTotal === 1 ? "1 season" : `${seasonTotal} seasons`
  ];

  if (seasonTotal > 0) {
    detailParts.push(
      completedCount === 1 ? "1 completed" : `${completedCount} completed`
    );
  }

  detailParts.push(
    `${item.watched}/${item.total} tracked`
  );

  return detailParts.join(" | ");
}

async function ensureSeasonData(item) {
  if (!item || item.mediaType !== "tv") {
    return [];
  }

  const existingSeasons = sanitizeSeasonList(item.seasons, item.image);
  item.overview = String(item.overview || "").trim();

  if (existingSeasons.length && item.overview) {
    item.seasons = existingSeasons;
    item.seasonCount = Math.max(getSeasonCount(item), existingSeasons.length);
    return existingSeasons;
  }

  if (!item.id) {
    item.seasons = existingSeasons;
    item.seasonCount = Math.max(getSeasonCount(item), existingSeasons.length);
    return existingSeasons;
  }

  const details = await fetchTitleDetails(item.id, item.mediaType);
  const fallbackImage = item.image || getTmdbImageUrl(details.poster_path);
  const fetchedSeasons = sanitizeSeasonList(details.seasons, fallbackImage);
  const seasons = fetchedSeasons.length ? fetchedSeasons : existingSeasons;

  item.image = fallbackImage;
  item.overview = String(item.overview || details.overview || "").trim();
  item.seasons = seasons;
  item.seasonCount = Math.max(
    seasons.length,
    Number.parseInt(details.number_of_seasons, 10) || 0
  );

  void queueTrackerSync();

  return seasons;
}

function closeSeasonsModal() {
  closeSeasonEditModal();
  activeSeasonsTitle = "";
  seasonLoadToken += 1;
  document.getElementById("seasonsModal").classList.add("hidden");
}

function openSeasonEdit(title, seasonId) {
  const item = findItem(title);

  if (!item) {
    showError("Could not find that title anymore.");
    return;
  }

  const seasons = normalizeSeasonState(item);
  const season = seasons.find((entry) => String(entry.id) === String(seasonId));

  if (!season) {
    showError("Could not find that season.");
    return;
  }

  editingSeasonContext = {
    title: item.title,
    seasonId: String(season.id)
  };

  document.getElementById("seasonEditNameInput").value = season.name || getSeasonLabel(season);
  document.getElementById("seasonEditEpisodesInput").value = season.episodeCount || 1;
  document.getElementById("seasonEditYearInput").value = season.airDate
    ? season.airDate.slice(0, 4)
    : "";
  document.getElementById("seasonEditOverviewInput").value = season.overview || "";
  setChoiceSelection(
    "#seasonEditStatusButtons",
    "statusValue",
    SEASON_STATUS_OPTIONS.has(season.status) ? season.status : "Planned"
  );
  document.getElementById("seasonEditModal").classList.remove("hidden");
}

function closeSeasonEditModal() {
  editingSeasonContext = null;
  document.getElementById("seasonEditModal").classList.add("hidden");
}

function openEditFromSeasons() {
  if (!activeSeasonsTitle) {
    return;
  }

  const titleToEdit = activeSeasonsTitle;
  closeSeasonsModal();
  editAnime(titleToEdit);
}

function refreshSeasonsModal(item) {
  if (!item || activeSeasonsTitle !== item.title) {
    return;
  }

  const titleNode = document.getElementById("seasonsModalTitle");
  const summaryNode = document.getElementById("seasonsModalSummary");
  const grid = document.getElementById("seasonsGrid");
  const seasons = normalizeSeasonState(item);
  const seasonTotal = seasons.length || getSeasonCount(item);

  if (!titleNode || !summaryNode || !grid) {
    return;
  }

  titleNode.textContent = item.title;
  summaryNode.textContent = buildSeasonsSummary(item, seasonTotal || 1, seasons);

  if (!seasons.length) {
    grid.innerHTML = renderSeasonEmptyState(
      "Season details not available",
      "This title does not have separate season data saved yet."
    );
    return;
  }

  grid.innerHTML = seasons
    .map((season) => renderSeasonCard(item.title, season, item.overview))
    .join("");
}

function syncItemProgressFromSeasons(item) {
  const seasons = normalizeSeasonState(item);

  if (!seasons.length) {
    return;
  }

  const total = Math.max(
    1,
    seasons.reduce((count, season) => count + season.episodeCount, 0) || item.total || 1
  );
  const completedEpisodes = seasons
    .filter((season) => season.status === "Completed")
    .reduce((count, season) => count + season.episodeCount, 0);
  const activeSeason = seasons.find((season) => ACTIVE_SEASON_STATUSES.has(season.status));
  let watched = completedEpisodes;
  let nextStatus = "Planned";

  if (activeSeason) {
    const episodesBeforeActive = getEpisodesBeforeSeason(seasons, activeSeason.id);
    const existingWithin = Math.max(0, item.watched - episodesBeforeActive);
    const activeProgress = Math.max(
      1,
      Math.min(activeSeason.episodeCount, existingWithin || 1)
    );

    watched = Math.max(completedEpisodes, episodesBeforeActive + activeProgress);
    nextStatus = activeSeason.status;
  } else if (completedEpisodes >= total) {
    watched = total;
    nextStatus = "Completed";
  } else if (completedEpisodes > 0) {
    watched = completedEpisodes;
    nextStatus = "Planned";
  }

  item.total = total;
  item.watched = Math.min(total, Math.max(0, watched));
  item.status = nextStatus;
  item.seasonCount = Math.max(seasons.length, Number.parseInt(item.seasonCount, 10) || 0);
  touchTrackerItem(item);
}

function setSeasonStatus(title, seasonId, nextStatus) {
  const item = findItem(title);

  if (!item || item.mediaType !== "tv") {
    return;
  }

  const normalizedStatus = SEASON_STATUS_OPTIONS.has(nextStatus) ? nextStatus : "Planned";
  const seasons = normalizeSeasonState(item);
  let updated = false;

  item.seasons = seasons.map((season) => {
    if (String(season.id) === String(seasonId)) {
      updated = true;
      return {
        ...season,
        status: normalizedStatus
      };
    }

    if (
      ACTIVE_SEASON_STATUSES.has(normalizedStatus) &&
      ACTIVE_SEASON_STATUSES.has(season.status)
    ) {
      return {
        ...season,
        status: "Planned"
      };
    }

    return season;
  });

  if (!updated) {
    return;
  }

  syncItemProgressFromSeasons(item);
  render();
  refreshSeasonsModal(item);
  void queueTrackerSync();
}

function submitSeasonEditForm(event) {
  event.preventDefault();

  if (!editingSeasonContext) {
    closeSeasonEditModal();
    return;
  }

  const item = findItem(editingSeasonContext.title);

  if (!item) {
    closeSeasonEditModal();
    showError("Could not find that title anymore.");
    return;
  }

  const seasons = normalizeSeasonState(item);
  const currentSeason = seasons.find(
    (season) => String(season.id) === String(editingSeasonContext.seasonId)
  );

  if (!currentSeason) {
    closeSeasonEditModal();
    showError("Could not find that season anymore.");
    return;
  }

  const newName = document.getElementById("seasonEditNameInput").value.trim();
  const episodesValue = document.getElementById("seasonEditEpisodesInput").value.trim();
  const yearValue = document.getElementById("seasonEditYearInput").value.trim();
  const newOverview = document.getElementById("seasonEditOverviewInput").value.trim();
  const newStatus =
    getActiveChoiceValue("#seasonEditStatusButtons", "statusValue") || currentSeason.status;
  const parsedEpisodes = Number.parseInt(episodesValue, 10);
  const parsedYear = yearValue ? Number.parseInt(yearValue, 10) : null;

  if (!newName) {
    showWarning("Please enter a season name.");
    return;
  }

  if (!Number.isFinite(parsedEpisodes) || parsedEpisodes < 1) {
    showWarning("Season episodes must be at least 1.");
    return;
  }

  if (
    yearValue &&
    (!Number.isFinite(parsedYear) || String(parsedYear).length !== 4 || parsedYear < 1900)
  ) {
    showWarning("Please enter a valid 4-digit year.");
    return;
  }

  item.seasons = seasons.map((season) => {
    if (String(season.id) === String(editingSeasonContext.seasonId)) {
      return {
        ...season,
        name: newName,
        episodeCount: parsedEpisodes,
        airDate: buildSeasonAirDate(season.airDate, yearValue),
        overview: newOverview,
        status: SEASON_STATUS_OPTIONS.has(newStatus) ? newStatus : "Planned"
      };
    }

    if (
      ACTIVE_SEASON_STATUSES.has(newStatus) &&
      ACTIVE_SEASON_STATUSES.has(season.status)
    ) {
      return {
        ...season,
        status: "Planned"
      };
    }

    return season;
  });

  syncItemProgressFromSeasons(item);
  render();
  refreshSeasonsModal(item);
  closeSeasonEditModal();
  void queueTrackerSync();
  showSuccess("Season details updated.");
}

async function openSeasons(title) {
  const item = findItem(title);

  if (!item) {
    showError("Could not find that title anymore.");
    return;
  }

  if (item.mediaType !== "tv") {
    showWarning("Season view is available for series and anime only.");
    return;
  }

  const modal = document.getElementById("seasonsModal");
  const titleNode = document.getElementById("seasonsModalTitle");
  const summaryNode = document.getElementById("seasonsModalSummary");
  const grid = document.getElementById("seasonsGrid");

  if (!modal || !titleNode || !summaryNode || !grid) {
    return;
  }

  const loadToken = ++seasonLoadToken;
  activeSeasonsTitle = item.title;

  titleNode.textContent = item.title;
  summaryNode.textContent = buildSeasonsSummary(item, getSeasonCount(item) || 1, []);
  grid.innerHTML = renderSeasonEmptyState(
    "Loading seasons...",
    "Fetching separate season details for this title."
  );
  modal.classList.remove("hidden");

  try {
    const seasons = await ensureSeasonData(item);

    if (loadToken !== seasonLoadToken || activeSeasonsTitle !== item.title) {
      return;
    }

    if (!seasons.length) {
      refreshSeasonsModal(item);
      return;
    }

    refreshSeasonsModal(item);
  } catch (error) {
    if (loadToken !== seasonLoadToken || activeSeasonsTitle !== item.title) {
      return;
    }

    summaryNode.textContent = buildSeasonsSummary(item, getSeasonCount(item) || 1, []);
    grid.innerHTML = renderSeasonEmptyState(
      "Could not load seasons",
      "Please try opening the season view again in a moment."
    );
  }
}

function setEditStatusSelection(status) {
  setChoiceSelection("#editStatusButtons", "statusValue", status);
}

function setChoiceSelection(containerSelector, dataKey, value) {
  const buttons = document.querySelectorAll(`${containerSelector} .choice-btn`);

  buttons.forEach((button) => {
    const isActive = button.dataset[dataKey] === value;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function getActiveChoiceValue(containerSelector, dataKey) {
  const activeButton = document.querySelector(`${containerSelector} .choice-btn.active`);
  return activeButton?.dataset[dataKey] || "";
}

function confirmDelete() {
  if (!deletingTitle) {
    closeDeleteModal();
    return;
  }

  tracker = tracker.filter((entry) => entry.title !== deletingTitle);
  closeDeleteModal();
  save();
  showSuccess("The title was removed from your tracker.");
}

function submitEditForm(event) {
  event.preventDefault();

  const item = findItem(editingTitle);

  if (!item) {
    closeEditModal();
    showError("Could not find that title anymore.");
    return;
  }

  const newTitle = document.getElementById("editTitleInput").value.trim();
  const totalValue = document.getElementById("editTotalInput").value.trim();
  const watchedValue = document.getElementById("editWatchedInput").value.trim();
  const newStatus = getActiveChoiceValue("#editStatusButtons", "statusValue") || "Watching";

  if (!newTitle) {
    showWarning("Please enter a title.");
    return;
  }

  const parsedTotal = Number.parseInt(totalValue, 10);
  const parsedWatched = Number.parseInt(watchedValue, 10);
  const previousWatched = Number.parseInt(item.watched, 10) || 0;

  if (!Number.isFinite(parsedTotal) || parsedTotal < 1) {
    showWarning("Total episodes must be at least 1.");
    return;
  }

  if (!Number.isFinite(parsedWatched) || parsedWatched < 0) {
    showWarning("Watched episodes cannot be negative.");
    return;
  }

  item.title = newTitle;
  item.total = parsedTotal;
  item.watched = parsedWatched;

  if (STATUS_OPTIONS.has(newStatus)) {
    item.status = newStatus;
  } else {
    updateStatus(item, true);
  }

  updateStatus(item);
  if (parsedWatched !== previousWatched) {
    touchTrackerProgress(item);
  }
  touchTrackerItem(item);
  closeEditModal();
  save();
  showSuccess("Your changes were saved.");
}

function updateStatus(item, forceProgressStatus = false) {
  if (!item) {
    return;
  }

  if (!Number.isFinite(item.total) || item.total < 1) {
    item.total = 1;
  }

  if (!Number.isFinite(item.watched) || item.watched < 0) {
    item.watched = 0;
  }

  if (item.watched > item.total) {
    item.watched = item.total;
  }

  if (
    !forceProgressStatus &&
    (item.status === "Paused" || item.status === "Dropped") &&
    item.watched > 0 &&
    item.watched < item.total
  ) {
    return;
  }

  if (item.watched === 0) {
    item.status = "Planned";
  } else if (item.watched < item.total) {
    item.status = "Watching";
  } else {
    item.status = "Completed";
  }
}

function save() {
  if (!currentUser) {
    openLogin();
    showWarning("Log in first.");
    return;
  }

  render();
  void queueTrackerSync();
}

function setCategory(category) {
  applyCategoryView(category);
  render();
}

function matchesSearch(item) {
  if (!searchQuery) {
    return true;
  }

  const haystack = normalizeText(`${item.title} ${item.status} ${item.category}`);
  return haystack.includes(searchQuery);
}

function matchesLibraryFilters(item) {
  if (activeFavoritesOnly && !item.isFavorite) {
    return false;
  }

  if (activeStatusFilter !== "All" && item.status !== activeStatusFilter) {
    return false;
  }

  if (
    currentCategory === "Home" &&
    activeCategoryFilter !== "All" &&
    item.category !== activeCategoryFilter
  ) {
    return false;
  }

  return true;
}

function sortLibraryItems(items) {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      switch (activeSortFilter) {
        case "AZ":
          return (
            left.item.title.localeCompare(right.item.title, undefined, { sensitivity: "base" }) ||
            left.index - right.index
          );
        case "ZA":
          return (
            right.item.title.localeCompare(left.item.title, undefined, { sensitivity: "base" }) ||
            left.index - right.index
          );
        case "Oldest": {
          const leftTime = getTimestampValue(left.item.createdAt);
          const rightTime = getTimestampValue(right.item.createdAt);
          return leftTime - rightTime || left.index - right.index;
        }
        case "Newest":
        default: {
          const leftTime = getTimestampValue(left.item.createdAt);
          const rightTime = getTimestampValue(right.item.createdAt);
          return rightTime - leftTime || left.index - right.index;
        }
      }
    })
    .map((entry) => entry.item);
}

function syncLibraryFilters() {
  const categoryFilter = document.getElementById("categoryFilter");
  const statusFilter = document.getElementById("statusFilter");
  const sortFilter = document.getElementById("sortFilter");
  const favoritesFilterButton = document.getElementById("favoritesFilterButton");

  if (categoryFilter) {
    categoryFilter.disabled = currentCategory !== "Home";
    categoryFilter.value =
      currentCategory === "Home" ? activeCategoryFilter : currentCategory;
  }

  if (statusFilter) {
    statusFilter.value = activeStatusFilter;
  }

  if (sortFilter) {
    sortFilter.value = activeSortFilter;
  }

  if (favoritesFilterButton) {
    favoritesFilterButton.classList.toggle("active", activeFavoritesOnly);
    favoritesFilterButton.setAttribute("aria-pressed", String(activeFavoritesOnly));
    favoritesFilterButton.setAttribute(
      "aria-label",
      activeFavoritesOnly ? "Show all titles" : "Show starred titles"
    );
    favoritesFilterButton.setAttribute(
      "title",
      activeFavoritesOnly ? "Show all titles" : "Show starred titles"
    );
  }
}

function renderPoster(item) {
  return renderPosterForTitle(item, item.title);
}

function renderFavoriteButton(item, actionTitle) {
  const encodedTitle = encodeURIComponent(actionTitle);
  const isFavorite = Boolean(item.isFavorite);
  const buttonLabel = isFavorite
    ? `Remove ${actionTitle} from favorites`
    : `Add ${actionTitle} to favorites`;

  return `
    <button
      type="button"
      class="favorite-toggle${isFavorite ? " active" : ""}"
      data-action="toggle-favorite"
      data-title="${encodedTitle}"
      aria-pressed="${String(isFavorite)}"
      aria-label="${escapeHtml(buttonLabel)}"
      title="${escapeHtml(buttonLabel)}"
    >
      <span aria-hidden="true">${isFavorite ? "&#9733;" : "&#9734;"}</span>
    </button>
  `;
}

function renderCardCopyControl(actionTitle) {
  const encodedTitle = encodeURIComponent(actionTitle);

  return `
    <span class="card-copy">
      <button
        type="button"
        class="copy-toggle"
        data-action="open-copy-menu"
        data-title="${encodedTitle}"
        aria-expanded="false"
        aria-label="Copy options for ${escapeHtml(actionTitle)}"
        title="Copy"
      >
        <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="8" y="8" width="12" height="14" rx="2"></rect>
          <path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
    </span>
  `;
}

function renderPosterForTitle(item, actionTitle) {
  const posterMarkup = item.image
    ? `<img src="${item.image}" alt="${escapeHtml(item.title)} poster" loading="lazy" decoding="async">`
    : '<div class="card-poster placeholder">No poster</div>';
  const favoriteButton = renderFavoriteButton(item, actionTitle);

  return `
    <div class="poster-shell">
      ${posterMarkup}
      ${favoriteButton}
    </div>
  `;
}

function renderDetailsButton(item, actionTitle) {
  if (item.mediaType !== "tv") {
    return "";
  }

  const encodedTitle = encodeURIComponent(actionTitle);

  return `
    <button
      type="button"
      class="details-pill"
      data-action="view-seasons"
      data-title="${encodedTitle}"
      aria-label="View details for ${escapeHtml(actionTitle)}"
    >
      Details
    </button>
  `;
}

function renderSeasonHint(item) {
  if (item.mediaType !== "tv") {
    return "";
  }

  const seasonTotal = getSeasonCount(item);
  const seasonLabel =
    seasonTotal > 0 ? `${seasonTotal} ${seasonTotal === 1 ? "season" : "seasons"}` : "Open seasons";

  return `<p class="card-note">${escapeHtml(seasonLabel)}</p>`;
}

function getFocusedSeasonProgress(item, preferredStatus = item?.status || "") {
  if (!item || item.mediaType !== "tv") {
    return null;
  }

  const seasons = normalizeSeasonState(item);

  if (!seasons.length) {
    return null;
  }

  const normalizedStatus = SEASON_STATUS_OPTIONS.has(preferredStatus)
    ? preferredStatus
    : item.status;
  let targetSeason = null;

  if (normalizedStatus === "Completed") {
    const completedSeasons = seasons.filter((season) => season.status === "Completed");
    targetSeason = completedSeasons[completedSeasons.length - 1] || null;
  } else {
    targetSeason = seasons.find((season) => season.status === normalizedStatus) || null;
  }

  if (targetSeason) {
    const episodesBeforeTarget = getEpisodesBeforeSeason(seasons, targetSeason.id);
    const existingWithin = Math.max(0, item.watched - episodesBeforeTarget);
    const targetTotal = Math.max(1, targetSeason.episodeCount);
    let watchedWithin = Math.min(targetTotal, existingWithin);

    if (targetSeason.status === "Completed") {
      watchedWithin = targetTotal;
    } else if (targetSeason.status === "Planned") {
      watchedWithin = 0;
    } else if (ACTIVE_SEASON_STATUSES.has(targetSeason.status)) {
      watchedWithin = Math.max(1, Math.min(targetTotal, existingWithin || 1));
    }

    return {
      season: targetSeason,
      watched: watchedWithin,
      total: targetTotal
    };
  }

  let completedEpisodes = 0;

  for (let index = 0; index < seasons.length; index += 1) {
    const season = seasons[index];
    const seasonTotal = Math.max(1, season.episodeCount);
    const seasonEnd = completedEpisodes + seasonTotal;

    if (item.watched < seasonEnd || index === seasons.length - 1) {
      return {
        season,
        watched: Math.min(seasonTotal, Math.max(0, item.watched - completedEpisodes)),
        total: seasonTotal
      };
    }

    completedEpisodes = seasonEnd;
  }

  return null;
}

function renderFocusedSeasonCard(
  item,
  preferredStatus = item.status,
  options = {}
) {
  const currentSeason = getFocusedSeasonProgress(item, preferredStatus);
  const useOverallProgress = Boolean(options.useOverallProgress);

  if (!currentSeason) {
    return renderCard(item);
  }

  const seasonTitle = getSeasonDisplayName(currentSeason.season);
  const seasonLabel = getSeasonLabel(currentSeason.season);
  const contextParts = [seasonTitle];

  if (normalizeText(seasonTitle) !== normalizeText(seasonLabel)) {
    contextParts.push(seasonLabel);
  }

  return renderCard(
    {
      ...item,
      title: item.title,
      image: currentSeason.season.image || item.image,
      watched: useOverallProgress ? item.watched : currentSeason.watched,
      total: useOverallProgress ? item.total : currentSeason.total,
      status: currentSeason.season.status || preferredStatus
    },
    {
      actionTitle: item.title,
      note: `<p class="card-note">${escapeHtml(contextParts.join(" | "))}</p>`
    }
  );
}

function renderCurrentWatchingCard(item) {
  return renderFocusedSeasonCard(item, "Watching");
}

function renderLibraryCard(item) {
  return renderFocusedSeasonCard(item, item.status, { useOverallProgress: true });
}

function renderCard(item, options = {}) {
  const actionTitle = options.actionTitle || item.title;
  const encodedTitle = encodeURIComponent(actionTitle);
  const noteMarkup = options.note ?? renderSeasonHint(item);

  return `
    <div class="card">
      ${renderPosterForTitle(item, actionTitle)}
      <div class="card-meta">
        <span class="tag">${escapeHtml(item.category)}</span>
        ${renderDetailsButton(item, actionTitle)}
      </div>
      <h3 class="card-title">${escapeHtml(item.title)}${renderCardCopyControl(actionTitle)}</h3>
      <p class="progress">${item.watched}/${item.total} | ${escapeHtml(item.status)}</p>
      ${noteMarkup}
      <div class="actions">
        <button type="button" class="green" data-action="increase" data-title="${encodedTitle}">+1</button>
        <button type="button" class="white" data-action="decrease" data-title="${encodedTitle}">-1</button>
        <button type="button" class="yellow" data-action="edit" data-title="${encodedTitle}">Edit</button>
        <button type="button" class="red" data-action="delete" data-title="${encodedTitle}">X</button>
      </div>
    </div>
  `;
}

function renderEmptyHome() {
  return `
    <div class="empty-home">
      <div class="overlay">
        <p class="seo-kicker">Anime, drama and movie progress tracker</p>
        <h1 id="homeTitle">Track every watch in one place</h1>
        <p>Keep your anime, donghua, C-dramas, K-dramas, movies, and web series synced with episode progress, favorites, and airing schedules.</p>
        <button type="button" class="hero-btn" onclick="openSignup()">Create Free Account</button>
      </div>
    </div>
  `;
}

function renderEmptyPanel(title, message) {
  return `
    <div class="empty-panel">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function updateAuthVisibility() {
  const isLoggedIn = Boolean(currentUser);
  document.body.classList.toggle("is-authenticated", isLoggedIn);
  document.body.classList.toggle("is-guest", !isLoggedIn);
  document.getElementById("landingSection").classList.toggle("hidden", isLoggedIn);
  document.getElementById("currentlySection").classList.toggle("hidden", !isLoggedIn);
  document.getElementById("librarySection").classList.toggle("hidden", !isLoggedIn);
}

function render() {
  updateAuthVisibility();
  syncLibraryFilters();
  const sharePanel = document.getElementById("shareInlinePanel");
  const syncOpenSharePanel = () => {
    if (sharePanel && !sharePanel.classList.contains("hidden")) {
      renderShareSelection();
    }
  };

  if (!currentUser) {
    sharePanel?.classList.add("hidden");
    setSharePanelButtonState(false);
    resetShareModalState();
    document.getElementById("landingHero").innerHTML = sharedListFromLink
      ? renderSharedListView(sharedListFromLink)
      : renderEmptyHome();
    document.getElementById("currentlyWatching").innerHTML = "";
    document.getElementById("mainGrid").innerHTML = "";
    syncOpenSharePanel();
    return;
  }

  document.getElementById("landingHero").innerHTML = "";

  const watchingList = tracker
    .filter((item) => item.status === "Watching" && matchesSearch(item))
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rightProgress = getProgressTimestamp(right.item);
      const leftProgress = getProgressTimestamp(left.item);
      return rightProgress - leftProgress || left.index - right.index;
    })
    .map((entry) => entry.item);

  document.getElementById("currentlyWatching").innerHTML = watchingList.length
    ? watchingList.map(renderCurrentWatchingCard).join("")
    : renderEmptyPanel(
        "Nothing is in progress yet",
        "Titles you are currently watching will appear here first."
      );

  let filtered =
    currentCategory === "Home"
      ? tracker
      : tracker.filter((item) => item.category === currentCategory);

  filtered = filtered.filter(matchesSearch).filter(matchesLibraryFilters);
  filtered = sortLibraryItems(filtered);

  const hasNonFavoriteFilters =
    activeStatusFilter !== "All" ||
    (currentCategory === "Home" && activeCategoryFilter !== "All");
  const hasActiveFilters =
    hasNonFavoriteFilters || activeFavoritesOnly;

  if (!tracker.length && currentCategory === "Home" && !searchQuery) {
    document.getElementById("mainGrid").innerHTML = renderEmptyHome();
    syncOpenSharePanel();
    return;
  }

  if (!filtered.length) {
    const isFilteredFavoritesView = activeFavoritesOnly;
    const emptyTitle = isFilteredFavoritesView
      ? searchQuery || hasNonFavoriteFilters
        ? "No matching starred titles found"
        : "No starred titles yet"
      : searchQuery || hasActiveFilters
        ? "No matching titles found"
        : "No titles in this section yet";
    const emptyMessage = isFilteredFavoritesView
      ? searchQuery || hasNonFavoriteFilters
        ? "Try adjusting your search or filters."
        : "Hover over any card and tap the star to save favorites here."
      : searchQuery || hasActiveFilters
        ? "Try adjusting your search or filters."
        : "You can add a new title with Add Series.";

    document.getElementById("mainGrid").innerHTML = renderEmptyPanel(
      emptyTitle,
      emptyMessage
    );
    syncOpenSharePanel();
    return;
  }

  document.getElementById("mainGrid").innerHTML = filtered.map(renderLibraryCard).join("");
  syncOpenSharePanel();
}

function openLogin() {
  closeProfileMenu();
  closeSignup();
  document.getElementById("loginModal").classList.remove("hidden");
}

function closeLogin() {
  document.getElementById("loginModal").classList.add("hidden");
  document.getElementById("loginPassword").value = "";
}

function openSignup() {
  closeProfileMenu();
  closeLogin();
  document.getElementById("signupModal").classList.remove("hidden");
}

function closeSignup() {
  document.getElementById("signupModal").classList.add("hidden");
  document.getElementById("signupUsername").value = "";
  document.getElementById("signupEmail").value = "";
  document.getElementById("signupPassword").value = "";
}

function getAuthErrorMessage(error, fallback) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "This email is already registered. Try logging in.";
    case "auth/invalid-email":
      return "The email format is invalid.";
    case "auth/user-not-found":
      return "No account was found for this email or username.";
    case "auth/weak-password":
      return "The password must be at least 6 characters long.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "The email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts were made. Please wait a bit and try again.";
    case "auth/network-request-failed":
      return "A network error occurred. Check your internet connection.";
    default:
      return fallback;
  }
}

async function login() {
  const identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!identifier || !password) {
    showWarning("Please enter your email or username, plus your password.");
    return;
  }

  if (!isFirebaseReady()) {
    showWarning("Firebase is still initializing. Please try again in a moment.");
    return;
  }

  try {
    const { auth, signInWithEmailAndPassword } = getFirebaseApi();
    const email = await resolveIdentifierToEmail(identifier);
    await signInWithEmailAndPassword(auth, email, password);
    closeLogin();
    showSuccess("Logged in successfully.");
  } catch (error) {
    showError(getAuthErrorMessage(error, "Login failed."));
  }
}

async function signup() {
  const username = normalizeUsernameValue(document.getElementById("signupUsername").value);
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!username || !email || !password) {
    showWarning("Username, email, and password are all required to create an account.");
    return;
  }

  if (!isValidUsername(username)) {
    showWarning(
      "Username must be 3-20 characters and can use letters, numbers, dots, underscores, or hyphens."
    );
    return;
  }

  if (!isFirebaseReady()) {
    showWarning("Firebase is still initializing. Please try again in a moment.");
    return;
  }

  try {
    const existingUsername = await fetchUsernameRecord(username);

    if (existingUsername.exists) {
      showWarning("That username is already taken. Try another one.");
      return;
    }

    const { auth, createUserWithEmailAndPassword } = getFirebaseApi();
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    try {
      const syncResult = await syncUsernameToCloud(credential.user, username, email, {
        previousUsername: ""
      });

      if (!syncResult.mappingSynced) {
        showWarning(
          "Account created and username saved, but username login may need a Firestore rules update."
        );
      }
    } catch (usernameError) {
      showWarning("Account created, but username sync is pending. Use email to log in for now.");
    }

    closeSignup();
    showSuccess("Account created successfully.");
  } catch (error) {
    showError(getAuthErrorMessage(error, "Could not create the account."));
  }
}

async function forgotPassword() {
  const identifier = document.getElementById("loginIdentifier").value.trim();

  if (!identifier) {
    showWarning("Enter your email or username first, then tap forgot password.");
    return;
  }

  if (!isFirebaseReady()) {
    showWarning("Firebase is still initializing. Please try again in a moment.");
    return;
  }

  try {
    const { auth, sendPasswordResetEmail } = getFirebaseApi();
    const email = await resolveIdentifierToEmail(identifier);
    await sendPasswordResetEmail(auth, email);
    showSuccess("Password reset email sent. Please check your inbox.");
  } catch (error) {
    showError(getAuthErrorMessage(error, "Could not send the password reset email."));
  }
}

async function logout() {
  if (!isFirebaseReady()) {
    showWarning("Firebase is not ready yet.");
    return;
  }

  try {
    const { auth, signOut } = getFirebaseApi();
    await signOut(auth);
    closeProfileMenu();
    showSuccess("Logged out successfully.");
  } catch (error) {
    showError("Logout failed.");
  }
}

function toggleFavorite(title) {
  const item = findItem(title);

  if (!item) {
    return;
  }

  item.isFavorite = !item.isFavorite;
  touchTrackerItem(item);
  save();
  showSuccess(
    item.isFavorite
      ? `"${item.title}" added to favorites.`
      : `"${item.title}" removed from favorites.`
  );
}

function toggleFavoritesView() {
  activeFavoritesOnly = !activeFavoritesOnly;
  render();
}

function normalizeThemeValue(value) {
  const nextTheme = String(value ?? "").trim();
  return THEME_OPTIONS.has(nextTheme) ? nextTheme : DEFAULT_THEME;
}

function getCurrentTheme() {
  return normalizeThemeValue(document.body.dataset.theme || DEFAULT_THEME);
}

function updateThemeSelectionUI() {
  const activeTheme = getCurrentTheme();

  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    const isActive = button.dataset.themeOption === activeTheme;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function applyTheme(theme, options = {}) {
  const { persist = true } = options;
  const nextTheme = normalizeThemeValue(theme);

  document.body.classList.remove("light-mode");

  if (nextTheme === DEFAULT_THEME) {
    document.body.removeAttribute("data-theme");
  } else {
    document.body.dataset.theme = nextTheme;
  }

  updateThemeSelectionUI();

  if (!persist) {
    return;
  }

  if (nextTheme === DEFAULT_THEME) {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }
}

function loadSavedTheme() {
  const savedTheme = normalizeThemeValue(localStorage.getItem(THEME_STORAGE_KEY));
  applyTheme(savedTheme, { persist: false });
}

function setTheme(theme) {
  applyTheme(theme);
}

function resetThemeToDefault() {
  applyTheme(DEFAULT_THEME);
}

function toggleDarkMode() {
  if (getCurrentTheme() === DEFAULT_THEME) {
    setTheme("netflix-red");
    return;
  }

  resetThemeToDefault();
}

function contactUs() {
  closeProfileMenu();
  window.location.href = "contact.html";
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");

  if (!container) {
    return;
  }

  const toneMap = {
    success: { title: "Success", icon: "OK" },
    error: { title: "Error", icon: "!" },
    warning: { title: "Notice", icon: "!" },
    info: { title: "Update", icon: "i" }
  };

  const tone = toneMap[type] || toneMap.info;
  const toast = document.createElement("div");

  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-badge" aria-hidden="true">${tone.icon}</div>
    <div class="toast-copy">
      <p class="toast-title">${tone.title}</p>
      <p class="toast-message">${escapeHtml(message)}</p>
    </div>
    <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>
  `;

  const dismissToast = () => {
    if (!toast.isConnected || toast.classList.contains("is-closing")) {
      return;
    }

    toast.classList.add("is-closing");
    window.setTimeout(() => {
      toast.remove();
    }, 220);
  };

  toast.querySelector(".toast-close")?.addEventListener("click", dismissToast);
  container.prepend(toast);
  window.setTimeout(dismissToast, 2600);
}

function showSuccess(message) {
  showToast(message, "success");
}

function showError(message) {
  showToast(message, "error");
}

function showWarning(message) {
  showToast(message, "warning");
}

function getCardCopyMenu() {
  let popup = document.getElementById("cardCopyMenu");

  if (popup) {
    return popup;
  }

  popup = document.createElement("div");
  popup.id = "cardCopyMenu";
  popup.className = "copy-menu floating-copy-menu";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", "Copy options");
  popup.innerHTML = `
    <button type="button" data-copy-action="title" role="menuitem">Copy Name</button>
    <button type="button" data-copy-action="details" role="menuitem">Copy Details</button>
  `;
  popup.addEventListener("click", handleFloatingCopyMenuAction);
  document.body.appendChild(popup);

  return popup;
}

function hideFloatingCopyMenu() {
  const popup = document.getElementById("cardCopyMenu");

  if (!popup) {
    return;
  }

  popup.classList.remove("is-open");
  popup.removeAttribute("style");
  popup.querySelectorAll("[data-title]").forEach((button) => {
    delete button.dataset.title;
  });
  activeCardCopyTitle = "";
}

function closeCardCopyMenus(exceptMenu = null) {
  document.querySelectorAll(".card-copy.is-open").forEach((menu) => {
    if (menu === exceptMenu) {
      return;
    }

    menu.classList.remove("is-open");
    menu.querySelector(".copy-toggle")?.setAttribute("aria-expanded", "false");
  });

  if (!exceptMenu) {
    hideFloatingCopyMenu();
  }
}

function positionCardCopyMenu(button, popup) {
  if (!button || !popup) {
    return;
  }

  const margin = 8;
  const gap = 6;
  const buttonRect = button.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const centeredLeft = buttonRect.left + buttonRect.width / 2 - popupRect.width / 2;
  const maxLeft = Math.max(margin, viewportWidth - popupRect.width - margin);
  const left = Math.min(Math.max(margin, centeredLeft), maxLeft);
  const hasSpaceBelow = buttonRect.bottom + gap + popupRect.height <= viewportHeight - margin;
  const top = hasSpaceBelow
    ? buttonRect.bottom + gap
    : Math.max(margin, buttonRect.top - popupRect.height - gap);

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function toggleCardCopyMenu(button) {
  const menu = button.closest(".card-copy");

  if (!menu) {
    return;
  }

  const shouldOpen = !menu.classList.contains("is-open");

  closeCardCopyMenus(menu);

  if (!shouldOpen) {
    menu.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    hideFloatingCopyMenu();
    return;
  }

  const popup = getCardCopyMenu();

  activeCardCopyTitle = button.dataset.title || "";
  popup.querySelectorAll("button[data-copy-action]").forEach((option) => {
    option.dataset.title = activeCardCopyTitle;
  });
  menu.classList.add("is-open");
  button.setAttribute("aria-expanded", "true");
  popup.classList.add("is-open");
  positionCardCopyMenu(button, popup);
}

function formatCardDetails(item) {
  const isMovie = item.mediaType === "movie";
  const lines = [
    item.title,
    `Category: ${item.category}`,
    `Type: ${isMovie ? "Movie" : "Series"}`,
    `Status: ${item.status}`
  ];

  if (isMovie) {
    lines.push(`Watched: ${item.watched > 0 ? "Yes" : "No"}`);
  } else {
    lines.push(`Progress: ${item.watched}/${item.total} episodes`);
    lines.push(`Seasons: ${getSeasonCount(item) || "Not available"}`);
  }

  const latestDate = item.lastProgressAt || item.updatedAt || item.createdAt;

  if (latestDate) {
    const parsedDate = new Date(latestDate);

    if (!Number.isNaN(parsedDate.getTime())) {
      lines.push(
        `Last updated: ${parsedDate.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric"
        })}`
      );
    }
  }

  if (item.overview) {
    lines.push("", `Overview: ${item.overview}`);
  }

  if (!isMovie && Array.isArray(item.seasons) && item.seasons.length) {
    lines.push("", "Season details:");
    item.seasons.forEach((season) => {
      const episodeCount = Math.max(0, Number.parseInt(season.episodeCount, 10) || 0);
      const parts = [
        getSeasonDisplayName(season),
        episodeCount ? `${episodeCount} episodes` : "",
        SEASON_STATUS_OPTIONS.has(season.status) ? season.status : "Planned"
      ].filter(Boolean);

      lines.push(`- ${parts.join(" | ")}`);
    });
  }

  return lines.join("\n");
}

async function copyCardTitle(title) {
  const item = findItem(title);
  const text = item?.title || title;

  if (!text) {
    showError("Could not find that title anymore.");
    return;
  }

  closeCardCopyMenus();

  if (await copyTextToClipboard(text)) {
    showSuccess("Name copied.");
    return;
  }

  showError("Could not copy the name right now.");
}

async function copyCardDetails(title) {
  const item = findItem(title);

  if (!item) {
    closeCardCopyMenus();
    showError("Could not find that title anymore.");
    return;
  }

  closeCardCopyMenus();

  if (await copyTextToClipboard(formatCardDetails(item))) {
    showSuccess("Full details copied.");
    return;
  }

  showError("Could not copy the details right now.");
}

function handleFloatingCopyMenuAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest?.("button[data-copy-action]");

  if (!button) {
    return;
  }

  event.stopPropagation();

  const title = decodeURIComponent(button.dataset.title || activeCardCopyTitle || "");

  if (button.dataset.copyAction === "title") {
    void copyCardTitle(title);
    return;
  }

  if (button.dataset.copyAction === "details") {
    void copyCardDetails(title);
  }
}

function handleCardAction(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest?.("button[data-action]");

  if (!button) {
    return;
  }

  const title = decodeURIComponent(button.dataset.title || "");

  switch (button.dataset.action) {
    case "open-copy-menu":
      event.stopPropagation();
      toggleCardCopyMenu(button);
      break;
    case "copy-title":
      event.stopPropagation();
      void copyCardTitle(title);
      break;
    case "copy-details":
      event.stopPropagation();
      void copyCardDetails(title);
      break;
    case "view-seasons":
      void openSeasons(title);
      break;
    case "toggle-favorite":
      toggleFavorite(title);
      break;
    case "increase":
      increaseWatch(title);
      break;
    case "decrease":
      decreaseWatch(title);
      break;
    case "edit":
      editAnime(title);
      break;
    case "delete":
      deleteAnime(title);
      break;
    default:
      break;
  }
}

function handleSearchResultAction(event) {
  const button = event.target.closest('button[data-action="add-result"]');

  if (!button) {
    return;
  }

  void finalAddTMDB(button.dataset.id, button.dataset.mediaType || "tv");
}

function handleShareSelectionAction(event) {
  const button = event.target.closest("button[data-share-title]");

  if (!button) {
    return;
  }

  toggleShareSelection(decodeURIComponent(button.dataset.shareTitle || ""));
}

function handleSeasonAction(event) {
  const editButton = event.target.closest('button[data-action="edit-season"]');

  if (editButton) {
    const title = decodeURIComponent(editButton.dataset.title || "");
    const seasonId = decodeURIComponent(editButton.dataset.seasonId || "");

    openSeasonEdit(title, seasonId);
    return;
  }

  const button = event.target.closest('button[data-action="season-status"]');

  if (!button) {
    return;
  }

  const title = decodeURIComponent(button.dataset.title || "");
  const seasonId = decodeURIComponent(button.dataset.seasonId || "");
  const status = button.dataset.status || "Planned";

  setSeasonStatus(title, seasonId, status);
}

function bindEventListeners() {
  document.getElementById("mainGrid").addEventListener("click", handleCardAction);
  document
    .getElementById("currentlyWatching")
    .addEventListener("click", handleCardAction);
  document
    .getElementById("searchResults")
    .addEventListener("click", handleSearchResultAction);
  document
    .getElementById("shareSelectionList")
    .addEventListener("click", handleShareSelectionAction);
  document.getElementById("seasonsGrid").addEventListener("click", handleSeasonAction);
  document.getElementById("airingTabs").addEventListener("click", (event) => {
    const button = event.target.closest(".airing-tab");

    if (!button) {
      return;
    }

    setAiringTab(button.dataset.airingTab || "episodes");
  });
  document.getElementById("airingCategoryFilters").addEventListener("click", (event) => {
    const button = event.target.closest(".airing-filter-btn");

    if (!button) {
      return;
    }

    setAiringCategoryFilter(button.dataset.airingCategory || "All");
  });
  document.getElementById("airingSortFilter").addEventListener("change", (event) => {
    setAiringSortFilter(event.target.value);
  });

  document.addEventListener("click", (event) => {
    const menu = document.getElementById("profileDropdown");
    const button = document.querySelector(".profile-icon");
    const settingsModal = document.getElementById("settingsModal");
    const settingsContent = settingsModal?.querySelector(".settings-modal");
    const clickedInsideCopyMenu = Boolean(
      event.target.closest(".card-copy, .floating-copy-menu")
    );

    if (!clickedInsideCopyMenu) {
      closeCardCopyMenus();
    }

    if (!menu || !button) {
      return;
    }

    const clickedInsideMenu = menu.contains(event.target);
    const clickedButton = button.contains(event.target);
    const clickedInsideSettings = Boolean(settingsContent?.contains(event.target));

    if (!clickedInsideMenu && !clickedButton && !clickedInsideSettings) {
      closeProfileMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCardCopyMenus();
      closeProfileMenu();
      closeModal();
      closeShareModal();
      closeCategoryModal();
      closeSettingsModal();
      closeSeasonEditModal();
      closeSeasonsModal();
      closeAiringModal();
      closeLogin();
      closeSignup();
      closeEditModal();
      closeDeleteModal();
    }
  });

  window.addEventListener("resize", () => {
    closeCardCopyMenus();
  });
  window.addEventListener(
    "scroll",
    () => {
      closeCardCopyMenus();
    },
    true
  );

  window.addEventListener("hashchange", () => {
    void syncSharedListFromLocation();
  });

  document.getElementById("loginModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeLogin();
    }
  });
  document.getElementById("signupModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeSignup();
    }
  });
  document.getElementById("settingsModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeSettingsModal();
    }
  });
  document.getElementById("seasonEditModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeSeasonEditModal();
    }
  });
  document.getElementById("airingModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeAiringModal();
    }
  });

  document.getElementById("editForm").addEventListener("submit", submitEditForm);
  document.getElementById("seasonEditForm").addEventListener("submit", submitSeasonEditForm);
  document
    .getElementById("profileUploadInput")
    .addEventListener("change", handleProfileUpload);
  document.getElementById("editStatusButtons").addEventListener("click", (event) => {
    const button = event.target.closest(".choice-btn");

    if (!button) {
      return;
    }

    setEditStatusSelection(button.dataset.statusValue || "Watching");
  });
  document.getElementById("seasonEditStatusButtons").addEventListener("click", (event) => {
    const button = event.target.closest(".choice-btn");

    if (!button) {
      return;
    }

    setChoiceSelection(
      "#seasonEditStatusButtons",
      "statusValue",
      button.dataset.statusValue || "Planned"
    );
  });
  document.getElementById("categoryChoiceButtons").addEventListener("click", (event) => {
    const button = event.target.closest(".choice-btn");

    if (!button) {
      return;
    }

    setChoiceSelection(
      "#categoryChoiceButtons",
      "categoryValue",
      button.dataset.categoryValue || "Anime"
    );
  });
  document.getElementById("statusChoiceButtons").addEventListener("click", (event) => {
    const button = event.target.closest(".choice-btn");

    if (!button) {
      return;
    }

    setChoiceSelection(
      "#statusChoiceButtons",
      "statusValue",
      button.dataset.statusValue || "Planned"
    );
  });
  document.getElementById("categoryFilter").addEventListener("change", (event) => {
    activeCategoryFilter = normalizeFilterValue(
      event.target.value,
      new Set(["All", ...CATEGORY_OPTIONS]),
      "All"
    );
    render();
  });
  document.getElementById("statusFilter").addEventListener("change", (event) => {
    activeStatusFilter = normalizeFilterValue(
      event.target.value,
      new Set(["All", ...STATUS_OPTIONS]),
      "All"
    );
    render();
  });
  document.getElementById("sortFilter").addEventListener("change", (event) => {
    activeSortFilter = normalizeFilterValue(
      event.target.value,
      SORT_OPTIONS,
      "Newest"
    );
    render();
  });
}

async function startAuthListener() {
  if (authListenerStarted) {
    return;
  }

  authListenerStarted = true;

  const ready = await waitForFirebase();

  if (!ready) {
    showError("Firebase could not connect. Please check the configuration.");
    return;
  }

  const { auth, onAuthStateChanged } = getFirebaseApi();

  onAuthStateChanged(auth, async (user) => {
    const loadToken = ++authLoadToken;

    if (!user) {
      currentUser = null;
      currentUsername = "";
      tracker = [];
      closeAiringModal();
      loadProfileAvatar();
      updateUsernameSettingsUI();
      render();
      return;
    }

    currentUser = user;
    currentUsername = "";
    tracker = [];
    loadDefaultViewPreferences();
    applyDefaultViewPreferences({ resetTransientFilters: true });
    loadProfileAvatar();
    updateUsernameSettingsUI();
    render();

    try {
      const nextUserData = await loadUserDataForUser(user);

      if (loadToken !== authLoadToken) {
        return;
      }

      tracker = nextUserData.tracker;
      currentUsername = nextUserData.username || "";
      profileAvatarData = nextUserData.profileAvatar || "";
      applyProfileAvatar();
      updateUsernameSettingsUI();
      render();
    } catch (error) {
      if (loadToken !== authLoadToken) {
        return;
      }

      currentUsername = "";
      tracker = [];
      updateUsernameSettingsUI();
      render();
      showError("Could not load your cloud tracker.");
    }
  });
}

function initApp() {
  bindEventListeners();
  loadSavedTheme();
  loadDefaultViewPreferences();
  loadProfileAvatar();
  updateUsernameSettingsUI();
  render();
  void syncSharedListFromLocation();
  void startAuthListener();
}

initApp();

window.openAddSeries = openAddSeries;
window.openShareModal = openShareModal;
window.toggleSharePanel = toggleSharePanel;
window.closeShareModal = closeShareModal;
window.filterShareSelection = filterShareSelection;
window.selectAllShareItems = selectAllShareItems;
window.clearShareSelection = clearShareSelection;
window.copyShareLink = copyShareLink;
window.shareSelectedTitles = shareSelectedTitles;
window.confirmCategory = confirmCategory;
window.confirmAdd = confirmAdd;
window.closeModal = closeModal;
window.closeCategoryModal = closeCategoryModal;
window.toggleProfileMenu = toggleProfileMenu;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.localSearch = localSearch;
window.searchAnime = searchAnime;
window.setCategory = setCategory;
window.toggleFavoritesView = toggleFavoritesView;
window.toggleUsernamePanel = toggleUsernamePanel;
window.saveUsernameChange = saveUsernameChange;
window.setDefaultCategoryPreference = setDefaultCategoryPreference;
window.setDefaultSortPreference = setDefaultSortPreference;
window.openLogin = openLogin;
window.closeLogin = closeLogin;
window.openSignup = openSignup;
window.closeSignup = closeSignup;
window.login = login;
window.signup = signup;
window.forgotPassword = forgotPassword;
window.logout = logout;
window.toggleThemePanel = toggleThemePanel;
window.toggleDefaultViewPanel = toggleDefaultViewPanel;
window.setTheme = setTheme;
window.resetThemeToDefault = resetThemeToDefault;
window.toggleDarkMode = toggleDarkMode;
window.contactUs = contactUs;
window.closeEditModal = closeEditModal;
window.closeDeleteModal = closeDeleteModal;
window.closeSeasonsModal = closeSeasonsModal;
window.openEditFromSeasons = openEditFromSeasons;
window.closeSeasonEditModal = closeSeasonEditModal;
window.openAiringModal = openAiringModal;
window.closeAiringModal = closeAiringModal;
window.refreshAiringSchedule = refreshAiringSchedule;
window.confirmDelete = confirmDelete;
window.triggerProfileUpload = triggerProfileUpload;
