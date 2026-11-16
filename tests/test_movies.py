from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import URLError

from src import movies, server

PASSWORD = "palomitas"


def tmdb_detail_payload(tmdb_id: int = 603) -> dict[str, object]:
    return {
        "id": tmdb_id,
        "imdb_id": "tt0133093",
        "title": "Matrix",
        "original_title": "The Matrix",
        "release_date": "1999-03-30",
        "poster_path": "/matrix.jpg",
        "overview": "Un hacker descubre la verdad.",
        "runtime": 136,
        "genres": [
            {"id": 28, "name": "Acción"},
            {"id": 878, "name": "Ciencia ficción"},
        ],
        "credits": {
            "crew": [
                {"job": "Director", "name": "Lana Wachowski"},
                {"job": "Director", "name": "Lilly Wachowski"},
                {"job": "Producer", "name": "Joel Silver"},
            ]
        },
    }


class MovieApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "movies.json"
        env = mock.patch.dict(
            "os.environ", {"MOVIES_PASSWORD": PASSWORD, "TMDB_API_KEY": "k" * 32}
        )
        env.start()
        self.addCleanup(env.stop)
        self.cookie = f"{movies.COOKIE_NAME}={movies.auth_token(PASSWORD)}"

    def call(
        self,
        method: str,
        path: str,
        body: object = None,
        cookie: str | None = "default",
        secure: bool = False,
    ) -> tuple[int, dict[str, object], list[tuple[str, str]]]:
        raw = b"" if body is None else json.dumps(body).encode("utf-8")
        return movies.handle_request(
            method,
            path,
            self.cookie if cookie == "default" else cookie,
            raw,
            self.path,
            secure,
        )


