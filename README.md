# Simple Personal Website

A simple music-and-photography site with a DIY feel.

The site has three sections behind a small menu: photos, music and zines. A `<`
at the top left goes up one level. The Bandcamp player sits in the footer and
keeps playing while you move between sections.

## Structure

- `src/`: app code (`index.html`, `server.py`) and frontend assets in `src/static/`
- `tests/`: Python and frontend tests
- `Dockerfile`: deployment container
- `fly.toml`: Fly.io configuration
- `assets/photos/`: put your images here
- `assets/music/`: put your mp3 files here
- `assets/zines/`: generated zine pages, produced by `make prepare-zines`

## How To Use It

1. Copy your photos into `assets/photos/`.
2. Copy your music into `assets/music/`.
3. Start the server and the site will show them automatically.

Each photo title is derived from the file name.
Track titles and album order are read from audio metadata when available.
Right now that metadata lookup is implemented for `FLAC` and `MP3` files:

- `granada-de-noche.jpg` will show up as `granada de noche`
- a track with `TITLE=Mi cancion` will show up as `Mi cancion`
- a track with `TRACKNUMBER=2` will appear as track 2 in the album list

If a music file has no readable metadata, the site falls back to the file name.

## Run Locally

Start it with:

```bash
python3 -m src.server
```

Then open `http://127.0.0.1:8000`.

Deploy to Fly with:

```bash
make deploy
```

## Git hooks

The repository includes:

- a `pre-commit` hook that formats Python with `ruff` and lints it
- a `pre-push` hook that runs the full test suite and enforces the configured Python coverage threshold before each `git push`

`make test` runs both the Python tests and the frontend behavior tests.
`make format-python` reformats Python files in `scripts/`, `src/`, and `tests/`.
`make lint-python` runs `ruff check` on the Python code.
`make check-python-coverage` runs the Python test suite with coverage and fails if the total drops below `COVERAGE_MIN` (default: `90`).

To enable it in your local clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
chmod +x .githooks/pre-push
```

You can override the coverage threshold for one push if needed:

```bash
COVERAGE_MIN=95 git push
```

## Bandcamp

Music is an embedded Bandcamp player fixed at the bottom of the page, with a picker (album cover thumbnails) to choose which album plays (currently `la tormenta` and `ola de incendios`). The embed colors switch between the light and dark theme automatically, and the chosen album is remembered between visits.

To add another album, drop a square cover image in `assets/icons/` and add `{ "id": "<embed id>", "title": "<display title>", "cover": "/assets/icons/<file>" }` to `src/static/data/albums.json` — nothing else needs to change. Get the embed id from the album's Bandcamp page: "Share / Embed" → "Embed this album" → copy the `<iframe>` code and take the number after `album=` in its `src`. The cover image has to be provided manually; Bandcamp doesn't expose the artwork file for a given album id without scraping the page (which its bot protection blocks).

The `assets/music/` pipeline (metadata parsing, `/api/media` `music` key, `track_play` analytics) still exists in the backend but nothing in the frontend renders it right now.

The music section lists the same albums as cards; clicking one loads it in the footer player instead of opening a new page. The section is headed by a link to Bandcamp, and below the albums a link to YouTube heads an embed of one chosen video (`FEATURED_VIDEO_SRC` in `src/static/js/music.js`, loaded the first time the section opens).

## Zines

A zine here is a standard one-sheet zine: a single landscape A4 printed on one side, holding a 4x2 grid of panels with the top row upside down, folded and cut into an eight page booklet. `make prepare-zines` renders that sheet, trims the printed cut guides, slices the panels, turns the top row the right way up and writes the eight pages in reading order to `assets/zines/`, plus a manifest.

```bash
make prepare-zines                      # reads ~/Documents/zines
make prepare-zines ZINES_SRC=/other/dir
```

Which zines get published is `src/static/data/zines.json`, one entry per zine:

```json
{ "slug": "la-tormenta", "title": "la tormenta", "source": "tormenta/la-tormenta.pdf", "page": 1 }
```

`source` is relative to the PDF folder. Add `"download": "tormenta/tormenta-bp.pdf"` if the file people should print is a different one, for instance the version with the back page merged in; otherwise the sheet being sliced is the one offered. After editing the list, rerun `make prepare-zines` and then `make sync KIND=zines SRC=assets/zines`. Pages no longer listed are removed from `assets/zines/` on the next run.

The reader opens a zine like a booklet: the cover alone, then pages 2-3, 4-5 and 6-7 as spreads, then the back cover. That matters because these zines often carry one photo drawn across two panels, and those panels are exactly the ones that end up facing each other. The reader is a small 3D book: each sheet has a page on either side and turns about the spine, darkening as it goes, and the closed book slides to keep its cover centred. Arrow keys work too.

Each zine also offers its PDF for download, so anyone can print and fold their own copy.

If you change how the sheet is sliced, bump `PREPARE_VERSION` in `scripts/zine_prepare.py`; page URLs are cached as immutable and are versioned from that number plus the source PDF.

## FMEL-1

`/fmel-1` sends visitors to MEL, an FM-1 firmware, on GitHub Pages (`https://antonioaltea.github.io/fmel-1/`; its
simulator and installer are built there by the fmel-1 repository). `/mel-sim` and `/mel-install`, its earlier
addresses here, send there too. The list is `EXTERNAL_REDIRECTS` in `src/server.py` (302: where they live may change).

