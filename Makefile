.PHONY: run test fly-upload-photos fly-upload-music

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
