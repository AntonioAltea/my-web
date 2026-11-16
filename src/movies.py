"""Shared movie watchlist behind /peliculas.

A small private list for the flatmates: one shared password (MOVIES_PASSWORD),
entered once and kept as an HttpOnly cookie, and movie data looked up on TMDB
(TMDB_API_KEY, either a v3 API key or a v4 read access token). The list itself
is a JSON file on the media volume, next to analytics.json.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen

COOKIE_NAME = "peliculas"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365
TMDB_API_ROOT = "https://api.themoviedb.org/3"
TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p/w342"
TMDB_LANGUAGE = "es-ES"
TMDB_TIMEOUT_SECONDS = 8
SEARCH_RESULT_LIMIT = 10
PERSON_LIMIT = 2
PERSON_MOVIE_LIMIT = 24
NAME_MAX_LENGTH = 40
FAILED_LOGIN_DELAY_SECONDS = 1.0
MOVIES_LOCK = threading.Lock()
MOVIE_ITEM_PATH = re.compile(
    r"^/api/movies/(?P<id>\d+)(?P<action>/seen|/wanted|/comment)?$"
)
COMMENT_MAX_LENGTH = 100


class MovieError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def is_movies_request(path: str) -> bool:
    request_path = urlparse(path).path
    return request_path == "/api/movies" or request_path.startswith("/api/movies/")


def configured_password() -> str:
    return os.environ.get("MOVIES_PASSWORD", "")


def configured_tmdb_key() -> str:
    return os.environ.get("TMDB_API_KEY", "").strip()


def auth_token(password: str) -> str:
    # Derived from the password, so changing MOVIES_PASSWORD logs everyone out.
    return hmac.new(
        password.encode("utf-8"), b"manturon-peliculas", hashlib.sha256
    ).hexdigest()


def cookie_value(cookie_header: str | None) -> str:
    if not cookie_header:
        return ""
    cookies = SimpleCookie()
    try:
        cookies.load(cookie_header)
    except Exception:  # noqa: BLE001 - a malformed header just means no cookie
        return ""
    morsel = cookies.get(COOKIE_NAME)
    return morsel.value if morsel else ""


def is_authorized(cookie_header: str | None) -> bool:
    password = configured_password()
    if not password:
        return False
    return hmac.compare_digest(cookie_value(cookie_header), auth_token(password))


def session_cookie(value: str, secure: bool, max_age: int = COOKIE_MAX_AGE) -> str:
    parts = [
        f"{COOKIE_NAME}={value}",
        "Path=/",
        f"Max-Age={max_age}",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_movies(path: Path) -> list[dict[str, object]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    movies = data.get("movies") if isinstance(data, dict) else None
    if not isinstance(movies, list):
        return []
    return [with_wanted_by(movie) for movie in movies if isinstance(movie, dict)]


def with_wanted_by(movie: dict[str, object]) -> dict[str, object]:
    # Movies saved before "yo también" existed only knew who added them.
    wanted_by = movie.get("wanted_by")
    if not isinstance(wanted_by, list):
        added_by = movie.get("added_by")
        movie["wanted_by"] = (
            [added_by] if isinstance(added_by, str) and added_by else []
        )
    if not isinstance(movie.get("not_wanted_by"), list):
        movie["not_wanted_by"] = []
    if not isinstance(movie.get("seen_by"), list):
        # Before "ya la he visto" a movie was watched or not, by nobody in
        # particular; the closest guess is that whoever wanted it saw it.
        movie["seen_by"] = list(movie["wanted_by"]) if movie.get("watched_at") else []
    movie.pop("watched_at", None)
    if not isinstance(movie.get("comments"), list):
        movie["comments"] = []
    return movie


def save_movies(path: Path, movies: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps({"movies": movies}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
    notify_change()


# Live updates: every save bumps a version and wakes the open event streams
# (Server-Sent Events at /api/movies/events), which tell each browser to
# fetch the list again. One machine serves the app, so memory is enough.
CHANGES = threading.Condition()
_change_version = 0


def notify_change() -> None:
    global _change_version
    with CHANGES:
        _change_version += 1
        CHANGES.notify_all()


def change_version() -> int:
    with CHANGES:
        return _change_version


def wait_for_change(version: int, timeout: float) -> int:
    """Block until the list changes past `version` or `timeout` passes."""
    with CHANGES:
        CHANGES.wait_for(lambda: _change_version != version, timeout)
        return _change_version


def tmdb_get(endpoint: str, params: dict[str, str]) -> dict[str, object]:
    key = configured_tmdb_key()
    if not key:
        raise MovieError(503, "Falta configurar TMDB_API_KEY en el servidor.")

    headers = {"Accept": "application/json"}
    query = dict(params)
    # v4 read access tokens are JWTs; v3 keys are 32 hex characters.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    else:
        query["api_key"] = key

    request = Request(f"{TMDB_API_ROOT}{endpoint}?{urlencode(query)}", headers=headers)
    try:
        with urlopen(request, timeout=TMDB_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, ValueError) as error:
        raise MovieError(502, "No se pudo consultar TMDB.") from error

    if not isinstance(payload, dict):
        raise MovieError(502, "TMDB devolvió una respuesta rara.")
    return payload


def poster_url(poster_path: object) -> str:
    if isinstance(poster_path, str) and poster_path.startswith("/"):
        return f"{TMDB_IMAGE_ROOT}{poster_path}"
    return ""


def release_year(release_date: object) -> str:
    if isinstance(release_date, str) and len(release_date) >= 4:
        return release_date[:4]
    return ""


def search_result(item: dict[str, object]) -> dict[str, object]:
    return {
        "tmdb_id": item.get("id"),
        "title": item.get("title") or item.get("original_title") or "",
        "original_title": item.get("original_title") or "",
        "year": release_year(item.get("release_date")),
        "poster": poster_url(item.get("poster_path")),
        "overview": item.get("overview") or "",
    }


def folded(text: str) -> str:
    """Lowercase without accents, so "almodovar" finds "Almodóvar"."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(
        char for char in decomposed if not unicodedata.combining(char)
    ).lower()