class AuthTests(MovieApiTestCase):
    def test_login_sets_an_http_only_cookie(self) -> None:
        status, payload, headers = self.call(
            "POST",
            "/api/movies/login",
            {"password": PASSWORD},
            cookie=None,
            secure=True,
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload, {"ok": True})
        name, cookie = headers[0]
        self.assertEqual(name, "Set-Cookie")
        self.assertIn(f"{movies.COOKIE_NAME}={movies.auth_token(PASSWORD)}", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        self.assertIn("Secure", cookie)

    def test_wrong_password_is_rejected_after_a_delay(self) -> None:
        with mock.patch.object(movies.time, "sleep") as sleep:
            status, payload, headers = self.call(
                "POST", "/api/movies/login", {"password": "nope"}, cookie=None
            )

        self.assertEqual(status, 401)
        self.assertIn("error", payload)
        self.assertEqual(headers, [])
        sleep.assert_called_once_with(movies.FAILED_LOGIN_DELAY_SECONDS)

    def test_logout_expires_the_cookie(self) -> None:
        status, _, headers = self.call("POST", "/api/movies/logout")

        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", headers[0][1])
        self.assertNotIn("Secure", headers[0][1])

    def test_requests_without_the_cookie_are_refused(self) -> None:
        for cookie in (None, "", f"{movies.COOKIE_NAME}=wrong", "garbage;;=\x00"):
            status, payload, _ = self.call("GET", "/api/movies", cookie=cookie)
            self.assertEqual(status, 401, cookie)

    def test_changing_the_password_invalidates_old_cookies(self) -> None:
        with mock.patch.dict("os.environ", {"MOVIES_PASSWORD": "otra"}):
            status, _, _ = self.call("GET", "/api/movies")
        self.assertEqual(status, 401)

    def test_everything_is_off_without_a_configured_password(self) -> None:
        with mock.patch.dict("os.environ", {"MOVIES_PASSWORD": ""}):
            status, payload, _ = self.call(
                "POST", "/api/movies/login", {"password": ""}, cookie=None
            )
        self.assertEqual(status, 503)
        self.assertIn("MOVIES_PASSWORD", payload["error"])

    def test_cookie_value_reads_our_cookie_among_others(self) -> None:
        header = f"theme=dark; {movies.COOKIE_NAME}=abc"
        self.assertEqual(movies.cookie_value(header), "abc")
        self.assertEqual(movies.cookie_value("theme=dark"), "")


class ListTests(MovieApiTestCase):
    def add(self, tmdb_id: int = 603, added_by: str = "Antonio") -> tuple[int, dict]:
        with mock.patch.object(
            movies, "tmdb_get", return_value=tmdb_detail_payload(tmdb_id)
        ):
            status, payload, _ = self.call(
                "POST", "/api/movies", {"tmdbId": tmdb_id, "addedBy": added_by}
            )
        return status, payload

    def test_starts_empty_and_tolerates_a_broken_file(self) -> None:
        self.assertEqual(self.call("GET", "/api/movies")[1], {"movies": []})
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.call("GET", "/api/movies")[1], {"movies": []})
        self.path.write_text('{"movies": "nope"}', encoding="utf-8")
        self.assertEqual(movies.load_movies(self.path), [])

    def test_adding_stores_tmdb_details_and_who_added_it(self) -> None:
        status, payload = self.add(added_by="  Marta   G. ")

        self.assertEqual(status, 201)
        movie = payload["movie"]
        self.assertEqual(movie["title"], "Matrix")
        self.assertEqual(movie["original_title"], "The Matrix")
        self.assertEqual(movie["year"], "1999")
        self.assertEqual(movie["poster"], movies.TMDB_IMAGE_ROOT + "/matrix.jpg")
        self.assertEqual(movie["directors"], ["Lana Wachowski", "Lilly Wachowski"])
        self.assertEqual(movie["genres"], ["Acción", "Ciencia ficción"])
        self.assertEqual(movie["runtime"], 136)
        self.assertEqual(movie["imdb_id"], "tt0133093")
        self.assertEqual(movie["added_by"], "Marta G.")
        self.assertIsNone(movie["watched_at"])

        stored = self.call("GET", "/api/movies")[1]["movies"]
        self.assertEqual([item["tmdb_id"] for item in stored], [603])

    def test_adding_twice_is_a_conflict(self) -> None:
        self.add()
        status, payload = self.add()
        self.assertEqual(status, 409)

    def test_adding_needs_a_movie_and_a_name(self) -> None:
        for body in (
            {"addedBy": "Antonio"},
            {"tmdbId": True, "addedBy": "Antonio"},
            {"tmdbId": -1, "addedBy": "Antonio"},
            {"tmdbId": 603, "addedBy": "   "},
            {"tmdbId": 603},
        ):
            status, _, _ = self.call("POST", "/api/movies", body)
            self.assertEqual(status, 400, body)

    def test_bad_json_is_a_bad_request(self) -> None:
        status, _, _ = movies.handle_request(
            "POST", "/api/movies", self.cookie, b"[1]", self.path, False
        )
        self.assertEqual(status, 400)
        status, _, _ = movies.handle_request(
            "POST", "/api/movies", self.cookie, b"\xff", self.path, False
        )
        self.assertEqual(status, 400)

    def test_marking_watched_and_back(self) -> None:
        self.add()

        status, payload, _ = self.call(
            "POST", "/api/movies/603/watched", {"watched": True}
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["movie"]["watched_at"])

        status, payload, _ = self.call(
            "POST", "/api/movies/603/watched", {"watched": False}
        )
        self.assertIsNone(payload["movie"]["watched_at"])

    def test_marking_watched_validates_input(self) -> None:
        self.add()
        status, _, _ = self.call("POST", "/api/movies/603/watched", {"watched": "yes"})
        self.assertEqual(status, 400)
        status, _, _ = self.call("POST", "/api/movies/1/watched", {"watched": True})
        self.assertEqual(status, 404)

    def test_whoever_adds_a_movie_wants_to_see_it(self) -> None:
        _, payload = self.add(added_by="Antonio")
        self.assertEqual(payload["movie"]["wanted_by"], ["Antonio"])

    def test_others_can_join_and_leave(self) -> None:
        self.add(added_by="Antonio")

        status, payload, _ = self.call(
            "POST", "/api/movies/603/wanted", {"name": "Miguel", "want": True}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["movie"]["wanted_by"], ["Antonio", "Miguel"])

        # Saying yes twice doesn't list anyone twice.
        _, payload, _ = self.call(
            "POST", "/api/movies/603/wanted", {"name": "Miguel", "want": True}
        )
        self.assertEqual(payload["movie"]["wanted_by"], ["Antonio", "Miguel"])

        # null: no opinion either way.
        _, payload, _ = self.call(
            "POST", "/api/movies/603/wanted", {"name": "Antonio", "want": None}
        )
        self.assertEqual(payload["movie"]["wanted_by"], ["Miguel"])
        self.assertEqual(payload["movie"]["not_wanted_by"], [])
        stored = self.call("GET", "/api/movies")[1]["movies"][0]
        self.assertEqual(stored["wanted_by"], ["Miguel"])
        self.assertEqual(stored["added_by"], "Antonio")

    def test_saying_no_takes_you_off_the_yes_list(self) -> None:
        self.add(added_by="Antonio")

        _, payload, _ = self.call(
            "POST", "/api/movies/603/wanted", {"name": "Antonio", "want": False}
        )
        self.assertEqual(payload["movie"]["wanted_by"], [])
        self.assertEqual(payload["movie"]["not_wanted_by"], ["Antonio"])

        # Changing your mind moves you back.
        _, payload, _ = self.call(
            "POST", "/api/movies/603/wanted", {"name": "Antonio", "want": True}
        )
        self.assertEqual(payload["movie"]["wanted_by"], ["Antonio"])
        self.assertEqual(payload["movie"]["not_wanted_by"], [])

    def test_wanting_validates_input(self) -> None:
        self.add()
        for body in (
            {"want": True},
            {"name": "Miguel"},
            {"name": "Miguel", "want": 1},
            {"name": "Miguel", "want": "no"},
        ):
            status, _, _ = self.call("POST", "/api/movies/603/wanted", body)
            self.assertEqual(status, 400, body)
        status, _, _ = self.call(
            "POST", "/api/movies/1/wanted", {"name": "Miguel", "want": True}
        )
        self.assertEqual(status, 404)

    def test_older_movies_are_wanted_by_whoever_added_them(self) -> None:
        self.path.write_text(
            json.dumps(
                {"movies": [{"tmdb_id": 1, "added_by": "Javi"}, {"tmdb_id": 2}]}
            ),
            encoding="utf-8",
        )
        stored = self.call("GET", "/api/movies")[1]["movies"]
        self.assertEqual([movie["wanted_by"] for movie in stored], [["Javi"], []])
        self.assertEqual([movie["not_wanted_by"] for movie in stored], [[], []])

    def test_removing(self) -> None:
        self.add()
        self.add(tmdb_id=11)

        status, _, _ = self.call("DELETE", "/api/movies/603")
        self.assertEqual(status, 200)
        remaining = self.call("GET", "/api/movies")[1]["movies"]
        self.assertEqual([item["tmdb_id"] for item in remaining], [11])

        status, _, _ = self.call("DELETE", "/api/movies/603")
        self.assertEqual(status, 404)

    def test_unknown_routes_and_methods_are_not_found(self) -> None:
        for method, path in (
            ("GET", "/api/movies/nope"),
            ("DELETE", "/api/movies/603/watched"),
            ("GET", "/api/movies/603"),
        ):
            status, _, _ = self.call(method, path)
            self.assertEqual(status, 404, (method, path))


