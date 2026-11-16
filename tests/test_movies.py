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
        self.assertEqual(movie["seen_by"], [])

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

    def test_each_person_marks_it_seen_and_back(self) -> None:
        self.add()

        for name in ("Antonio", "Miguel", "Antonio"):
            status, payload, _ = self.call(
                "POST", "/api/movies/603/seen", {"name": name, "seen": True}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["movie"]["seen_by"], ["Miguel", "Antonio"])

        _, payload, _ = self.call(
            "POST", "/api/movies/603/seen", {"name": "Miguel", "seen": False}
        )
        self.assertEqual(payload["movie"]["seen_by"], ["Antonio"])

    def test_marking_seen_validates_input(self) -> None:
        self.add()
        for body in ({"name": "Antonio", "seen": "yes"}, {"seen": True}):
            status, _, _ = self.call("POST", "/api/movies/603/seen", body)
            self.assertEqual(status, 400, body)
        status, _, _ = self.call(
            "POST", "/api/movies/1/seen", {"name": "Antonio", "seen": True}
        )
        self.assertEqual(status, 404)

    def test_movies_watched_before_count_as_seen_by_who_wanted_them(self) -> None:
        self.path.write_text(
            json.dumps(
                {
                    "movies": [
                        {
                            "tmdb_id": 1,
                            "wanted_by": ["Javi", "Jorge"],
                            "watched_at": "x",
                        },
                        {"tmdb_id": 2, "wanted_by": ["Javi"], "watched_at": None},
                    ]
                }
            ),
            encoding="utf-8",
        )
        stored = self.call("GET", "/api/movies")[1]["movies"]
        self.assertEqual([m["seen_by"] for m in stored], [["Javi", "Jorge"], []])
        self.assertTrue(all("watched_at" not in m for m in stored))

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
            ("DELETE", "/api/movies/603/seen"),
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
        self.assertTrue(movies.is_movies_request("/api/movies/603/seen"))
        self.assertFalse(movies.is_movies_request("/api/moviesx"))
        self.assertFalse(movies.is_movies_request("/peliculas"))


if __name__ == "__main__":
    unittest.main()


class RatingTests(MovieApiTestCase):
    def test_details_keep_tmdbs_rating(self) -> None:
        payload = {**tmdb_detail_payload(), "vote_average": 8.234, "vote_count": 25000}
        with mock.patch.object(movies, "tmdb_get", return_value=payload):
            self.assertEqual(movies.movie_details(603)["rating"], 8.2)

    def test_no_votes_means_no_rating(self) -> None:
        self.assertIsNone(movies.tmdb_rating({"vote_average": 0, "vote_count": 0}))
        self.assertIsNone(movies.tmdb_rating({"vote_average": "7", "vote_count": 3}))
        self.assertIsNone(movies.tmdb_rating({}))

    def write(self, items: list[dict]) -> None:
        self.path.write_text(json.dumps({"movies": items}), encoding="utf-8")

    def test_reading_the_list_backfills_missing_ratings(self) -> None:
        self.write([{"tmdb_id": 1, "rating": 7.0}, {"tmdb_id": 2}])
        with mock.patch.object(movies, "start_backfill") as start:
            status, _, _ = self.call("GET", "/api/movies")
        self.assertEqual(status, 200)
        start.assert_called_once_with(self.path)

        self.write([{"tmdb_id": 1, "rating": None}])
        with mock.patch.object(movies, "start_backfill") as start:
            self.call("GET", "/api/movies")
        start.assert_not_called()

    def test_backfill_stores_ratings_and_retries_failures_later(self) -> None:
        self.write([{"tmdb_id": 1, "rating": 7.0}, {"tmdb_id": 2}, {"tmdb_id": 3}])

        def details(tmdb_id: int) -> dict:
            if tmdb_id == 3:
                raise movies.MovieError(502, "down")
            return {"rating": 6.5}

        with mock.patch.object(movies, "movie_details", side_effect=details) as lookup:
            movies.backfill_ratings(self.path)
        self.assertEqual([call.args[0] for call in lookup.call_args_list], [2, 3])
        stored = {m["tmdb_id"]: m for m in movies.load_movies(self.path)}
        self.assertEqual(stored[1]["rating"], 7.0)
        self.assertEqual(stored[2]["rating"], 6.5)
        self.assertNotIn("rating", stored[3])

    def test_backfill_does_nothing_when_everything_fails_or_one_is_running(
        self,
    ) -> None:
        self.write([{"tmdb_id": 3}])
        before = self.path.read_text(encoding="utf-8")
        with mock.patch.object(
            movies, "movie_details", side_effect=movies.MovieError(502, "down")
        ):
            movies.backfill_ratings(self.path)
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)

        with movies.BACKFILL_LOCK:
            with mock.patch.object(movies, "movie_details") as lookup:
                movies.backfill_ratings(self.path)
        lookup.assert_not_called()

    def test_start_backfill_runs_in_a_thread(self) -> None:
        with mock.patch.object(movies.threading, "Thread") as thread:
            movies.start_backfill(self.path)
        thread.assert_called_once_with(
            target=movies.backfill_ratings, args=(self.path,), daemon=True
        )
        thread.return_value.start.assert_called_once_with()