def name_matches(query: str, name: str) -> bool:
    # /search/multi ranks by popularity, so a famous stranger can show up for
    # any query; only follow people whose name holds every word typed.
    words = folded(query).split()
    return bool(words) and all(word in folded(name) for word in words)


def is_movie_item(item: object) -> bool:
    return isinstance(item, dict) and isinstance(item.get("id"), int)


def popularity(item: dict[str, object]) -> float:
    value = item.get("popularity")
    return float(value) if isinstance(value, (int, float)) else 0.0


def person_credits(person: dict[str, object]) -> dict[str, object] | None:
    """A person's films, as director when that is their job, else as cast."""
    payload = tmdb_get(
        f"/person/{person['id']}/movie_credits", {"language": TMDB_LANGUAGE}
    )
    directing = person.get("known_for_department") == "Directing"
    if directing:
        items = [
            item
            for item in payload.get("crew") or []
            if is_movie_item(item) and item.get("job") == "Director"
        ]
    else:
        items = [item for item in payload.get("cast") or [] if is_movie_item(item)]

    seen: set[int] = set()
    unique = []
    for item in sorted(items, key=popularity, reverse=True):
        if item["id"] not in seen:
            seen.add(item["id"])
            unique.append(search_result(item))
    if not unique:
        return None
    return {
        "name": person.get("name") or "",
        "role": "director" if directing else "actor",
        "movies": unique[:PERSON_MOVIE_LIMIT],
    }


