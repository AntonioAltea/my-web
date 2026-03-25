# Simple Personal Website

A simple music-and-photography site with a DIY feel.

## Structure

- `index.html`: main structure
- `styles.css`: visual styling
- `script.js`: automatic photo and track loading, viewer, and player
- `server.py`: Python server that lists files
- `Dockerfile`: deployment container
- `fly.toml`: Fly.io configuration
- `assets/photos/`: put your images here
- `assets/music/`: put your mp3 files here

## How To Use It

1. Copy your photos into `assets/photos/`.
2. Copy your music into `assets/music/`.
3. Start the server and the site will show them automatically.

Each photo or track title is derived from the file name:

- `granada-de-noche.jpg` will show up as `granada de noche`
- `cinta_01.mp3` will show up as `cinta 01`

## Run Locally

Start it with:

```bash
python3 server.py
```

Then open `http://127.0.0.1:8000`.

## Git hooks

The repository includes a `pre-push` hook that runs tests before each `git push`.

`make test` runs both the Python tests and the frontend behavior tests.

To enable it in your local clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

## Bandcamp

Music currently appears in a fixed bottom bar in random order, with a link to `https://manturon.bandcamp.com`.

## Fly.io

The app is set up for deployment on Fly.io using a persistent volume at `/data`.
On Fly, photos live in `/data/photos` and music lives in `/data/music`.

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
fly deploy
```

If the deploy runs from CI or another non-interactive integration, use automatic confirmation:

```bash
fly deploy --yes
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

By default:

- max long edge: `2200px`
- JPEG: quality `82`
- WebP: quality `80`

If you want to generate those copies manually to inspect them:

```bash
make preparar-fotos-web SRC=assets/photos OUT=/tmp/fotos-web
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
make limpiar-fotos
```

To only check without deleting anything:

```bash
make limpiar-fotos-dry
```

You can also pass another folder:

```bash
make limpiar-fotos SRC=otra/carpeta
```
