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

## Git hooks

El repositorio incluye un hook `pre-push` para ejecutar los tests antes de cada `git push`.

Para activarlo en tu copia local:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

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
fly volumes create manturon_data_2g --region cdg --size 2 --app manturon
```

4. Despliega:

```bash
fly deploy
```

Si conectas el repo en la UI de Fly y activas el auto-deploy para `main`, los siguientes cambios de codigo pueden desplegarse solos al hacer `push`.
Eso no borra el volumen `/data`: las fotos y la musica ya subidas siguen ahi entre deploys.
Lo que no hace el auto-deploy es copiar archivos nuevos desde `assets/` al volumen remoto, asi que para eso se sigue usando `make upload ...`, `make sync ...` o `make sync-all`.

### Subir fotos o musica nuevas

Usa un solo comando y cambia `KIND=`:

```bash
make upload KIND=photos SRC=assets/photos
make upload KIND=music SRC=assets/music
```

Tambien puedes subir una carpeta distinta o un fichero concreto cambiando `SRC=`.
`APP=manturon` es ahora el valor por defecto, asi que solo hace falta si quieres otra app.
Si `KIND=photos`, antes de subir se generan copias optimizadas para web y nunca se suben los originales gordos.

### Sincronizar con Fly

Para que el volumen remoto quede igual que tus carpetas locales, borrando en Fly lo que ya no exista en local y subiendo lo nuevo o cambiado:

```bash
make sync KIND=photos SRC=assets/photos
make sync KIND=music SRC=assets/music
```

O las dos cosas de una vez:

```bash
make sync-all
```

En el caso de las fotos, tanto `make upload` como `make sync` generan antes copias optimizadas para web. Tus originales locales no se tocan, pero a Fly suben versiones mas pequeñas para que carguen mucho mejor.

Por defecto:

- lado largo maximo: `2200px`
- JPEG: calidad `82`
- WebP: calidad `80`

Si quieres generar esas copias a mano para inspeccionarlas:

```bash
make preparar-fotos-web SRC=assets/photos OUT=/tmp/fotos-web
```

Tambien puedes subir un fichero o carpeta concreta:

```bash
make upload KIND=photos SRC=assets/photos/mi-foto.jpg
make upload KIND=music SRC=assets/music/mi-tema.flac
```

### Borrar archivos en Fly

Usa un solo comando y cambia `KIND=`:

```bash
make delete KIND=photos FILE=DSCF5123.JPG
make delete KIND=music FILE=parado-master.flac
```

### Limpiar fotos rotas

Para revisar `assets/photos` y borrar automaticamente las que no se puedan cargar:

```bash
make limpiar-fotos
```

Para solo comprobarlo sin borrar nada:

```bash
make limpiar-fotos-dry
```

Tambien puedes pasar otra carpeta:

```bash
make limpiar-fotos SRC=otra/carpeta
```