def search_movies(query: str) -> dict[str, list[dict[str, object]]]:
    """Movies whose title matches, plus the films of matching people."""
    query = query.strip()
    if not query:
        return {"movies": [], "people": []}
    payload = tmdb_get(
        "/search/multi",
        {"query": query[:100], "language": TMDB_LANGUAGE, "include_adult": "false"},
    )
    results = payload.get("results")
    results = (
        [item for item in results if is_movie_item(item)]
        if isinstance(results, list)
        else []
    )

    movies = [
        search_result(item) for item in results if item.get("media_type") == "movie"
    ][:SEARCH_RESULT_LIMIT]
    people = []
    for item in results:
        if len(people) == PERSON_LIMIT:
            break
        if item.get("media_type") == "person" and name_matches(
            query, str(item.get("name") or "")
        ):
            credits = person_credits(item)
            if credits:
                people.append(credits)
    return {"movies": movies, "people": people}


def movie_details(tmdb_id: int) -> dict[str, object]:
    payload = tmdb_get(
        f"/movie/{tmdb_id}",
        {"language": TMDB_LANGUAGE, "append_to_response": "credits"},
    )
    credits = payload.get("credits")
    crew = credits.get("crew") if isinstance(credits, dict) else None
    directors = [
        person.get("name")
        for person in (crew if isinstance(crew, list) else [])
        if isinstance(person, dict)
        and person.get("job") == "Director"
        and isinstance(person.get("name"), str)
    ]
    genres = [
        genre.get("name")
        for genre in (payload.get("genres") or [])
        if isinstance(genre, dict) and isinstance(genre.get("name"), str)
    ]
    runtime = payload.get("runtime")
    return {
        "tmdb_id": tmdb_id,
        "imdb_id": payload.get("imdb_id") or "",
        "title": payload.get("title") or payload.get("original_title") or "",
        "original_title": payload.get("original_title") or "",
        "year": release_year(payload.get("release_date")),
        "poster": poster_url(payload.get("poster_path")),
        "overview": payload.get("overview") or "",
        "directors": directors,
        "genres": genres,
        "runtime": runtime if isinstance(runtime, int) and runtime > 0 else None,
        "rating": tmdb_rating(payload),
    }


def tmdb_rating(payload: dict[str, object]) -> float | None:
    """TMDB's average vote out of 10, or None while nobody has voted."""
    average = payload.get("vote_average")
    votes = payload.get("vote_count")
    if not isinstance(average, (int, float)) or not isinstance(votes, int) or votes < 1:
        return None
    return round(float(average), 1)


# Movies added before ratings were stored get theirs from TMDB in the
# background the first time the list is read; the save that follows tells
# every open page to refresh.
BACKFILL_LOCK = threading.Lock()


def missing_ratings(movies: list[dict[str, object]]) -> list[int]:
    return [
        movie["tmdb_id"]
        for movie in movies
        if "rating" not in movie and isinstance(movie.get("tmdb_id"), int)
    ]


def backfill_ratings(path: Path) -> None:
    if not BACKFILL_LOCK.acquire(blocking=False):
        return  # another backfill is already running
    try:
        ratings: dict[int, float | None] = {}
        for tmdb_id in missing_ratings(load_movies(path)):
            try:
                ratings[tmdb_id] = movie_details(tmdb_id)["rating"]
            except MovieError:
                continue  # try again on a later read
        if not ratings:
            return
        with MOVIES_LOCK:
            movies = load_movies(path)
            for movie in movies:
                if movie.get("tmdb_id") in ratings and "rating" not in movie:
                    movie["rating"] = ratings[movie["tmdb_id"]]
            save_movies(path, movies)
    finally:
        BACKFILL_LOCK.release()


def start_backfill(path: Path) -> None:
    threading.Thread(target=backfill_ratings, args=(path,), daemon=True).start()


def clean_name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:NAME_MAX_LENGTH]


