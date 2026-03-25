.PHONY: run test upload delete sync sync-all preparar-fotos-web limpiar-fotos limpiar-fotos-dry

APP ?= manturon

run:
	python3 server.py

test:
	python3 -m unittest -v

upload:
	@test -n "$(KIND)" || (echo "Usa: make upload KIND=photos|music SRC=ruta [APP=manturon]"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make upload KIND=photos|music SRC=ruta [APP=manturon]"; exit 1)
	bash scripts/upload-media.sh "$(APP)" "$(KIND)" "$(SRC)"

delete:
	@test -n "$(KIND)" || (echo "Usa: make delete KIND=photos|music FILE=nombre [APP=manturon]"; exit 1)
	@test -n "$(FILE)" || (echo "Usa: make delete KIND=photos|music FILE=nombre [APP=manturon]"; exit 1)
	bash scripts/delete-media.sh "$(APP)" "$(KIND)" "$(FILE)"

sync:
	@test -n "$(KIND)" || (echo "Usa: make sync KIND=photos|music SRC=ruta [APP=manturon]"; exit 1)
	@test -n "$(SRC)" || (echo "Usa: make sync KIND=photos|music SRC=ruta [APP=manturon]"; exit 1)
	bash scripts/sync-media.sh "$(APP)" "$(KIND)" "$(SRC)"

sync-all:
	bash scripts/sync-media.sh "$(APP)" photos assets/photos
	bash scripts/sync-media.sh "$(APP)" music assets/music

preparar-fotos-web:
	@test -n "$(SRC)" || (echo "Usa: make preparar-fotos-web SRC=carpeta-origen OUT=carpeta-destino"; exit 1)
	@test -n "$(OUT)" || (echo "Usa: make preparar-fotos-web SRC=carpeta-origen OUT=carpeta-destino"; exit 1)
	python3 scripts/prepare-web-photos.py "$(SRC)" "$(OUT)"

limpiar-fotos:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",)

limpiar-fotos-dry:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",) --dry-run