## Deploys From GitHub

Every push to `main` deploys (`.github/workflows/deploy.yml`, with the repository secret `FLY_API_TOKEN`, a deploy
token for `manturon` that expires on 2027-10-12: `fly tokens create deploy -a manturon -x 8760h`, then
`gh secret set FLY_API_TOKEN`). It deploys what git has: photos, music and zines stay on the `/data` volume as before.

## Basic Analytics

The site now records a small first-party analytics summary in `analytics.json` alongside the media root.

- One `visit` is counted once per browser session.
- One `play start` is counted when a visitor starts a track from the beginning or changes to another track.
- `multi-track sessions` counts sessions that played at least two different songs.

To view the summary locally or on Fly, open:

```text
/stats
```

The stats page reads from `/api/analytics/summary`.
The event collector endpoint is `/api/analytics/event`.

## Flat Movie Watchlist

`/peliculas` is a private shared watchlist for the flat: anyone with the password can add movies, say who
wants to see them, mark them as seen, remove them and pick a random one. There is one list; nothing moves to a
"watched" section. Each movie keeps `wanted_by`, the flatmates who want to see it: whoever added it, plus anyone who
pressed "yo también" (older entries without the field count as wanted by whoever added them); `not_wanted_by`, those
who pressed "yo no" (the two exclude each other); and `seen_by`, those who pressed "ya la he visto" (movies marked
watched under the old single `watched_at` count as seen by whoever wanted them). A "filtros"
panel (shut by default; shut, one line sums up what is active) narrows the list and the random pick to what any of
the ticked flatmates wants to see, none of them said "yo no" to and not all of them have seen (whoever is home that
night; nobody ticked means everyone), to a maximum runtime
picked on a slider (its last stop is no limit; a movie without a known runtime only shows then) and to any of the
ticked genres (the tags come from the movies on the list). The page uses no native menus or browser dialogs:
removing a movie asks again inside its card. It is not linked from the site
and carries `noindex`.

- Access is one shared password, `MOVIES_PASSWORD`. Logging in sets an HttpOnly cookie derived from it, so changing the
  password logs everyone out. Without it set, the whole API answers 503.
- Movie data comes from TMDB (search and details in Spanish, posters hotlinked from `image.tmdb.org`). `TMDB_API_KEY` takes
  either the v3 API key or the v4 read access token from <https://www.themoviedb.org/settings/api>. Each movie links to
  Letterboxd through `letterboxd.com/tmdb/<id>/` and to IMDb when TMDB knows the IMDb id.
- Search uses TMDB's `/search/multi`: matching titles, plus the films of up to two people whose name contains every
  word typed (accents ignored), fetched with `/person/<id>/movie_credits` — as director for people known for directing,
  as cast otherwise.