class TmdbTests(MovieApiTestCase):
    def test_search_maps_and_limits_movie_results(self) -> None:
        results = [
            {
                "media_type": "movie",
                "id": index,
                "title": f"Peli {index}",
                "original_title": f"Movie {index}",
                "release_date": "2001-01-01",
                "poster_path": None,
            }
            for index in range(15)
        ]
        results.insert(0, {"media_type": "movie", "title": "sin id"})
        results.insert(1, {"media_type": "tv", "id": 99, "name": "Una serie"})
        with mock.patch.object(
            movies, "tmdb_get", return_value={"results": results}
        ) as tmdb_get:
            status, payload, _ = self.call("GET", "/api/movies/search?q=peli")

        self.assertEqual(status, 200)
        found = payload["movies"]
        self.assertEqual(len(found), movies.SEARCH_RESULT_LIMIT)
        self.assertEqual(found[0]["title"], "Peli 0")
        self.assertEqual(found[0]["year"], "2001")
        self.assertEqual(found[0]["poster"], "")
        self.assertEqual(payload["people"], [])
        endpoint, params = tmdb_get.call_args.args
        self.assertEqual(endpoint, "/search/multi")
        self.assertEqual(params["query"], "peli")
        self.assertEqual(params["language"], "es-ES")

    def fake_tmdb(self, routes: dict[str, dict]) -> mock._patch:
        return mock.patch.object(
            movies, "tmdb_get", side_effect=lambda endpoint, params: routes[endpoint]
        )

    def test_search_brings_a_directors_films(self) -> None:
        routes = {
            "/search/multi": {
                "results": [
                    {
                        "media_type": "person",
                        "id": 7,
                        "name": "Pedro Almodóvar",
                        "known_for_department": "Directing",
                    },
                    {"media_type": "movie", "id": 50, "title": "Almodóvar doc"},
                ]
            },
            "/person/7/movie_credits": {
                "cast": [{"id": 90, "title": "Cameo", "popularity": 99}],
                "crew": [
                    {"id": 1, "title": "Mujeres", "job": "Director", "popularity": 5},
                    {"id": 2, "title": "Volver", "job": "Director", "popularity": 9},
                    {"id": 2, "title": "Volver", "job": "Writer", "popularity": 9},
                    {"id": 2, "title": "Volver", "job": "Director", "popularity": 9},
                    {"id": 3, "title": "Producida", "job": "Producer"},
                ],
            },
        }
        with self.fake_tmdb(routes):
            result = movies.search_movies("almodovar")

        [person] = result["people"]
        self.assertEqual(person["name"], "Pedro Almodóvar")
        self.assertEqual(person["role"], "director")
        # Directed only, most popular first, each film once.
        self.assertEqual(
            [movie["title"] for movie in person["movies"]], ["Volver", "Mujeres"]
        )
        self.assertEqual([movie["tmdb_id"] for movie in result["movies"]], [50])

    def test_search_brings_an_actors_films(self) -> None:
        routes = {
            "/search/multi": {
                "results": [
                    {
                        "media_type": "person",
                        "id": 8,
                        "name": "Penélope Cruz",
                        "known_for_department": "Acting",
                    }
                ]
            },
            "/person/8/movie_credits": {
                "cast": [
                    {"id": 1, "title": "Jamón, jamón", "popularity": "raro"},
                    {"id": 2, "title": "Volver", "popularity": 9},
                ],
                "crew": [{"id": 3, "title": "Dirigida", "job": "Director"}],
            },
        }
        with self.fake_tmdb(routes):
            [person] = movies.search_movies("penelope cruz")["people"]

        self.assertEqual(person["role"], "actor")
        self.assertEqual(
            [movie["title"] for movie in person["movies"]], ["Volver", "Jamón, jamón"]
        )

    def test_search_ignores_people_whose_name_does_not_match(self) -> None:
        routes = {
            "/search/multi": {
                "results": [
                    {"media_type": "person", "id": 1, "name": "Alguien Famoso"},
                ]
            }
        }
        with self.fake_tmdb(routes) as tmdb_get:
            result = movies.search_movies("tuno negro")
        self.assertEqual(result, {"movies": [], "people": []})
        self.assertEqual(tmdb_get.call_count, 1)

    def test_search_follows_at_most_two_people_with_films(self) -> None:
        people = [
            {"media_type": "person", "id": index, "name": f"Ana {index}"}
            for index in range(1, 5)
        ]
        routes = {"/search/multi": {"results": people}}
        routes["/person/1/movie_credits"] = {"cast": []}
        for index in range(2, 5):
            routes[f"/person/{index}/movie_credits"] = {
                "cast": [{"id": index * 10, "title": "Algo"}]
            }
        with self.fake_tmdb(routes) as tmdb_get:
            result = movies.search_movies("ana")

        self.assertEqual(
            [person["name"] for person in result["people"]], ["Ana 2", "Ana 3"]
        )
        self.assertEqual(tmdb_get.call_count, 4)

    def test_name_matching_ignores_case_and_accents(self) -> None:
        self.assertTrue(movies.name_matches("ALMODOVAR", "Pedro Almodóvar"))
        self.assertTrue(movies.name_matches("pedro almod", "Pedro Almodóvar"))
        self.assertFalse(movies.name_matches("pedro sanchez", "Pedro Almodóvar"))
        self.assertFalse(movies.name_matches("   ", "Pedro Almodóvar"))

    def test_empty_search_skips_tmdb(self) -> None:
        with mock.patch.object(movies, "tmdb_get") as tmdb_get:
            status, payload, _ = self.call("GET", "/api/movies/search?q=%20")
        self.assertEqual(payload, {"movies": [], "people": []})
        tmdb_get.assert_not_called()

    def test_search_tolerates_odd_payloads(self) -> None:
        with mock.patch.object(movies, "tmdb_get", return_value={"results": None}):
            self.assertEqual(movies.search_movies("x"), {"movies": [], "people": []})

    def test_tmdb_get_needs_a_key(self) -> None:
        with mock.patch.dict("os.environ", {"TMDB_API_KEY": ""}):
            status, payload, _ = self.call("GET", "/api/movies/search?q=x")
        self.assertEqual(status, 503)
        self.assertIn("TMDB_API_KEY", payload["error"])

    def fake_response(self, body: bytes) -> mock.MagicMock:
        response = mock.MagicMock()
        response.read.return_value = body
        response.__enter__.return_value = response
        return response

    def test_tmdb_get_uses_the_v3_key_as_a_query_parameter(self) -> None:
        with mock.patch.object(
            movies, "urlopen", return_value=self.fake_response(b'{"results": []}')
        ) as urlopen:
            movies.tmdb_get("/search/movie", {"query": "x"})

        request = urlopen.call_args.args[0]
        self.assertIn("api_key=" + "k" * 32, request.full_url)
        self.assertIsNone(request.get_header("Authorization"))

    def test_tmdb_get_sends_a_v4_token_as_bearer(self) -> None:
        with mock.patch.dict("os.environ", {"TMDB_API_KEY": "eyJtoken"}):
            with mock.patch.object(
                movies, "urlopen", return_value=self.fake_response(b"{}")
            ) as urlopen:
                movies.tmdb_get("/movie/1", {})

        request = urlopen.call_args.args[0]
        self.assertNotIn("api_key", request.full_url)
        self.assertEqual(request.get_header("Authorization"), "Bearer eyJtoken")

    def test_tmdb_failures_become_bad_gateway(self) -> None:
        for side_effect in (URLError("down"), TimeoutError()):
            with mock.patch.object(movies, "urlopen", side_effect=side_effect):
                with self.assertRaises(movies.MovieError) as caught:
                    movies.tmdb_get("/movie/1", {})
                self.assertEqual(caught.exception.status, 502)

        for body in (b"not json", b"[]"):
            with mock.patch.object(
                movies, "urlopen", return_value=self.fake_response(body)
            ):
                with self.assertRaises(movies.MovieError) as caught:
                    movies.tmdb_get("/movie/1", {})
                self.assertEqual(caught.exception.status, 502)

    def test_details_tolerate_missing_fields(self) -> None:
        with mock.patch.object(
            movies, "tmdb_get", return_value={"original_title": "Solo", "runtime": 0}
        ):
            details = movies.movie_details(5)
        self.assertEqual(details["title"], "Solo")
        self.assertEqual(details["directors"], [])
        self.assertEqual(details["genres"], [])
        self.assertIsNone(details["runtime"])
        self.assertEqual(details["year"], "")