class ChangeNotificationTests(MovieApiTestCase):
    def test_saving_bumps_the_version(self) -> None:
        before = movies.change_version()
        movies.save_movies(self.path, [])
        self.assertEqual(movies.change_version(), before + 1)

    def test_waiting_returns_on_change_or_timeout(self) -> None:
        version = movies.change_version()
        self.assertEqual(movies.wait_for_change(version, 0.01), version)
        movies.notify_change()
        self.assertEqual(movies.wait_for_change(version, 5), version + 1)


class MovieEventStreamTests(unittest.TestCase):
    def make_handler(self, cookie: str | None) -> server.MediaHandler:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/movies/events"
        handler.headers = {"Cookie": cookie} if cookie else {}
        handler.wfile = io.BytesIO()
        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        return handler

    def setUp(self) -> None:
        env = mock.patch.dict("os.environ", {"MOVIES_PASSWORD": PASSWORD})
        env.start()
        self.addCleanup(env.stop)
        self.cookie = f"{movies.COOKIE_NAME}={movies.auth_token(PASSWORD)}"

    def test_refuses_without_the_password(self) -> None:
        handler = self.make_handler(None)
        with mock.patch.object(server, "redirect_target", return_value=None):
            server.MediaHandler.do_GET(handler)
        handler.send_response.assert_called_once_with(401)

    def test_sends_changes_and_heartbeats_until_the_page_leaves(self) -> None:
        handler = self.make_handler(self.cookie)
        # A change, then a quiet heartbeat period, then the browser is gone.
        waits = iter([7, 7])
        writes = []

        def write(data: bytes) -> None:
            writes.append(data)
            if len(writes) == 3:
                raise BrokenPipeError

        handler.wfile = mock.Mock(write=write)
        with (
            mock.patch.object(server.movies, "change_version", return_value=6),
            mock.patch.object(
                server.movies, "wait_for_change", side_effect=lambda v, t: next(waits)
            ),
            mock.patch.object(server, "redirect_target", return_value=None),
        ):
            server.MediaHandler.do_GET(handler)

        handler.send_response.assert_called_once_with(200)
        handler.send_header.assert_any_call(
            "Content-Type", "text/event-stream; charset=utf-8"
        )
        self.assertEqual(
            writes,
            [b"retry: 3000\n\n", b"event: changed\ndata: 7\n\n", b": ping\n\n"],
        )


