// Data layer: fetch 2026 FIFA World Cup matches from TheSportsDB, normalize them into a
// stable shape, geo-enrich via venues.mjs, classify finished vs. upcoming, and cache.

import { resolveVenue } from "./venues.mjs";

const TSDB_KEY = process.env.THESPORTSDB_KEY || "123"; // free public test key
const LEAGUE_ID = "4429"; // FIFA World Cup
const SEASON = process.env.WORLDCUP_SEASON || "2026";
const API = `https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}`;

// TheSportsDB's eventsseason endpoint is only partially populated for the live
// tournament, and upcoming fixtures are exposed through other endpoints. We therefore
// merge several sources and dedupe by idEvent:
//   - eventsround per matchday  -> the full schedule (results + upcoming) per round
//   - eventsnextleague          -> nearest upcoming fixtures (incl. knockouts once set)
//   - eventspastleague          -> most recent finished fixtures
//   - eventsseason              -> baseline fallback
// Group stage = rounds 1-3 (24 matches each). Knockout rounds appear in the next/past
// feeds as they are scheduled. Extra round numbers can be added via WORLDCUP_ROUNDS.
const GROUP_ROUNDS = (process.env.WORLDCUP_ROUNDS || "1,2,3")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

function buildEndpoints() {
  return [
    ...GROUP_ROUNDS.map((r) => `${API}/eventsround.php?id=${LEAGUE_ID}&r=${r}&s=${SEASON}`),
    `${API}/eventsnextleague.php?id=${LEAGUE_ID}`,
    `${API}/eventspastleague.php?id=${LEAGUE_ID}`,
    `${API}/eventsseason.php?id=${LEAGUE_ID}&s=${SEASON}`,
  ];
}

const CACHE_TTL_MS = 60_000;

/** @type {{ at: number, matches: NormalizedMatch[] } | null} */
let cache = null;

/**
 * @typedef {Object} NormalizedMatch
 * @property {string} id
 * @property {string} event           Full "Home vs Away" label
 * @property {string} home
 * @property {string} away
 * @property {string|null} homeBadge
 * @property {string|null} awayBadge
 * @property {string|null} date        ISO date (YYYY-MM-DD)
 * @property {string|null} time        Local kickoff time (HH:MM:SS)
 * @property {number|null} kickoff     Epoch ms of kickoff, if known
 * @property {string} venue
 * @property {string} country
 * @property {number|null} homeScore
 * @property {number|null} awayScore
 * @property {number|null} round
 * @property {boolean} finished
 * @property {"result"|"upcoming"} status
 * @property {number} lat
 * @property {number} lng
 * @property {string} city
 * @property {boolean} exactVenue
 * @property {string|null} thumb
 * @property {string|null} video
 */

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseKickoff(event) {
  // Prefer the explicit timestamp; fall back to date + time.
  const ts = event.strTimestamp ? Date.parse(event.strTimestamp) : NaN;
  if (Number.isFinite(ts)) return ts;
  if (event.dateEvent) {
    const composed = `${event.dateEvent}T${event.strTime || "00:00:00"}Z`;
    const parsed = Date.parse(composed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isFinished(event) {
  const status = String(event.strStatus || "").trim().toUpperCase();
  if (status === "FT" || status === "AET" || status === "PEN" || status === "MATCH FINISHED") return true;
  const hasScores = event.intHomeScore !== null && event.intHomeScore !== "" && event.intAwayScore !== null && event.intAwayScore !== "";
  // Treat a past match with recorded scores as finished even if status is blank.
  if (hasScores) return true;
  return false;
}

/** Map a raw TheSportsDB event to our normalized + geo-enriched shape. */
function normalizeEvent(event) {
  const venueInfo = resolveVenue(event.strVenue, event.strCountry);
  const finished = isFinished(event);
  return {
    id: String(event.idEvent),
    event: event.strEvent || `${event.strHomeTeam} vs ${event.strAwayTeam}`,
    home: event.strHomeTeam || "",
    away: event.strAwayTeam || "",
    homeBadge: event.strHomeTeamBadge || null,
    awayBadge: event.strAwayTeamBadge || null,
    date: event.dateEvent || null,
    time: event.strTimeLocal || event.strTime || null,
    kickoff: parseKickoff(event),
    venue: event.strVenue || venueInfo.name,
    country: event.strCountry || venueInfo.country,
    homeScore: finished ? toNumber(event.intHomeScore) : null,
    awayScore: finished ? toNumber(event.intAwayScore) : null,
    round: toNumber(event.intRound),
    finished,
    status: finished ? "result" : "upcoming",
    lat: venueInfo.lat,
    lng: venueInfo.lng,
    city: venueInfo.city,
    exactVenue: venueInfo.exact,
    thumb: event.strThumb || null,
    video: event.strVideo || null,
  };
}

/** Fetch one endpoint, returning its events array (or [] on any failure). */
async function fetchEvents(url) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.events) ? json.events : [];
  } catch {
    return [];
  }
}

/** How "complete" a raw event looks, used to pick the best copy when deduping. */
function completeness(event) {
  const hasScore =
    event.intHomeScore !== null && event.intHomeScore !== "" &&
    event.intAwayScore !== null && event.intAwayScore !== "";
  const hasStatus = !!String(event.strStatus || "").trim();
  return (hasScore ? 2 : 0) + (hasStatus ? 1 : 0);
}

/**
 * Fetch, merge, and normalize all World Cup matches from every source endpoint,
 * deduped by idEvent, cached for CACHE_TTL_MS.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<NormalizedMatch[]>}
 */
export async function getMatches(opts = {}) {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_TTL_MS) return cache.matches;

  const endpoints = buildEndpoints();
  const lists = await Promise.all(endpoints.map(fetchEvents));
  const raw = lists.flat();

  if (raw.length === 0) {
    if (cache) return cache.matches; // serve stale on total failure
    throw new Error("TheSportsDB returned no events from any endpoint");
  }

  // Dedupe by idEvent, keeping the most complete copy (a finished/scored record
  // wins over an earlier "not started" copy of the same fixture).
  const byId = new Map();
  for (const event of raw) {
    const id = String(event.idEvent || "");
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || completeness(event) > completeness(existing)) byId.set(id, event);
  }

  const matches = [...byId.values()]
    .map(normalizeEvent)
    .sort((a, b) => (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity));

  cache = { at: now, matches };
  return matches;
}

/**
 * Apply optional team/status filters to a match list.
 * @param {NormalizedMatch[]} matches
 * @param {{ team?: string, status?: "result"|"upcoming"|"all" }} [filter]
 */
export function filterMatches(matches, filter = {}) {
  let out = matches;
  if (filter.status && filter.status !== "all") {
    out = out.filter((m) => m.status === filter.status);
  }
  if (filter.team) {
    const needle = filter.team.toLowerCase();
    out = out.filter((m) => m.home.toLowerCase().includes(needle) || m.away.toLowerCase().includes(needle));
  }
  return out;
}

/** Invalidate the cache so the next getMatches() refetches. */
export function clearCache() {
  cache = null;
}
