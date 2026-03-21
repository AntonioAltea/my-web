# Web personal sencilla

Base sencilla para una web de musica y fotografia con aire DIY.

## Estructura

- `index.html`: estructura principal
- `styles.css`: estilo visual
- `script.js`: carga automatica de fotos y canciones, visor y reproductor
- `server.py`: servidor Python que lista los archivos
- `Dockerfile`: contenedor para despliegue
- `fly.toml`: configuracion de Fly.io
- `assets/photos/`: mete aqui tus imagenes
- `assets/music/`: mete aqui tus mp3

## Como usarla

1. Copia tus fotos dentro de `assets/photos/`.
2. Copia tu musica dentro de `assets/music/`.
3. Arranca el servidor y la web las mostrara automaticamente.

El titulo de cada foto o pista sale del nombre del fichero:

- `granada-de-noche.jpg` se vera como `granada de noche`
- `cinta_01.mp3` se vera como `cinta 01`

## Verla en local

Arrancala con:

```bash
python3 server.py
```

Y luego abre `http://127.0.0.1:8000`.

## Bandcamp

Ahora mismo la musica aparece en una barra fija inferior con orden aleatorio y enlace a `https://manturon.bandcamp.com`.

## Fly.io

La app esta preparada para desplegarse en Fly.io usando un volumen persistente en `/data`.
En Fly, las fotos iran en `/data/photos` y la musica en `/data/music`.

### Primer despliegue

1. Instala `flyctl` y haz login.
2. Crea la app si hace falta:

```bash
fly apps create manturon
```

3. Crea el volumen persistente:

```bash
fly volumes create manturon_data --region mad --size 3 --app manturon
```

4. Despliega:

```bash
fly deploy
```

### Subir fotos o musica nuevas

Fotos:

```bash
make fly-upload-photos APP=manturon SRC=assets/photos
```

Musica:

```bash
make fly-upload-music APP=manturon SRC=assets/music
```

Tambien puedes subir una carpeta distinta o un fichero concreto cambiando `SRC=`.
