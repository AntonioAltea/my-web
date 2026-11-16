(function (global) {
  const NAMES = ["Antonio", "Javi", "Jorge", "Miguel"];
  const NAME_STORAGE_KEY = "manturon-peliculas-name";
  const SEARCH_DELAY_MS = 350;

  // Pure helpers, exposed for the tests.

  function isWatched(movie) {
    return Boolean(movie.watched_at);
  }

  // Older movies only know who added them.
  function wantedBy(movie) {
    if (Array.isArray(movie.wanted_by)) return movie.wanted_by;
    return movie.added_by ? [movie.added_by] : [];
  }

  function notWantedBy(movie) {
    return Array.isArray(movie.not_wanted_by) ? movie.not_wanted_by : [];
  }

  // Whoever is home: something at least one of them wants to see, and that
  // none of them said "yo no" to.
  function suitsPeople(movie, people) {
    if (!people.length) return true;
    return (
      wantedBy(movie).some((person) => people.includes(person)) &&
      !notWantedBy(movie).some((person) => people.includes(person))
    );
  }

  // The duration slider runs from one hour to three in quarter hours; its
  // last stop means no limit.
  const RUNTIME_SLIDER = { min: 60, max: 180, step: 15 };

  function runtimeLimit(sliderValue) {
    const minutes = Number(sliderValue);
    return minutes >= RUNTIME_SLIDER.max ? null : minutes;
  }

  function runtimeLimitLabel(maxRuntime) {
    return maxRuntime ? `hasta ${formatRuntime(maxRuntime)}` : "sin límite";
  }

  function filterMovies(
    movies,
    { status = "pending", people = [], maxRuntime = null, genres = [] } = {},
  ) {
    return movies.filter((movie) => {
      if (status === "pending" && isWatched(movie)) return false;
      if (status === "watched" && !isWatched(movie)) return false;
      if (!suitsPeople(movie, people)) return false;
      // Without a known runtime we can't promise it fits.
      if (maxRuntime && !(movie.runtime && movie.runtime <= maxRuntime)) return false;
      if (genres.length && !(movie.genres || []).some((genre) => genres.includes(genre))) {
        return false;
      }
      return true;
    });
  }

  // A one-line description of the active filters, for when the panel is shut.
  function filterSummary({ people = [], maxRuntime = null, genres = [] } = {}) {
    const parts = [];
    if (people.length) parts.push(`en casa: ${people.join(", ")}`);
    if (maxRuntime) parts.push(runtimeLimitLabel(maxRuntime));
    if (genres.length) parts.push(genres.join(", "));
    return parts.join(" · ");
  }

  function genresOf(movies) {
    const genres = new Set(movies.flatMap((movie) => movie.genres || []));
    return [...genres].sort((a, b) => a.localeCompare(b, "es"));
  }

  function sortMovies(movies, status) {
    const key = status === "watched" ? "watched_at" : "added_at";
    // Pending: oldest first, so nothing sinks forever. Watched: latest first.
    const direction = status === "watched" ? -1 : 1;
    return [...movies].sort(
      (a, b) => direction * String(a[key] || "").localeCompare(String(b[key] || "")),
    );
  }

  function pickRandom(movies, { exclude = null, random = Math.random, ...filters } = {}) {
    let pool = filterMovies(movies, { ...filters, status: "pending" });
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
    RUNTIME_SLIDER,
    runtimeLimit,
    runtimeLimitLabel,
    filterSummary,
    wantedBy,
    notWantedBy,
    filterMovies,
    genresOf,
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
  const session = $("#movies-session");
  const sessionName = $("#movies-session-name");
  const whoSection = $("#movies-who");
  const app = $("#movies-app");
  const whoOptions = $("#movies-who-options");
  const nameHint = $("#movies-name-hint");
  const queryInput = $("#movies-query");
  const searchStatus = $("#movies-search-status");
  const results = $("#movies-results");
  const byOptions = $("#movies-by");
  const filtersToggle = $("#movies-filters-toggle");
  const filtersCount = $("#movies-filters-count");
  const filtersPanel = $("#movies-filters");
  const filtersSummary = $("#movies-filters-summary");
  const filtersSummaryText = $("#movies-filters-summary-text");
  const durationSlider = $("#movies-duration");
  const durationValue = $("#movies-duration-value");
  const genreOptions = $("#movies-genres");
  const statusButtons = [...document.querySelectorAll(".movies-tabs button")];
  const randomButton = $("#movies-random");
  const pickSection = $("#movies-pick");
  const pickCard = $("#movies-pick-card");
  const listStatus = $("#movies-list-status");
  const list = $("#movies-list");

  const state = {
    loggedIn: false,
    changingName: false,
    name: "",
    movies: [],
    status: "pending",
    people: [],
    maxRuntime: null,
    genres: [],
    filtersOpen: false,
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

  // Who you are is asked at the door, with the password. Someone already
  // logged in without a name gets just that question before the list.
  function renderScreen() {
    const ready = state.loggedIn && Boolean(state.name);
    whoSection.hidden = ready && !state.changingName;
    loginForm.hidden = state.loggedIn;
    app.hidden = !ready;
    session.hidden = !ready;
    sessionName.textContent = state.name;
    renderWho();
  }

  function showLogin() {
    state.loggedIn = false;
    renderScreen();
    $("#movies-password").focus();
  }

  function showApp() {
    setMessage(pageStatus, "");
    state.loggedIn = true;
    renderScreen();
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
            state.changingName = false;
            setMessage(nameHint, "");
            renderScreen();
            // The "yo también" buttons depend on who you are.
            if (state.loggedIn) renderList();
          },
        }),
      ),
    );
  }

  function toggled(list, value) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function filtersChanged() {
    state.picked = null;
    renderList();
  }

  function tags(container, values, selected, onToggle) {
    container.replaceChildren(
      ...values.map((value) =>
        el("button", {
          type: "button",
          className: "movies-tag",
          textContent: value,
          ariaPressed: String(selected.includes(value)),
          onclick: () => onToggle(value),
        }),
      ),
    );
  }

  function renderToolbar() {
    for (const button of statusButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.status === state.status));
    }

    // Tick whoever is home tonight; nobody ticked means everyone.
    tags(byOptions, NAMES, state.people, (name) => {
      state.people = toggled(state.people, name);
      filtersChanged();
    });

    // Genres come from the movies on the list, so there is never an empty one.
    const genres = genresOf(state.movies);
    state.genres = state.genres.filter((genre) => genres.includes(genre));
    tags(genreOptions, genres, state.genres, (genre) => {
      state.genres = toggled(state.genres, genre);
      filtersChanged();
    });

    durationSlider.value = String(state.maxRuntime || RUNTIME_SLIDER.max);
    durationValue.textContent = runtimeLimitLabel(state.maxRuntime);

    const active = [state.people.length, state.maxRuntime, state.genres.length].filter(Boolean).length;
    filtersCount.textContent = active ? String(active) : "";
    filtersToggle.setAttribute("aria-expanded", String(state.filtersOpen));
    filtersPanel.hidden = !state.filtersOpen;
    // Shut, the panel still says what it is filtering by.
    const summary = filterSummary(activeFilters());
    filtersSummaryText.textContent = summary;
    filtersSummary.hidden = !summary || state.filtersOpen;

    const matching = filterMovies(state.movies, { ...activeFilters(), status: "all" });
    $("#movies-count-pending").textContent = filterMovies(matching, { status: "pending" }).length;
    $("#movies-count-watched").textContent = filterMovies(matching, { status: "watched" }).length;
    randomButton.disabled = !pickRandom(state.movies, activeFilters());
  }

  function activeFilters() {
    return { people: state.people, maxRuntime: state.maxRuntime, genres: state.genres };
  }

  function filtering() {
    return Boolean(filterSummary(activeFilters()));
  }

  function clearFilters() {
    state.people = [];
    state.maxRuntime = null;
    state.genres = [];
    filtersChanged();
  }

  function linkList(movie) {
    return el("p", { className: "movies-links" }, [
      el("a", { href: letterboxdUrl(movie), textContent: "Letterboxd", rel: "noopener", target: "_blank" }),
      imdbUrl(movie)
        ? el("a", { href: imdbUrl(movie), textContent: "IMDb", rel: "noopener", target: "_blank" })
        : null,
    ]);
  }

  function wantedLine(movie) {
    const people = wantedBy(movie);
    const against = notWantedBy(movie);
    let who = people.length ? `quieren verla: ${people.join(", ")}` : "no la quiere ver nadie";
    if (against.length) who += ` · ${against.length > 1 ? "no quieren" : "no quiere"}: ${against.join(", ")}`;
    if (!movie.watched_at) return who;
    const date = new Date(movie.watched_at).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `vista el ${date} · ${who}`;
  }

  // "yo también" and "yo no" exclude each other; pressing the one already on
  // goes back to no opinion.
  function wantButtons(movie) {
    const yes = Boolean(state.name) && wantedBy(movie).includes(state.name);
    const no = Boolean(state.name) && notWantedBy(movie).includes(state.name);
    return el("span", { className: "movies-want-group" }, [
      el("button", {
        type: "button",
        className: "movies-want",
        textContent: "yo también",
        ariaPressed: String(yes),
        title: yes ? "Quitarte de quienes quieren verla" : "Apuntarte para verla",
        onclick: () => toggleWanted(movie, yes ? null : true),
      }),
      el("button", {
        type: "button",
        className: "movies-want movies-want-no",
        textContent: "yo no",
        ariaPressed: String(no),
        title: no
          ? "Volver a dejar que salga cuando estés en casa"
          : "Que no salga cuando estés en casa",
        onclick: () => toggleWanted(movie, no ? null : false),
      }),
    ]);
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
      el("p", { className: "movies-added" }, [
        wantedLine(movie),
        pick || watched ? null : wantButtons(movie),
      ]),
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
          removeControl(movie),
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
      filterMovies(state.movies, { ...activeFilters(), status: state.status }),
      state.status,
    );
    list.replaceChildren(...visible.map((movie) => el("li", {}, [movieCard(movie)])));
    let empty = "";
    if (!visible.length) {
      if (filtering()) {
        empty = "Nada encaja con estos filtros.";
      } else {
        empty = state.status === "pending"
          ? "No hay nada pendiente. Busca una película arriba y añádela."
          : "Todavía no habéis marcado ninguna como vista.";
      }
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
    const movie = pickRandom(state.movies, { ...activeFilters(), exclude: state.picked });
    state.picked = movie ? movie.tmdb_id : null;
    renderPick();
    if (movie) pickSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function loadMovies() {
    try {
      const data = await api("GET", "/api/movies");
      state.movies = data.movies || [];
      showApp();
      renderList();
    } catch (error) {
      if (error.status === 401) return;
      // Server not configured or down: nothing else on the page can work.
      app.hidden = true;
      loginForm.hidden = true;
      whoSection.hidden = true;
      session.hidden = true;
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

  function askForName(text) {
    state.changingName = true;
    renderScreen();
    setMessage(nameHint, text);
    whoOptions.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function toggleWanted(movie, want) {
    if (!state.name) {
      askForName("Elige quién eres para apuntarte.");
      return;
    }
    try {
      const data = await api("POST", `/api/movies/${movie.tmdb_id}/wanted`, {
        name: state.name,
        want,
      });
      replaceMovie(data.movie);
      renderList();
    } catch (error) {
      setMessage(listStatus, error.message);
    }
  }

  // "quitar" asks again in place ("¿seguro? sí · no") rather than with a
  // browser dialog.
  function removeControl(movie) {
    const wrapper = el("span", { className: "movies-remove-wrap" });
    const ask = el("button", {
      type: "button",
      className: "movies-link movies-remove",
      textContent: "quitar",
    });
    const confirmBox = el("span", { className: "movies-confirm", hidden: true }, [
      el("span", { textContent: "¿quitarla?" }),
      el("button", {
        type: "button",
        className: "movies-link movies-confirm-yes",
        textContent: "sí",
        onclick: () => removeMovie(movie),
      }),
      el("button", {
        type: "button",
        className: "movies-link",
        textContent: "no",
        onclick: () => {
          confirmBox.hidden = true;
          ask.hidden = false;
          ask.focus();
        },
      }),
    ]);
    ask.addEventListener("click", () => {
      ask.hidden = true;
      confirmBox.hidden = false;
      confirmBox.querySelector("button").focus();
    });
    wrapper.append(ask, confirmBox);
    return wrapper;
  }

  async function removeMovie(movie) {
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
      askForName("Elige quién eres para poder añadir.");
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
    if (!state.name) {
      setMessage(nameHint, "Elige quién eres.");
      return;
    }
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

  filtersToggle.addEventListener("click", () => {
    state.filtersOpen = !state.filtersOpen;
    renderToolbar();
  });

  // Label follows the thumb while dragging; the list updates as it moves.
  durationSlider.min = String(RUNTIME_SLIDER.min);
  durationSlider.max = String(RUNTIME_SLIDER.max);
  durationSlider.step = String(RUNTIME_SLIDER.step);
  durationSlider.addEventListener("input", () => {
    state.maxRuntime = runtimeLimit(durationSlider.value);
    filtersChanged();
  });

  for (const button of document.querySelectorAll(".movies-clear-filters")) {
    button.addEventListener("click", clearFilters);
  }

  randomButton.addEventListener("click", choose);
  $("#movies-pick-again").addEventListener("click", choose);
  $("#movies-pick-close").addEventListener("click", () => {
    state.picked = null;
    renderPick();
  });

  $("#movies-change-name").addEventListener("click", () => {
    state.changingName = !state.changingName;
    renderScreen();
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
  renderWho();
  loadMovies();
})(globalThis);
