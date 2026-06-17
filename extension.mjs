// Copilot canvas extension: 2026 FIFA World Cup match map.
//
// Renders an interactive Leaflet map (one marker per match at its venue, color-coded by
// result vs. upcoming) in the GitHub Copilot app side panel. Exposes agent-callable canvas
// actions (refresh / focus / filter) plus standalone CLI tools so the agent can answer match
// questions even when the canvas isn't open.
//
// NOTE: stdout is reserved for the JSON-RPC protocol — never console.log here. Use
// session.log() for anything the user should see.

import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { startServer } from "./server.mjs";
import { getMatches, filterMatches } from "./data.mjs";

const server = await startServer();

/** Format a single match as a one-line text summary for tool output. */
function formatMatch(m) {
  if (m.status === "result") {
    return `${m.home} ${m.homeScore ?? "-"}–${m.awayScore ?? "-"} ${m.away} (FT) · ${m.venue}, ${m.city}${m.date ? " · " + m.date : ""}`;
  }
  const when = m.date ? `${m.date}${m.time ? " " + m.time.slice(0, 5) : ""}` : "TBD";
  return `${m.home} vs ${m.away} · ${when} · ${m.venue}, ${m.city}`;
}

const canvas = createCanvas({
  id: "worldcup-map",
  displayName: "2026 World Cup Map",
  description:
    "Interactive map of 2026 FIFA World Cup matches at their venues, showing results and upcoming fixtures.",
  actions: [
    {
      name: "refresh_matches",
      description: "Re-fetch the latest World Cup results and fixtures and update the map.",
      handler: async () => {
        const matches = await getMatches({ force: true });
        server.broadcast("reload", { count: matches.length });
        return `Refreshed ${matches.length} matches.`;
      },
    },
    {
      name: "focus_match",
      description:
        "Pan and zoom the map to a specific match and open its details. Provide a team name or a match id.",
      inputSchema: {
        type: "object",
        properties: {
          team: { type: "string", description: "Team whose match to focus (e.g. 'Mexico')." },
          id: { type: "string", description: "Exact match id to focus." },
        },
      },
      handler: async (ctx) => {
        const input = ctx.input || {};
        server.broadcast("focus", { team: input.team, id: input.id });
        return `Focused the map on ${input.team || input.id || "the requested match"}.`;
      },
    },
    {
      name: "filter_matches",
      description:
        "Filter the markers shown on the map by status (results vs upcoming) and/or team.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "result", "upcoming"],
            description: "Which matches to show.",
          },
          team: { type: "string", description: "Only show matches involving this team." },
        },
      },
      handler: async (ctx) => {
        const input = ctx.input || {};
        server.broadcast("filter", { status: input.status, team: input.team });
        const parts = [];
        if (input.status && input.status !== "all") parts.push(input.status + "s");
        if (input.team) parts.push("team " + input.team);
        return parts.length ? `Filtered to ${parts.join(", ")}.` : "Cleared filters.";
      },
    },
  ],
  open: async () => ({
    url: server.url,
    title: "2026 World Cup Map",
    status: "Live results & fixtures",
  }),
});

const session = await joinSession({
  canvases: [canvas],
  tools: [
    {
      name: "worldcup_list_matches",
      description:
        "List 2026 FIFA World Cup matches (results and/or upcoming fixtures), optionally filtered by team or status.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "result", "upcoming"],
            description: "Filter by match status. Defaults to all.",
          },
          team: { type: "string", description: "Only matches involving this team." },
        },
      },
      handler: async (args) => {
        const all = await getMatches();
        const matches = filterMatches(all, {
          status: args.status === "result" || args.status === "upcoming" ? args.status : "all",
          team: args.team,
        });
        if (matches.length === 0) return "No matches found for that filter.";
        const lines = matches.map((m) => "• " + formatMatch(m));
        return `${matches.length} match(es):\n${lines.join("\n")}`;
      },
    },
    {
      name: "worldcup_match_detail",
      description: "Get details for a single 2026 World Cup match by team name or match id.",
      parameters: {
        type: "object",
        properties: {
          team: { type: "string", description: "A team in the match (e.g. 'USA')." },
          id: { type: "string", description: "Exact match id." },
        },
      },
      handler: async (args) => {
        const all = await getMatches();
        let m = args.id ? all.find((x) => x.id === String(args.id)) : null;
        if (!m && args.team) {
          const t = String(args.team).toLowerCase();
          m = all.find((x) => x.home.toLowerCase().includes(t) || x.away.toLowerCase().includes(t));
        }
        if (!m) return "No matching match found.";
        const details = [
          formatMatch(m),
          `Status: ${m.status === "result" ? "Full time" : "Upcoming"}`,
          m.round ? `Round: ${m.round}` : null,
          `Venue: ${m.venue}${m.exactVenue ? "" : " (approx. location)"} — ${m.city}, ${m.country}`,
          m.status === "result" && m.video ? `Highlights: ${m.video}` : null,
        ].filter(Boolean);
        return details.join("\n");
      },
    },
  ],
});

await session.log("World Cup map canvas ready. Open the '2026 World Cup Map' canvas in the app to view it.");
