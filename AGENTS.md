# AGENTS.md

Short guide to work in this repo without wasting time.

## Workflow

- Change and test locally first; deploy afterwards.
- If testing requires running the site, ask the user to run `python3 server.py` or `make run`; do not start it automatically.
- If a task reveals a convention or warning that will save time later, update this file.
- If the user asks for commits and there are logically separate changes, make one commit per block instead of mixing everything together.
- Respond concisely by default; do not be verbose unless the user asks for more detail.

## Quick Map

- `index.html`, `styles.css`, `script.js`: frontend without a build step.
- `server.py`: serves the site and exposes `/api/media`.
- `test_server.py`: server tests.
- `test_script.js`: frontend behavior tests without external dependencies.
- `Makefile`: common commands.
- `scripts/prepare-web-photos.py`: optimizes photos for the web.
- `scripts/sync-media.sh`: syncs media with Fly; for photos it generates web copies first.

## Things That Actually Matter

- Locally, assets come from `assets/`; on Fly, they come from `/data`. If a change touches paths, do not assume production reads from the repo.
- `/api/media` returns the `photos` and `music` keys with web paths. If you change that contract, update `script.js` too.
- If you change `server.py` behavior, add or update tests in `test_server.py`.
- Keep Python test coverage high; if it drops, bring it back up with useful tests before closing the task.
- If new behavior is added, try to leave tests covering it whenever reasonable.
- If the change touches `script.js` or relevant client interactions, consider adding or updating tests in `test_script.js` whenever reasonable.
- If you change operations, commands, or deployment, update `README.md`.
- If a local, editor, or generated file appears and should not be versioned, add it to `.gitignore`.
- Do not add build steps, frameworks, or heavy dependencies unless explicitly requested.
- If the app is connected to the repo in the Fly UI, auto-deploy updates code on each `push` to `main`, but it does not upload new photos or music to the `/data` volume.

## Useful Commands

- `make test`
- `make test-front`
- `make preparar-fotos-web SRC=assets/photos OUT=/tmp/fotos-web`
- `make sync-all`
- `make limpiar-fotos`
- `make limpiar-fotos-dry`

## Before Closing

- Run `make test` if Python or the media flow changed.
- Remember that the `pre-push` hook runs `make test`, so backend and frontend tests must be green before pushing.
- If frontend or client-server integration changed, tell the user to test it locally by starting the server themselves.
- Review `README.md` and this `AGENTS.md` if the change altered useful flows or decisions.