class CommentTests(MovieApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        with mock.patch.object(
            movies, "tmdb_get", return_value=tmdb_detail_payload(603)
        ):
            self.call("POST", "/api/movies", {"tmdbId": 603, "addedBy": "Antonio"})

    def comment(self, name: str, text: object) -> tuple[int, dict]:
        status, payload, _ = self.call(
            "POST", "/api/movies/603/comment", {"name": name, "text": text}
        )
        return status, payload

    def test_new_movies_start_without_comments(self) -> None:
        stored = self.call("GET", "/api/movies")[1]["movies"][0]
        self.assertEqual(stored["comments"], [])

    def test_one_comment_per_person(self) -> None:
        status, payload = self.comment("Antonio", "  muy   buena\n")
        self.assertEqual(status, 201)
        [comment] = payload["movie"]["comments"]
        self.assertEqual((comment["name"], comment["text"]), ("Antonio", "muy buena"))
        self.assertTrue(comment["at"])

        status, payload = self.comment("Antonio", "otra")
        self.assertEqual(status, 409)
        self.assertIn("bórralo", payload["error"])

        status, payload = self.comment("Miguel", "flojita")
        self.assertEqual(
            [c["name"] for c in payload["movie"]["comments"]], ["Antonio", "Miguel"]
        )

    def test_deleting_lets_you_write_again(self) -> None:
        self.comment("Antonio", "primera")
        self.comment("Miguel", "la de Miguel")

        status, payload, _ = self.call("DELETE", "/api/movies/603/comment?name=Antonio")
        self.assertEqual(status, 200)
        self.assertEqual([c["name"] for c in payload["movie"]["comments"]], ["Miguel"])

        status, payload = self.comment("Antonio", "segunda")
        self.assertEqual(status, 201)
        self.assertEqual(payload["movie"]["comments"][-1]["text"], "segunda")

    def test_comment_validation(self) -> None:
        for name, text in (
            ("", "hola"),
            ("Antonio", ""),
            ("Antonio", "   "),
            ("Antonio", 5),
            ("Antonio", "x" * (movies.COMMENT_MAX_LENGTH + 1)),
        ):
            status, _ = self.comment(name, text)
            self.assertEqual(status, 400, (name, text))
        status, _ = self.comment("Antonio", "x" * movies.COMMENT_MAX_LENGTH)
        self.assertEqual(status, 201)

        status, _, _ = self.call(
            "POST", "/api/movies/1/comment", {"name": "Antonio", "text": "hola"}
        )
        self.assertEqual(status, 404)

    def test_delete_validation(self) -> None:
        status, _, _ = self.call("DELETE", "/api/movies/603/comment")
        self.assertEqual(status, 400)
        status, _, _ = self.call("DELETE", "/api/movies/603/comment?name=Javi")
        self.assertEqual(status, 404)
        status, _, _ = self.call("DELETE", "/api/movies/1/comment?name=Javi")
        self.assertEqual(status, 404)

    def test_older_movies_get_an_empty_list(self) -> None:
        self.path.write_text(json.dumps({"movies": [{"tmdb_id": 9}]}), encoding="utf-8")
        stored = self.call("GET", "/api/movies")[1]["movies"][0]
        self.assertEqual(stored["comments"], [])


class SpellingTests(MovieApiTestCase):
    MATCH = {"results": [{"media_type": "movie", "id": 872585, "title": "Oppenheimer"}]}

    def test_typos_are_corrected_through_wikipedia(self) -> None:
        def tmdb(endpoint, params):
            return self.MATCH if params["query"] == "oppenheimer" else {"results": []}

        with (
            mock.patch.object(movies, "tmdb_get", side_effect=tmdb),
            mock.patch.object(
                movies, "spelling_suggestion", return_value="oppenheimer"
            ) as suggest,
        ):
            status, payload, _ = self.call("GET", "/api/movies/search?q=oppenhaimer")

        self.assertEqual(status, 200)
        suggest.assert_called_once_with("oppenhaimer")
        self.assertEqual(payload["corrected"], "oppenheimer")
        self.assertEqual([m["title"] for m in payload["movies"]], ["Oppenheimer"])

    def test_no_correction_when_tmdb_already_finds_it(self) -> None:
        with (
            mock.patch.object(movies, "tmdb_get", return_value=self.MATCH),
            mock.patch.object(movies, "spelling_suggestion") as suggest,
        ):
            result = movies.search_movies("oppenheimer")
        suggest.assert_not_called()
        self.assertNotIn("corrected", result)

    def test_nothing_either_way_stays_empty(self) -> None:
        empty = {"results": []}
        for suggestion in ("", "otra cosa"):
            with (
                mock.patch.object(movies, "tmdb_get", return_value=empty),
                mock.patch.object(
                    movies, "spelling_suggestion", return_value=suggestion
                ),
            ):
                result = movies.search_movies("xqzt")
            self.assertEqual(result, {"movies": [], "people": []})

    def fake_wikipedia(self, body: bytes) -> mock.MagicMock:
        response = mock.MagicMock()
        response.read.return_value = body
        response.__enter__.return_value = response
        return response

    def test_reads_wikipedias_suggestion(self) -> None:
        body = b'{"query": {"searchinfo": {"suggestion": "oppenheimer"}, "search": []}}'
        with mock.patch.object(
            movies, "urlopen", return_value=self.fake_wikipedia(body)
        ) as urlopen:
            self.assertEqual(movies.spelling_suggestion("oppenhaimer"), "oppenheimer")
        request = urlopen.call_args.args[0]
        self.assertIn("srsearch=oppenhaimer", request.full_url)
        self.assertIn("srinfo=suggestion", request.full_url)
        self.assertEqual(request.get_header("User-agent"), movies.WIKIPEDIA_USER_AGENT)

    def test_no_suggestion_or_wikipedia_down(self) -> None:
        cases = [
            self.fake_wikipedia(b'{"query": {"searchinfo": {}, "search": []}}'),
            self.fake_wikipedia(
                b'{"query": {"searchinfo": {"suggestion": "Oppenhaimer"}}}'
            ),
            self.fake_wikipedia(b"[]"),
            self.fake_wikipedia(b"not json"),
        ]
        for response in cases:
            with mock.patch.object(movies, "urlopen", return_value=response):
                self.assertEqual(movies.spelling_suggestion("oppenhaimer"), "")
        with mock.patch.object(movies, "urlopen", side_effect=URLError("down")):
            self.assertEqual(movies.spelling_suggestion("oppenhaimer"), "")