def add_movie(path: Path, payload: dict[str, object]) -> dict[str, object]:
    tmdb_id = payload.get("tmdbId")
    if not isinstance(tmdb_id, int) or isinstance(tmdb_id, bool) or tmdb_id <= 0:
        raise MovieError(400, "Falta la película.")
    added_by = clean_name(payload.get("addedBy"))
    if not added_by:
        raise MovieError(400, "Dinos quién eres antes de añadir.")

    with MOVIES_LOCK:
        if any(movie.get("tmdb_id") == tmdb_id for movie in load_movies(path)):
            raise MovieError(409, "Esa ya está en la lista.")

    # Look it up outside the lock so a slow TMDB doesn't block the rest.
    details = movie_details(tmdb_id)

    with MOVIES_LOCK:
        movies = load_movies(path)
        if any(movie.get("tmdb_id") == tmdb_id for movie in movies):
            raise MovieError(409, "Esa ya está en la lista.")
        movie = {
            **details,
            "added_by": added_by,
            "wanted_by": [added_by],
            "not_wanted_by": [],
            "seen_by": [],
            "comments": [],
            "added_at": utc_now_iso(),
        }
        movies.append(movie)
        save_movies(path, movies)
        return movie


def set_seen(path: Path, tmdb_id: int, payload: dict[str, object]) -> dict[str, object]:
    """Mark or unmark one person as having seen a movie ("ya la he visto")."""
    name = clean_name(payload.get("name"))
    seen = payload.get("seen")
    if not name:
        raise MovieError(400, "Dinos quién eres.")
    if not isinstance(seen, bool):
        raise MovieError(400, "Falta indicar si la has visto.")
    with MOVIES_LOCK:
        movies = load_movies(path)
        for movie in movies:
            if movie.get("tmdb_id") == tmdb_id:
                others = [person for person in movie["seen_by"] if person != name]
                movie["seen_by"] = [*others, name] if seen else others
                save_movies(path, movies)
                return movie
    raise MovieError(404, "Esa película no está en la lista.")


def set_wanted(
    path: Path, tmdb_id: int, payload: dict[str, object]
) -> dict[str, object]:
    """Say whether one person wants to see a movie.

    `want` is true ("yo también"), false ("yo no", so it stays off the list
    while they are home) or null (no opinion either way).
    """
    name = clean_name(payload.get("name"))
    want = payload.get("want", "missing")
    if not name:
        raise MovieError(400, "Dinos quién eres.")
    if want is not None and not isinstance(want, bool):
        raise MovieError(400, "Falta indicar si quieres verla.")
    with MOVIES_LOCK:
        movies = load_movies(path)
        for movie in movies:
            if movie.get("tmdb_id") == tmdb_id:
                for key, wanted in (("wanted_by", True), ("not_wanted_by", False)):
                    others = [person for person in movie[key] if person != name]
                    movie[key] = [*others, name] if want is wanted else others
                save_movies(path, movies)
                return movie
    raise MovieError(404, "Esa película no está en la lista.")


def update_movie(path: Path, tmdb_id: int, change) -> dict[str, object]:
    """Apply `change` to one movie under the lock and save the list."""
    with MOVIES_LOCK:
        movies = load_movies(path)
        for movie in movies:
            if movie.get("tmdb_id") == tmdb_id:
                change(movie)
                save_movies(path, movies)
                return movie
    raise MovieError(404, "Esa película no está en la lista.")


def add_comment(
    path: Path, tmdb_id: int, payload: dict[str, object]
) -> dict[str, object]:
    """One comment per person; to write another, delete yours first."""
    name = clean_name(payload.get("name"))
    text = payload.get("text")
    if not name:
        raise MovieError(400, "Dinos quién eres.")
    if not isinstance(text, str) or not " ".join(text.split()):
        raise MovieError(400, "El comentario está vacío.")
    text = " ".join(text.split())
    if len(text) > COMMENT_MAX_LENGTH:
        raise MovieError(400, f"Máximo {COMMENT_MAX_LENGTH} caracteres.")

    def change(movie: dict[str, object]) -> None:
        if any(comment.get("name") == name for comment in movie["comments"]):
            raise MovieError(
                409, "Ya tienes un comentario; bórralo para escribir otro."
            )
        movie["comments"].append({"name": name, "text": text, "at": utc_now_iso()})

    return update_movie(path, tmdb_id, change)


