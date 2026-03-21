.PHONY: run test fly-upload-photos fly-upload-music fly-delete-photo fly-delete-music fly-sync-photos fly-sync-music fly-sync-all preparar-fotos-web subir-fotos subir-musica borrar-foto borrar-musica limpiar-fotos limpiar-fotos-dry

run:
	python3 server.py

test:
	python3 -m unittest -v

fly-upload-photos:
	@test -n "$(APP)" || (echo "Usa: make fly-upload-photos APP=tu-app SRC=ruta"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make fly-upload-photos APP=tu-app SRC=ruta"; exit 1)
	bash scripts/upload-media.sh "$(APP)" photos "$(SRC)"

fly-upload-music:
	@test -n "$(APP)" || (echo "Usa: make fly-upload-music APP=tu-app SRC=ruta"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make fly-upload-music APP=tu-app SRC=ruta"; exit 1)
	bash scripts/upload-media.sh "$(APP)" music "$(SRC)"

fly-delete-photo:
	@test -n "$(APP)" || (echo "Usa: make fly-delete-photo APP=tu-app FILE=nombre.jpg"; exit 1)
	@test -n "$(FILE)" || (echo "Usa: make fly-delete-photo APP=tu-app FILE=nombre.jpg"; exit 1)
	bash scripts/delete-media.sh "$(APP)" photos "$(FILE)"

fly-delete-music:
	@test -n "$(APP)" || (echo "Usa: make fly-delete-music APP=tu-app FILE=nombre.flac"; exit 1)
	@test -n "$(FILE)" || (echo "Usa: make fly-delete-music APP=tu-app FILE=nombre.flac"; exit 1)
	bash scripts/delete-media.sh "$(APP)" music "$(FILE)"

fly-sync-photos:
	@test -n "$(APP)" || (echo "Usa: make fly-sync-photos APP=tu-app SRC=ruta"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make fly-sync-photos APP=tu-app SRC=ruta"; exit 1)
	bash scripts/sync-media.sh "$(APP)" photos "$(SRC)"

fly-sync-music:
	@test -n "$(APP)" || (echo "Usa: make fly-sync-music APP=tu-app SRC=ruta"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make fly-sync-music APP=tu-app SRC=ruta"; exit 1)
	bash scripts/sync-media.sh "$(APP)" music "$(SRC)"

fly-sync-all:
	@test -n "$(APP)" || (echo "Usa: make fly-sync-all APP=tu-app"; exit 1)
	bash scripts/sync-media.sh "$(APP)" photos assets/photos
	bash scripts/sync-media.sh "$(APP)" music assets/music

preparar-fotos-web:
	@test -n "$(SRC)" || (echo "Usa: make preparar-fotos-web SRC=carpeta-origen OUT=carpeta-destino"; exit 1)
	@test -n "$(OUT)" || (echo "Usa: make preparar-fotos-web SRC=carpeta-origen OUT=carpeta-destino"; exit 1)
	python3 scripts/prepare-web-photos.py "$(SRC)" "$(OUT)"

subir-fotos:
	bash scripts/subir-fotos.sh "$(SRC)"

subir-musica:
	bash scripts/subir-musica.sh "$(SRC)"

borrar-foto:
	@test -n "$(FILE)" || (echo "Usa: make borrar-foto FILE=nombre.jpg"; exit 1)
	bash scripts/borrar-foto.sh "$(FILE)"

borrar-musica:
	@test -n "$(FILE)" || (echo "Usa: make borrar-musica FILE=nombre.flac"; exit 1)
	bash scripts/borrar-musica.sh "$(FILE)"

limpiar-fotos:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",)

limpiar-fotos-dry:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",) --dry-run
