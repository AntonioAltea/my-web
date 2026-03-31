# Simple Personal Website

A simple music-and-photography site with a DIY feel.

## Structure

- `src/`: app code (`index.html`, `server.py`) and frontend assets in `src/static/`
- `tests/`: Python and frontend tests
- `Dockerfile`: deployment container
- `fly.toml`: Fly.io configuration
- `assets/photos/`: put your images here
- `assets/music/`: put your mp3 files here

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

Music appears as an album-style player fixed at the bottom, with cover art, a visible track list, sequential playback order, and a link to `https://manturon.bandcamp.com`.

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
```

You can also upload a different directory or a specific file by changing `SRC=`.
`APP=manturon` is now the default value, so you only need it for another app.
If `KIND=photos`, optimized web copies are generated before upload and the large original files are never uploaded.

### Sync With Fly

To make the remote volume match your local folders, deleting files on Fly that no longer exist locally and uploading anything new or changed:

```bash
make sync KIND=photos SRC=assets/photos
make sync KIND=music SRC=assets/music
```

Or both at once:

```bash
make sync-all
```

For photos, both `make upload` and `make sync` generate optimized web copies first. Your local originals are not touched, but smaller versions are uploaded to Fly so they load much better.
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
list of public photo URLs
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