class ServerRoutingTests(unittest.TestCase):
    def make_handler(
        self, method_path: str, headers: dict[str, str], body: bytes = b""
    ) -> server.MediaHandler:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = method_path
        handler.headers = headers
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        handler.send_error = mock.Mock()
        return handler

    def test_movies_page_is_served_and_never_cached(self) -> None:
        for path in ("/peliculas", "/peliculas/", "/peliculas.html"):
            self.assertEqual(
                server.asset_disk_path(path), server.ROOT / "peliculas.html"
            )
        self.assertTrue((server.ROOT / "peliculas.html").exists())

    def test_get_post_and_delete_reach_the_movie_api(self) -> None:
        with mock.patch.object(
            server.movies,
            "handle_request",
            return_value=(201, {"ok": True}, [("Set-Cookie", "x=1")]),
        ) as handle:
            body = b'{"password": "x"}'
            handler = self.make_handler(
                "/api/movies/login",
                {
                    "Content-Length": str(len(body)),
                    "Cookie": "a=b",
                    "X-Forwarded-Proto": "https",
                },
                body,
            )
            server.MediaHandler.do_POST(handler)
            args, kwargs = handle.call_args
            self.assertEqual(
                args, ("POST", "/api/movies/login", "a=b", body, server.MOVIES_FILE)
            )
            self.assertTrue(kwargs["secure"])
            handler.send_response.assert_called_once_with(201)
            handler.send_header.assert_any_call("Set-Cookie", "x=1")

            handler = self.make_handler("/api/movies", {})
            with mock.patch.object(server, "redirect_target", return_value=None):
                server.MediaHandler.do_GET(handler)
            self.assertEqual(handle.call_args.args[0], "GET")
            self.assertFalse(handle.call_args.kwargs["secure"])

            handler = self.make_handler("/api/movies/603", {})
            server.MediaHandler.do_DELETE(handler)
            self.assertEqual(handle.call_args.args[:2], ("DELETE", "/api/movies/603"))

    def test_request_body_tolerates_a_bad_length(self) -> None:
        handler = self.make_handler("/api/movies", {"Content-Length": "NaN"}, b"{}")
        self.assertEqual(server.MediaHandler._request_body(handler), b"")

    def test_delete_elsewhere_is_not_found(self) -> None:
        handler = self.make_handler("/api/media", {})
        server.MediaHandler.do_DELETE(handler)
        handler.send_error.assert_called_once_with(404, "Not Found")

    def test_is_movies_request_matches_only_the_api(self) -> None:
        self.assertTrue(movies.is_movies_request("/api/movies?x=1"))
        self.assertTrue(movies.is_movies_request("/api/movies/603/watched"))
        self.assertFalse(movies.is_movies_request("/api/moviesx"))
        self.assertFalse(movies.is_movies_request("/peliculas"))


if __name__ == "__main__":
    unittest.main()
