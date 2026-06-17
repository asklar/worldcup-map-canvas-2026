# 🌎 2026 FIFA World Cup Map — Copilot Canvas Extension

A [GitHub Copilot **canvas extension**](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
that renders the 2026 FIFA World Cup on an interactive map. Each match is a marker placed
at its venue — **green for finished results, orange for upcoming fixtures** — with popups
showing team badges, score or kickoff time, venue, and round. You can filter by status or
team, and the agent can drive the map for you.

Match data comes live from [TheSportsDB](https://www.thesportsdb.com/); the map uses
[Leaflet](https://leafletjs.com/) with [OpenStreetMap](https://www.openstreetmap.org/) tiles.

![Demo: 2026 World Cup matches on the canvas map](./assets/demo.gif)

<!--
  Want an inline VIDEO PLAYER instead of the GIF? GitHub only renders a player for videos
  uploaded through its web UI (which mint a github.com/asklar/worldcup-map-canvas-2026/assets/... URL):
    1. On github.com, click "Edit" on this README (or open a throwaway issue).
    2. Drag `assets/demo.mp4` into the text box and wait for upload.
    3. Copy the generated https://github.com/asklar/worldcup-map-canvas-2026/assets/... URL.
    4. Paste that URL on its own line below this comment, then commit.
  A committed mp4 linked by raw URL or a <video> tag will NOT play inline — only the
  uploaded-attachment URL does.
-->

> **Note:** Canvases render in the **GitHub Copilot desktop app** side panel — not in the
> CLI terminal. You need the app to see the map.

## Install

Clone into your user-scoped Copilot extensions directory so it's available in every session:

```bash
git clone https://github.com/asklar/worldcup-map-canvas-2026 "$HOME/.copilot/extensions/worldcup-map"
```

On Windows (PowerShell):

```powershell
git clone https://github.com/asklar/worldcup-map-canvas-2026 "$env:USERPROFILE\.copilot\extensions\worldcup-map"
```

Then reload extensions (or restart the CLI / `/clear`). In the Copilot app, open the
**“2026 World Cup Map”** canvas.

To share it with a single team instead, drop the folder into a repo's
`.github/extensions/worldcup-map/` (project scope) and everyone working in that repo gets it
automatically.

## Usage

In the canvas:

- **↻ Refresh** — re-fetch the latest results and fixtures
- **All / Results / Upcoming** — filter markers by status
- **Filter team…** — show only matches involving a team
- Click a marker for match details

Ask the agent in natural language (these map to agent-callable capabilities):

- *"Refresh the World Cup matches"* → `refresh_matches`
- *"Focus on Mexico's match"* → `focus_match`
- *"Show only upcoming games"* / *"Filter to Brazil"* → `filter_matches`

These tools also work **without** the canvas open and return text:

- `worldcup_list_matches` — list matches (optional `status` / `team`)
- `worldcup_match_detail` — details for a single match (by `team` or `id`)

## Configuration

All optional, via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `THESPORTSDB_KEY` | `123` | TheSportsDB API key. `123` is a shared **test** key — get your own for reliable use. |
| `WORLDCUP_PORT` | `60698` | Fixed local port for the canvas server (stable across reloads). |
| `WORLDCUP_SEASON` | `2026` | TheSportsDB season to load. |
| `WORLDCUP_ROUNDS` | `1,2,3` | Group-stage matchday rounds to fetch. |

## How it works

```
worldcup-map/
  extension.mjs   Canvas + tools wiring: createCanvas() + joinSession()
  server.mjs      Local HTTP/SSE server (/, /api/matches, /api/refresh, /events)
  data.mjs        TheSportsDB fetch, merge across endpoints, normalize, cache, classify
  venues.mjs      Static lookup: 16 host venues -> lat/lng (+ aliases, fallbacks)
  public/
    index.html    Leaflet map UI (markers, popups, legend, filters, SSE client)
```

- The extension starts a small local server and registers a canvas whose `open()` returns
  that server's URL; the app renders it in the side panel.
- TheSportsDB's `eventsseason` feed is only partially populated during the live tournament,
  so `data.mjs` merges **per-round** (`eventsround`) data with the `eventsnextleague` and
  `eventspastleague` feeds, deduped by match id, to get all 72 group matches (results +
  upcoming). Knockout fixtures appear automatically as they're scheduled.
- Events from TheSportsDB have no coordinates, so `venues.mjs` maps each venue name to the
  correct host-stadium lat/lng.
- Agent actions push commands (reload / focus / filter) to the open page over
  Server-Sent Events.

### Run the server standalone (development)

You can test the data pipeline without the app:

```bash
node server.mjs            # prints a local URL
curl http://127.0.0.1:60698/api/matches
```

## Attribution

- Match data: [TheSportsDB](https://www.thesportsdb.com/) — please review their terms and
  use your own API key.
- Map rendering: [Leaflet](https://leafletjs.com/) (BSD-2-Clause).
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

MIT — see [LICENSE](./LICENSE).
