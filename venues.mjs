// Static geo lookup for 2026 FIFA World Cup venues.
// TheSportsDB events expose `strVenue`/`strCountry` but no coordinates, so we map
// venue names to lat/lng here. Matching is tolerant of accents, punctuation, and the
// commercial vs. FIFA-neutral stadium names via aliases.

/** @typedef {{ name: string, lat: number, lng: number, city: string, country: string }} Venue */

/** Canonical host venues (16). */
export const VENUES = [
  { name: "Estadio Azteca", lat: 19.3029, lng: -99.1505, city: "Mexico City", country: "Mexico" },
  { name: "Estadio Akron", lat: 20.6819, lng: -103.4625, city: "Guadalajara", country: "Mexico" },
  { name: "Estadio BBVA", lat: 25.6694, lng: -100.2444, city: "Monterrey", country: "Mexico" },
  { name: "BMO Field", lat: 43.6332, lng: -79.4185, city: "Toronto", country: "Canada" },
  { name: "BC Place", lat: 49.2767, lng: -123.1119, city: "Vancouver", country: "Canada" },
  { name: "SoFi Stadium", lat: 33.9535, lng: -118.3392, city: "Los Angeles", country: "USA" },
  { name: "Levi's Stadium", lat: 37.403, lng: -121.9698, city: "San Francisco Bay Area", country: "USA" },
  { name: "Lumen Field", lat: 47.5952, lng: -122.3316, city: "Seattle", country: "USA" },
  { name: "Gillette Stadium", lat: 42.0909, lng: -71.2643, city: "Boston", country: "USA" },
  { name: "MetLife Stadium", lat: 40.8135, lng: -74.0745, city: "New York / New Jersey", country: "USA" },
  { name: "Lincoln Financial Field", lat: 39.9008, lng: -75.1675, city: "Philadelphia", country: "USA" },
  { name: "Hard Rock Stadium", lat: 25.958, lng: -80.2389, city: "Miami", country: "USA" },
  { name: "Mercedes-Benz Stadium", lat: 33.7553, lng: -84.4006, city: "Atlanta", country: "USA" },
  { name: "NRG Stadium", lat: 29.6847, lng: -95.4107, city: "Houston", country: "USA" },
  { name: "AT&T Stadium", lat: 32.7473, lng: -97.0945, city: "Dallas", country: "USA" },
  { name: "Arrowhead Stadium", lat: 39.0489, lng: -94.4839, city: "Kansas City", country: "USA" },
];

// Alternate names FIFA or data sources may use, mapped to a canonical venue name above.
const ALIASES = {
  "estadio ciudad de mexico": "Estadio Azteca",
  "estadio guadalajara": "Estadio Akron",
  "estadio akron de guadalajara": "Estadio Akron",
  "estadio monterrey": "Estadio BBVA",
  "estadio bbva bancomer": "Estadio BBVA",
  "toronto stadium": "BMO Field",
  "vancouver stadium": "BC Place",
  "los angeles stadium": "SoFi Stadium",
  "san francisco bay area stadium": "Levi's Stadium",
  "santa clara stadium": "Levi's Stadium",
  "seattle stadium": "Lumen Field",
  "boston stadium": "Gillette Stadium",
  "foxborough stadium": "Gillette Stadium",
  "new york new jersey stadium": "MetLife Stadium",
  "new york / new jersey stadium": "MetLife Stadium",
  "philadelphia stadium": "Lincoln Financial Field",
  "miami stadium": "Hard Rock Stadium",
  "atlanta stadium": "Mercedes-Benz Stadium",
  "houston stadium": "NRG Stadium",
  "reliant stadium": "NRG Stadium",
  "dallas stadium": "AT&T Stadium",
  "kansas city stadium": "Arrowhead Stadium",
  "estadio gnp seguros": "Estadio Azteca",
};

// Country centroids used as a last-resort fallback when a venue name is unknown.
const COUNTRY_CENTROIDS = {
  usa: { lat: 39.5, lng: -98.35, city: "United States", country: "USA" },
  "united states": { lat: 39.5, lng: -98.35, city: "United States", country: "USA" },
  mexico: { lat: 23.6345, lng: -102.5528, city: "Mexico", country: "Mexico" },
  canada: { lat: 56.1304, lng: -106.3468, city: "Canada", country: "Canada" },
};

/** Normalize a name for tolerant matching: lowercase, strip accents/punctuation, collapse spaces. */
function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_NAME = new Map(VENUES.map((v) => [normalize(v.name), v]));
const BY_ALIAS = new Map(
  Object.entries(ALIASES).map(([alias, canonical]) => [normalize(alias), BY_NAME.get(normalize(canonical))]),
);

/**
 * Resolve a venue name (and optional country) to coordinates.
 * Returns { ...venue, exact: boolean } so callers can flag approximate placements.
 *
 * @param {string} venueName
 * @param {string} [country]
 * @returns {Venue & { exact: boolean }}
 */
export function resolveVenue(venueName, country) {
  const key = normalize(venueName);
  const hit = BY_NAME.get(key) || BY_ALIAS.get(key);
  if (hit) return { ...hit, exact: true };

  // Partial contains match (e.g. "MetLife Stadium (East Rutherford)").
  for (const [name, venue] of BY_NAME) {
    if (key && (key.includes(name) || name.includes(key))) return { ...venue, exact: true };
  }

  const centroid = COUNTRY_CENTROIDS[normalize(country)];
  if (centroid) {
    return { name: venueName || centroid.city, ...centroid, exact: false };
  }
  // Unknown venue and country: drop a pin at a neutral North America center.
  return { name: venueName || "Unknown venue", lat: 39.5, lng: -98.35, city: "Unknown", country: country || "", exact: false };
}
