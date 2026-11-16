(function (global) {
  const NAMES = ["Antonio", "Javi", "Jorge", "Miguel"];
  const NAME_STORAGE_KEY = "manturon-peliculas-name";
  const SEARCH_DELAY_MS = 350;

  // Pure helpers, exposed for the tests.

  function isWatched(movie) {
    return Boolean(movie.watched_at);
  }

  function filterMovies(movies, { status = "pending", people = [] } = {}) {
    return movies.filter((movie) => {
      if (status === "pending" && isWatched(movie)) return false;
      if (status === "watched" && !isWatched(movie)) return false;
      if (people.length && !people.includes(movie.added_by)) return false;
      return true;
    });
  }

  function sortMovies(movies, status) {
    const key = status === "watched" ? "watched_at" : "added_at";
    // Pending: oldest first, so nothing sinks forever. Watched: latest first.
    const direction = status === "watched" ? -1 : 1;
    return [...movies].sort(
      (a, b) => direction * String(a[key] || "").localeCompare(String(b[key] || "")),
    );
  }

  function pickRandom(movies, { people = [], exclude = null, random = Math.random } = {}) {
    let pool = filterMovies(movies, { status: "pending", people });
    if (pool.length > 1 && exclude != null) {
      pool = pool.filter((movie) => movie.tmdb_id !== exclude);
    }
    if (!pool.length) return null;
    return pool[Math.floor(random() * pool.length)];
  }

  function formatRuntime(minutes) {
    if (!minutes) return "";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    // Non-breaking spaces so "1 h 28 min" never splits across lines.
    if (!hours) return `${rest} min`;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function movieMeta(movie) {
    const parts = [];
    if (movie.year) parts.push(movie.year);
    const runtime = formatRuntime(movie.runtime);
    if (runtime) parts.push(runtime);
    return parts.join(" · ");
  }

  function letterboxdUrl(movie) {
    return `https://letterboxd.com/tmdb/${movie.tmdb_id}/`;
  }

  function imdbUrl(movie) {
    return movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}/` : "";
  }

  // People first: when you type a name you want their films, and titles that
  // merely contain the name are usually noise.
  function searchGroups(data) {
    const groups = (data.people || []).map((person) => ({
      title: person.role === "director" ? `dirigidas por ${person.name}` : `con ${person.name}`,
      movies: person.movies || [],
    }));
    groups.push({ title: "películas", movies: data.movies || [] });
    return groups.filter((group) => group.movies.length);
  }

  global.ManturonMovies = {
    NAMES,
    filterMovies,
    sortMovies,
    pickRandom,
    formatRuntime,
    movieMeta,
    letterboxdUrl,
    imdbUrl,
    searchGroups,
  };

  const document = global.document;
  if (!document || !document.querySelector("#movies-app")) {
    return;
  }

  // Page wiring.

  const $ = (selector) => document.querySelector(selector);
  const pageStatus = $("#movies-page-status");
  const loginForm = $("#movies-login");
  const loginError = $("#movies-login-error");
  const logoutButton = $("#movies-logout");
  const app = $("#movies-app");
  const whoOptions = $("#movies-who-options");
  const nameHint = $("#movies-name-hint");
  const queryInput = $("#movies-query");
  const searchStatus = $("#movies-search-status");
  const results = $("#movies-results");
  const byOptions = $("#movies-by");
  const statusButtons = [...document.querySelectorAll(".movies-tabs button")];
  const randomButton = $("#movies-random");
  const pickSection = $("#movies-pick");
  const pickCard = $("#movies-pick-card");
  const listStatus = $("#movies-list-status");
  const list = $("#movies-list");

  const state = {
    name: "",
    movies: [],
    status: "pending",
    people: [],
    picked: null,
    searchTimer: null,
    searchSeq: 0,
    lastSearch: null,
  };

  function setMessage(node, text) {
    node.textContent = text;
    node.hidden = !text;
  }

  function storedName() {
    try {
      const name = global.localStorage.getItem(NAME_STORAGE_KEY) || "";
      return NAMES.includes(name) ? name : "";
    } catch {
      return "";
    }
  }

  function storeName(name) {
    try {
      global.localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
      // Without storage the choice just lasts this visit.
    }
    state.name = name;
  }

  async function api(method, url, body) {
    const options = { method, headers: {}, cache: "no-store", credentials: "same-origin" };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new Error("no hay conexión con el servidor");
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (response.status === 401 && !url.endsWith("/login")) {
      showLogin();
    }
    if (!response.ok) {
      const error = new Error(data.error || "algo ha fallado");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  }

  function poster(movie, className) {
    if (!movie.poster) {
      return el("div", { className: `${className} movies-poster-empty`, ariaHidden: "true" });
    }
    return el("img", { className, src: movie.poster, alt: "", loading: "lazy", decoding: "async" });
  }

  function showLogin() {
    app.hidden = true;
    logoutButton.hidden = true;
    loginForm.hidden = false;
    $("#movies-password").focus();
  }

  function showApp() {
    setMessage(pageStatus, "");
    loginForm.hidden = true;
    logoutButton.hidden = false;
    app.hidden = false;
  }

  function renderWho() {
    whoOptions.replaceChildren(
      ...NAMES.map((name) =>
        el("button", {
          type: "button",
          textContent: name,
          ariaPressed: String(state.name === name),
          onclick: () => {
            storeName(name);
            setMessage(nameHint, "");
            renderWho();
          },
        }),
      ),
    );
  }

  function renderToolbar() {
    // Tick whoever is home tonight; nobody ticked means everyone.
    const toggle = (name) => {
      state.people = state.people.includes(name)
        ? state.people.filter((person) => person !== name)
        : [...state.people, name];
      state.picked = null;
      renderList();
    };
    byOptions.replaceChildren(
      el("button", {
        type: "button",
        textContent: "todos",
        ariaPressed: String(!state.people.length),
        onclick: () => {
          state.people = [];
          state.picked = null;
          renderList();
        },
      }),
      ...NAMES.map((name) =>
        el("button", {
          type: "button",
          textContent: name,
          ariaPressed: String(state.people.includes(name)),
          onclick: () => toggle(name),
        }),
      ),
    );
    for (const button of statusButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.status === state.status));
    }
    const theirs = filterMovies(state.movies, { status: "all", people: state.people });
    $("#movies-count-pending").textContent = filterMovies(theirs, { status: "pending" }).length;
    $("#movies-count-watched").textContent = filterMovies(theirs, { status: "watched" }).length;
    randomButton.disabled = !pickRandom(state.movies, { people: state.people });
  }

  function linkList(movie) {
    return el("p", { className: "movies-links" }, [
      el("a", { href: letterboxdUrl(movie), textContent: "Letterboxd", rel: "noopener", target: "_blank" }),
      imdbUrl(movie)
        ? el("a", { href: imdbUrl(movie), textContent: "IMDb", rel: "noopener", target: "_blank" })
        : null,
    ]);
  }

  function addedLine(movie) {
    if (!movie.watched_at) return `la añadió ${movie.added_by}`;
    const date = new Date(movie.watched_at).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `la añadió ${movie.added_by} · vista el ${date}`;
  }

  function movieCard(movie, { pick = false } = {}) {
    const watched = isWatched(movie);
    const original = movie.original_title && movie.original_title !== movie.title
      ? el("p", { className: "movies-original", textContent: movie.original_title })
      : null;
    const overview = movie.overview
      ? pick
        ? el("p", { className: "movies-overview", textContent: movie.overview })
        : el("details", { className: "movies-details" }, [
            el("summary", { textContent: "sinopsis" }),
            el("p", { className: "movies-overview", textContent: movie.overview }),
          ])
      : null;

    const body = el("div", { className: "movies-card-body" }, [
      el("h3", { textContent: movie.title }),
      original,
      movie.directors && movie.directors.length
        ? el("p", { className: "movies-director", textContent: movie.directors.join(", ") })
        : null,
      el("p", { className: "movies-meta", textContent: movieMeta(movie) }),
      movie.genres && movie.genres.length
        ? el("p", { className: "movies-genres", textContent: movie.genres.join(", ") })
        : null,
      overview,
      el("p", { className: "movies-added", textContent: addedLine(movie) }),
      linkList(movie),
    ]);

    if (!pick) {
      body.append(
        el("div", { className: "movies-actions" }, [
          el("button", {
            type: "button",
            textContent: watched ? "desmarcar vista" : "ya la vimos",
            onclick: () => toggleWatched(movie, !watched),
          }),
          el("button", {
            type: "button",
            className: "movies-link movies-remove",
            textContent: "quitar",
            onclick: () => removeMovie(movie),
          }),
        ]),
      );
    }

    return el("article", { className: pick ? "movies-card movies-card-pick" : "movies-card" }, [
      poster(movie, "movies-poster"),
      body,
    ]);
  }

  function renderList() {
    renderToolbar();
    const visible = sortMovies(
      filterMovies(state.movies, { status: state.status, people: state.people }),
      state.status,
    );
    list.replaceChildren(...visible.map((movie) => el("li", {}, [movieCard(movie)])));
    let empty = "";
    if (!visible.length) {
      empty = state.status === "pending"
        ? "No hay nada pendiente. Busca una película arriba y añádela."
        : "Todavía no habéis marcado ninguna como vista.";
    }
    setMessage(listStatus, empty);
    renderPick();
    if (state.lastSearch) renderResults(state.lastSearch);
  }

  function renderPick() {
    const current = state.picked && state.movies.find((movie) => movie.tmdb_id === state.picked);
    if (!current || isWatched(current)) {
      state.picked = null;
      pickSection.hidden = true;
      return;
    }
    pickCard.replaceChildren(movieCard(current, { pick: true }));
    pickSection.hidden = false;
  }

  function choose() {
    const movie = pickRandom(state.movies, { people: state.people, exclude: state.picked });
    state.picked = movie ? movie.tmdb_id : null;
    renderPick();
    if (movie) pickSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function loadMovies() {
    try {
      const data = await api("GET", "/api/movies");
      state.movies = data.movies || [];
      showApp();
      renderWho();
      renderList();
    } catch (error) {
      if (error.status === 401) return;
      // Server not configured or down: nothing else on the page can work.
      app.hidden = true;
      loginForm.hidden = true;
      setMessage(pageStatus, error.message);
    }
  }

  function replaceMovie(updated) {
    state.movies = state.movies.map((movie) =>
      movie.tmdb_id === updated.tmdb_id ? updated : movie,
    );
  }

  async function toggleWatched(movie, watched) {
    try {
      const data = await api("POST", `/api/movies/${movie.tmdb_id}/watched`, { watched });
      replaceMovie(data.movie);
      renderList();
    } catch (error) {
      setMessage(listStatus, error.message);
    }
  }

  async function removeMovie(movie) {
    if (!global.confirm(`¿Quitar «${movie.title}» de la lista?`)) return;
    try {
      await api("DELETE", `/api/movies/${movie.tmdb_id}`);
      state.movies = state.movies.filter((item) => item.tmdb_id !== movie.tmdb_id);
      renderList();
    } catch (error) {
      setMessage(listStatus, error.message);
    }
  }

  async function addMovie(result, button) {
    if (!state.name) {
      setMessage(nameHint, "Elige quién eres para poder añadir.");
      whoOptions.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    button.disabled = true;
    button.textContent = "añadiendo…";
    try {
      const data = await api("POST", "/api/movies", { tmdbId: result.tmdb_id, addedBy: state.name });
      state.movies = [...state.movies, data.movie];
      state.status = "pending";
      renderList();
    } catch (error) {
      button.disabled = false;
      button.textContent = "añadir";
      setMessage(searchStatus, error.message);
      if (error.status === 409) loadMovies();
    }
  }

  function resultRow(result, inList) {
    const already = inList.has(result.tmdb_id);
    const button = el("button", {
      type: "button",
      textContent: already ? "en la lista" : "añadir",
      disabled: already,
    });
    button.addEventListener("click", () => addMovie(result, button));
    const original = result.original_title && result.original_title !== result.title
      ? result.original_title
      : "";
    return el("li", { className: "movies-result" }, [
      poster(result, "movies-thumb"),
      el("div", { className: "movies-result-text" }, [
        el("p", { className: "movies-result-title" }, [
          result.title,
          result.year ? el("span", { className: "movies-year", textContent: ` ${result.year}` }) : null,
        ]),
        original ? el("p", { className: "movies-original", textContent: original }) : null,
      ]),
      button,
    ]);
  }

  function renderResults(data) {
    const inList = new Set(state.movies.map((movie) => movie.tmdb_id));
    results.replaceChildren(
      ...searchGroups(data).map((group) =>
        el("section", { className: "movies-result-group" }, [
          el("h2", { textContent: group.title }),
          el("ul", {}, group.movies.map((result) => resultRow(result, inList))),
        ]),
      ),
    );
  }

  function clearSearch() {
    state.searchSeq += 1;
    state.lastSearch = null;
    setMessage(searchStatus, "");
    results.replaceChildren();
  }

  async function search(query) {
    if (!query.trim()) {
      clearSearch();
      return;
    }
    const seq = ++state.searchSeq;
    setMessage(searchStatus, "buscando…");
    try {
      const data = await api("GET", `/api/movies/search?q=${encodeURIComponent(query.trim())}`);
      if (seq !== state.searchSeq) return;
      state.lastSearch = data;
      setMessage(searchStatus, searchGroups(data).length ? "" : "No sale nada con eso.");
      renderResults(data);
    } catch (error) {
      if (seq !== state.searchSeq) return;
      setMessage(searchStatus, error.message);
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const password = $("#movies-password").value;
    try {
      await api("POST", "/api/movies/login", { password });
      $("#movies-password").value = "";
      await loadMovies();
    } catch (error) {
      loginError.textContent = error.message;
    }
  });

  queryInput.addEventListener("input", () => {
    global.clearTimeout(state.searchTimer);
    state.searchTimer = global.setTimeout(() => search(queryInput.value), SEARCH_DELAY_MS);
  });

  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      queryInput.value = "";
      global.clearTimeout(state.searchTimer);
      clearSearch();
    } else if (event.key === "Enter") {
      // Search now and drop the phone keyboard so the results are visible.
      event.preventDefault();
      global.clearTimeout(state.searchTimer);
      search(queryInput.value);
      queryInput.blur();
    }
  });

  for (const button of statusButtons) {
    button.addEventListener("click", () => {
      state.status = button.dataset.status;
      renderList();
    });
  }

  randomButton.addEventListener("click", choose);
  $("#movies-pick-again").addEventListener("click", choose);
  $("#movies-pick-close").addEventListener("click", () => {
    state.picked = null;
    renderPick();
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await api("POST", "/api/movies/logout");
    } finally {
      state.movies = [];
      showLogin();
    }
  });

  state.name = storedName();
  loadMovies();
})(globalThis);
