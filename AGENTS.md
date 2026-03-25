# AGENTS.md

Guia breve para trabajar en este repo sin perder tiempo.

## Flujo de trabajo

- Primero cambiar y probar en local; desplegar solo despues.
- Si para probar algo hace falta levantar la web, pedir al usuario que ejecute `python3 server.py` o `make run`; no arrancarlo automaticamente.
- Si durante una tarea aparece una convencion o advertencia que vaya a ahorrar trabajo en el futuro, actualizar este archivo.
- Si el usuario pide commits y hay cambios logicamente separados, hacer un commit por cada bloque en vez de mezclarlo todo en uno.

## Mapa rapido

- `index.html`, `styles.css`, `script.js`: frontend sin build step.
- `server.py`: sirve la web y expone `/api/media`.
- `test_server.py`: tests del servidor.
- `Makefile`: comandos habituales.
- `scripts/prepare-web-photos.py`: optimiza fotos para web.
- `scripts/sync-media.sh`: sincroniza media con Fly; para fotos genera antes copias web.

## Cosas que importan de verdad

- En local los assets salen de `assets/`; en Fly salen de `/data`. Si un cambio toca rutas, no asumir que produccion lee del repo.
- `/api/media` devuelve las claves `photos` y `music` con rutas web. Si cambias ese contrato, ajustar tambien `script.js`.
- Si cambias comportamiento de `server.py`, añadir o actualizar tests en `test_server.py`.
- Si se añade comportamiento nuevo, intentar dejar tambien tests que lo cubran siempre que sea razonable.
- Si cambias operativa, comandos o despliegue, actualizar `README.md`.
- Si aparece un archivo local, de editor o generado que no deba versionarse, añadirlo a `.gitignore`.
- No meter build steps, frameworks ni dependencias pesadas salvo que se pida expresamente.

## Comandos utiles

- `make test`
- `make preparar-fotos-web SRC=assets/photos OUT=/tmp/fotos-web`
- `make sync-all`
- `make limpiar-fotos`
- `make limpiar-fotos-dry`

## Antes de cerrar

- Ejecutar `make test` si se tocó Python o el flujo de media.
- Si se tocó frontend o integracion cliente-servidor, indicar al usuario que lo pruebe en local levantando el server el mismo.
- Revisar `README.md` y este `AGENTS.md` si el cambio ha alterado flujos o decisiones utiles.