- Who added a movie is picked from a fixed list of flatmates, `NAMES` in `src/static/js/movies.js`.
- Live updates use Server-Sent Events: `GET /api/movies/events` keeps a stream open and sends `changed` whenever
  the list is saved (with a heartbeat comment every 25 s so Fly's proxy keeps it), and the page fetches the list
  again. It also refetches when a phone brings the tab back. The change signal lives in memory, which is fine with
  one machine; with several, each would only hear its own saves.
- The list can be sorted by date added, title, year, runtime or TMDB rating (`vote_average`, stored as `rating`
  when a movie is added). Movies saved before ratings existed get theirs in a background lookup the first time the
  list is read. The chosen order is remembered per browser.
- The list lives in `movies.json` under the media root (`assets/movies.json` locally, `/data/movies.json` on Fly).
- API: `POST /api/movies/login` and `/logout`, `GET /api/movies`, `GET /api/movies/events` (SSE), `GET /api/movies/search?q=`, `POST /api/movies`
  (`{tmdbId, addedBy}`), `POST /api/movies/<id>/seen` (`{name, seen}`), `POST /api/movies/<id>/wanted` (`{name, want}`: `true` "yo también", `false` "yo no", `null` neither), `DELETE /api/movies/<id>`.

Locally:

```bash
MOVIES_PASSWORD=algo TMDB_API_KEY=... python3 -m src.server
```

On Fly:

```bash
fly secrets set -a manturon MOVIES_PASSWORD='...' TMDB_API_KEY='...'
```

## Fly.io

The app is set up for deployment on Fly.io using a persistent volume at `/data`.
On Fly, photos live in `/data/photos` and music lives in `/data/music`.
The analytics file also lives on that same volume as `/data/analytics.json`, so deploys keep the counts unless you remove the volume file.

### First Deploy

1. Install `flyctl` and log in.
2. Create the app if needed:

```bash
fly apps create manturon
```

3. Create the persistent volume:

```bash
fly volumes create manturon_data_2g --region cdg --size 2 --app manturon
```

4. Deploy:

```bash
make deploy
```

If the deploy runs from CI or another non-interactive integration, use automatic confirmation:

```bash
fly deploy --yes
```

If you want to deploy another Fly app name, override `APP`:

```bash
make deploy APP=other-app
```

Otherwise Fly may stop with an error such as `yes flag must be specified when not running interactively`, especially when the app already has a mounted volume and deployment needs to confirm that setup is preserved.

If you connect the repo in the Fly UI and enable auto-deploy for `main`, subsequent code changes can deploy automatically on `push`.
That does not wipe the `/data` volume: already-uploaded photos and music remain there between deploys.
What auto-deploy does not do is copy new files from `assets/` to the remote volume, so for that you still use `make upload ...`, `make sync ...`, or `make sync-all`.

### Upload New Photos Or Music

Use one command and change `KIND=`:

```bash
make upload KIND=photos SRC=assets/photos
make upload KIND=music SRC=assets/music
make upload KIND=zines SRC=assets/zines
```

You can also upload a different directory or a specific file by changing `SRC=`.
`APP=manturon` is now the default value, so you only need it for another app.
If `KIND=photos`, optimized web copies are generated before upload and the large original files are never uploaded.

### Sync With Fly

To make the remote volume match your local folders, deleting files on Fly that no longer exist locally and uploading anything new or changed:

```bash
make sync KIND=photos SRC=assets/photos
make sync KIND=music SRC=assets/music
make sync KIND=zines SRC=assets/zines
```

Or both at once:

```bash
make sync-all
```

For photos, both `make upload` and `make sync` generate optimized web copies first. Your local originals are not touched, but smaller responsive variants are uploaded to Fly so the browser can pick a better size for the current viewport.
Photo sync now keeps a persistent local cache of those web copies under `.cache/`, so repeated syncs only regenerate photos whose source or optimization settings changed.
At the end of each real sync, the script re-reads the Fly volume and verifies that it matches the prepared local set; if it does not, the command fails.

During a photo sync, the script prints the main phases so you can see where time is going:

- refreshing the local photo cache
- reading the remote volume index
- deleting stale remote files
- uploading changed files
- verifying local prepared files vs remote volume

### Asset Flow

Photos on disk move through these stages:

```text
assets/photos originals
        |
        v
.cache/photo-sync/files
optimized web copies reused between syncs
        |
        v
/data/photos on Fly
files actually served in production
        |
        v
/api/media
list of public photo sources plus responsive `srcset` metadata
```

Zines start as PDFs outside the repo and are sliced into page images:

```text
~/Documents/zines/*.pdf
        |
        v
make prepare-zines
        |
        v
assets/zines
page images plus .zine-manifest.json
        |
        v
/data/zines on Fly
        |
        v
/api/zines
```

Music is simpler because it is not recompressed:

```text
assets/music
    |
    v
/data/music on Fly
    |
    v
/api/media
```

What `make sync KIND=photos SRC=assets/photos` does, step by step:

```text
1. Read assets/photos
2. Reuse cached prepared copies when source file + settings are unchanged
3. Regenerate only the photos that changed
4. Read /data/photos from the Fly volume
5. Delete remote files missing locally
6. Upload only new or changed prepared files
7. Read /data/photos again
8. Compare prepared local set vs remote volume
9. Exit with error if they differ
```

How to think about the local files:

```text
assets/photos
- your originals
- source of truth
- may be large

.cache/photo-sync/files
- generated automatically
- safe to delete, it will be rebuilt
- not committed to git
- used only to make syncs faster

/data/photos
- persistent Fly volume
- production copy
- should match the prepared cache after sync
```

By default:

- max long edge: `2200px`
- JPEG: quality `82`
- WebP: quality `80`

If you want to generate those copies manually to inspect them:

```bash
make prepare-web-photos SRC=assets/photos OUT=/tmp/fotos-web
```

You can also upload a specific file or folder:

```bash
make upload KIND=photos SRC=assets/photos/mi-foto.jpg
make upload KIND=music SRC=assets/music/mi-tema.flac
```

### Delete Files On Fly

Use one command and change `KIND=`:

```bash
make delete KIND=photos FILE=DSCF5123.JPG
make delete KIND=music FILE=parado-master.flac
```

### Clean Broken Photos

To inspect `assets/photos` and automatically delete the ones that cannot be loaded:

```bash
make clean-photos
```

To only check without deleting anything:

```bash
make clean-photos-dry
```

You can also pass another folder:

```bash
make clean-photos SRC=another/folder
```