def delete_comment(path: Path, tmdb_id: int, name: str) -> dict[str, object]:
    name = clean_name(name)
    if not name:
        raise MovieError(400, "Dinos quién eres.")

    def change(movie: dict[str, object]) -> None:
        kept = [comment for comment in movie["comments"] if comment.get("name") != name]
        if len(kept) == len(movie["comments"]):
            raise MovieError(404, "No tienes comentario en esta película.")
        movie["comments"] = kept

    return update_movie(path, tmdb_id, change)


def remove_movie(path: Path, tmdb_id: int) -> None:
    with MOVIES_LOCK:
        movies = load_movies(path)
        remaining = [movie for movie in movies if movie.get("tmdb_id") != tmdb_id]
        if len(remaining) == len(movies):
            raise MovieError(404, "Esa película no está en la lista.")
        save_movies(path, remaining)


def parse_json_body(body: bytes) -> dict[str, object]:
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MovieError(400, "Petición mal formada.") from error
    if not isinstance(payload, dict):
        raise MovieError(400, "Petición mal formada.")
    return payload


def handle_request(
    method: str,
    request_path: str,
    cookie_header: str | None,
    body: bytes,
    path: Path,
    secure: bool,
) -> tuple[int, dict[str, object], list[tuple[str, str]]]:
    """Answer one /api/movies request: (status, JSON payload, extra headers)."""
    parsed = urlparse(request_path)
    route = parsed.path.rstrip("/") or "/"

    try:
        if not configured_password():
            raise MovieError(503, "Falta configurar MOVIES_PASSWORD en el servidor.")

        if route == "/api/movies/login" and method == "POST":
            password = parse_json_body(body).get("password")
            if not isinstance(password, str) or not hmac.compare_digest(
                password.encode("utf-8"), configured_password().encode("utf-8")
            ):
                time.sleep(FAILED_LOGIN_DELAY_SECONDS)
                raise MovieError(401, "Contraseña incorrecta.")
            cookie = session_cookie(auth_token(configured_password()), secure)
            return 200, {"ok": True}, [("Set-Cookie", cookie)]

        if route == "/api/movies/logout" and method == "POST":
            return 200, {"ok": True}, [("Set-Cookie", session_cookie("", secure, 0))]

        if not is_authorized(cookie_header):
            raise MovieError(401, "Hace falta la contraseña.")

        if route == "/api/movies" and method == "GET":
            movies = load_movies(path)
            if missing_ratings(movies) and configured_tmdb_key():
                start_backfill(path)
            return 200, {"movies": movies}, []

        if route == "/api/movies" and method == "POST":
            return 201, {"movie": add_movie(path, parse_json_body(body))}, []

        if route == "/api/movies/search" and method == "GET":
            query = parse_qs(parsed.query).get("q", [""])[0]
            return 200, search_movies(query), []

        match = MOVIE_ITEM_PATH.match(route)
        if match:
            tmdb_id = int(match.group("id"))
            action = match.group("action")
            if action == "/comment" and method == "POST":
                movie = add_comment(path, tmdb_id, parse_json_body(body))
                return 201, {"movie": movie}, []
            if action == "/comment" and method == "DELETE":
                name = parse_qs(parsed.query).get("name", [""])[0]
                return 200, {"movie": delete_comment(path, tmdb_id, name)}, []
            if action and method == "POST":
                update = set_seen if action == "/seen" else set_wanted
                movie = update(path, tmdb_id, parse_json_body(body))
                return 200, {"movie": movie}, []
            if not action and method == "DELETE":
                remove_movie(path, tmdb_id)
                return 200, {"ok": True}, []

        raise MovieError(404, "No existe.")
    except MovieError as error:
        return error.status, {"error": error.message}, []
