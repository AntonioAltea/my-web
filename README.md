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

The music section lists the same albums as cards; clicking one loads it in the footer player instead of opening a new page. Below them are plain links to Bandcamp and YouTube, deliberately kept small so the records stay the focus.

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

The reader opens a zine like a booklet: the cover alone, then pages 2-3, 4-5 and 6-7 as spreads, then the back cover. That matters because these zines often carry one photo drawn across two panels, and those panels are exactly the ones that end up facing each other. Turning a page swings the sheet you are leaving about the spine. Arrow keys work too.

A toggle switches between one page and a spread and remembers your choice; a spread is the default on any screen size. Each zine also offers its PDF for download, so anyone can print and fold their own copy.

If you change how the sheet is sliced, bump `PREPARE_VERSION` in `scripts/zine_prepare.py`; page URLs are cached as immutable and are versioned from that number plus the source PDF.

## Unlisted Pages

Each folder `src/hidden/<name>/` is served at `/<name>/` and linked from nowhere on the site: only whoever has the
address gets there. They carry `noindex` (meta tag and `X-Robots-Tag`), and `/hidden/...` does not reach them. This
repository is public, so the names are visible here: unlisted, not secret.

The MEL simulator and installer for the M-VAVE FM-1 (from `~/dinghy`) live at `/mel-sim/` and `/mel-install/`. After
building MEL there (`web/emu/build.sh` and `./build.sh`), publish it again with:

```bash
make publish-mel                    # MEL_SRC=~/dinghy
```

They take the site's look from `src/static/css/mel.css` (added to their `<head>` from `scripts/mel-head.html`).

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
