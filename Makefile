.PHONY: run test test-python test-front upload delete sync sync-all preparar-fotos-web limpiar-fotos limpiar-fotos-dry

APP ?= manturon

run:
	python3 server.py

test: test-python test-front

test-python:
	python3 -m unittest -v

test-front:
	node test_script.js

upload:
	@test -n "$(KIND)" || (echo "Usage: make upload KIND=photos|music SRC=path [APP=manturon]"; exit 1)
	@test -n "$(SRC)" || (echo "Usage: make upload KIND=photos|music SRC=path [APP=manturon]"; exit 1)
	bash scripts/upload-media.sh "$(APP)" "$(KIND)" "$(SRC)"

delete:
	@test -n "$(KIND)" || (echo "Usage: make delete KIND=photos|music FILE=name [APP=manturon]"; exit 1)
	@test -n "$(FILE)" || (echo "Usage: make delete KIND=photos|music FILE=name [APP=manturon]"; exit 1)
	bash scripts/delete-media.sh "$(APP)" "$(KIND)" "$(FILE)"

sync:
	@test -n "$(KIND)" || (echo "Usage: make sync KIND=photos|music SRC=path [APP=manturon]"; exit 1)
	@test -n "$(SRC)" || (echo "Usage: make sync KIND=photos|music SRC=path [APP=manturon]"; exit 1)
	bash scripts/sync-media.sh "$(APP)" "$(KIND)" "$(SRC)"

sync-all:
	bash scripts/sync-media.sh "$(APP)" photos assets/photos
	bash scripts/sync-media.sh "$(APP)" music assets/music

preparar-fotos-web:
	@test -n "$(SRC)" || (echo "Usage: make preparar-fotos-web SRC=source-folder OUT=target-folder"; exit 1)
	@test -n "$(OUT)" || (echo "Usage: make preparar-fotos-web SRC=source-folder OUT=target-folder"; exit 1)
	python3 scripts/prepare-web-photos.py "$(SRC)" "$(OUT)"

limpiar-fotos:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",)

limpiar-fotos-dry:
	python3 scripts/clean-broken-photos.py $(if $(SRC),"$(SRC)",) --dry-run
