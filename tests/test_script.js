const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      this.values.add(token);
    }
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.values.delete(token);
    }
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.values.has(token)) {
        this.values.delete(token);
        return false;
      }
      this.values.add(token);
      return true;
    }

    if (force) {
      this.values.add(token);
      return true;
    }

    this.values.delete(token);
    return false;
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeStyle {
  constructor() {
    this.props = new Map();
  }

  setProperty(name, value) {
    this.props.set(name, value);
  }

  getPropertyValue(name) {
    return this.props.get(name) || "";
  }
}

class FakeElement {
  constructor(name = "element") {
    this.name = name;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "0";
    this.src = "";
    this.alt = "";
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.listeners = new Map();
    this.offsetHeight = 88;
    this.offsetWidth = 120;
    this.children = [];
    this.parentNode = null;
    this.type = "";
    this._className = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const evt = typeof event === "string" ? { type: event } : event;
    evt.target = evt.target || this;
    const listeners = this.listeners.get(evt.type) || [];
    for (const listener of listeners) {
      listener(evt);
    }
  }

  click() {
    this.dispatchEvent({ type: "click", preventDefault() {} });
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") {
        const textNode = new FakeElement("text");
        textNode.textContent = node;
        textNode.parentNode = this;
        this.children.push(textNode);
        continue;
      }

      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  querySelectorAll(selector) {
    const matches = [];
    const matchesSelector = (node) => {
      if (selector.startsWith(".")) {
        return node.classList.contains(selector.slice(1));
      }
      return selector === node.name || selector === node.tagName;
    };
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }

    this.parentNode.children = this.parentNode.children.filter(
      (child) => child !== this,
    );
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src") {
      this.src = "";
    }
  }

  getBoundingClientRect() {
    return {
      width: 320,
      height: 180,
      left: 0,
      top: 0,
      right: 320,
      bottom: 180,
      x: 0,
      y: 0,
    };
  }

  set className(value) {
    this._className = value;
    this.classList = new FakeClassList();
    for (const token of String(value).split(/\s+/).filter(Boolean)) {
      this.classList.add(token);
    }
  }

  get className() {
    return this._className;
  }
}

class FakeInputElement extends FakeElement {}

class FakeImage {
  static created = [];

  constructor() {
    this._src = "";
    this.onload = null;
    this.onerror = null;
    FakeImage.created.push(this);
  }

  set src(value) {
    this._src = value;
  }

  get src() {
    return this._src;
  }

  get currentSrc() {
    return this._src;
  }

  static reset() {
    FakeImage.created = [];
  }
}

class FakeResizeObserver {
  constructor(listener) {
    this.listener = listener;
  }

  observe(target) {
    this.listener([{ target }]);
  }

  unobserve() {}

  disconnect() {}
}

const DEFAULT_ALBUMS = [
  { id: "356629898", title: "la tormenta", cover: "/assets/icons/la-tormenta-portada.jpg" },
  {
    id: "3133548639",
    title: "ola de incendios",
    cover: "/assets/icons/ola-de-incendios-portada.jpg",
  },
];

const DEFAULT_ZINES = [
  {
    slug: "la-tormenta",
    title: "la tormenta",
    printable: { url: "/assets/zines/la-tormenta.pdf?v=2-1-1", bytes: 5471400 },
    pages: Array.from({ length: 8 }, (_, index) => ({
      number: index + 1,
      src: `/assets/zines/la-tormenta-p${index + 1}.jpg?v=2-1-1`,
      sizes: "(max-width: 720px) calc(100vw - 36px), 44vw",
      srcset:
        `/assets/zines/la-tormenta-p${index + 1}--w440.jpg?v=2-1-1 440w, ` +
        `/assets/zines/la-tormenta-p${index + 1}.jpg?v=2-1-1 877w`,
    })),
  },
];

function createEnvironment(
  mediaPayload,
  {
    randomValues = [],
    connection = null,
    albums = DEFAULT_ALBUMS,
    zines = DEFAULT_ZINES,
    initialHash = "#/fotos",
  } = {},
) {
  FakeImage.reset();
  const selectors = {
    "#main-photo": new FakeElement("main-photo"),
    "#photo-loader": new FakeElement("photo-loader"),
    "#photo-caption": new FakeElement("photo-caption"),
    "#prev-photo": new FakeElement("prev-photo"),
    "#next-photo": new FakeElement("next-photo"),
    "#photo-random": new FakeElement("photo-random"),
    "#theme-toggle": new FakeElement("theme-toggle"),
    "#theme-toggle-label": new FakeElement("theme-toggle-label"),
    "#bandcamp-player": new FakeElement("bandcamp-player"),
    "#bandcamp-loader": new FakeElement("bandcamp-loader"),
    "#bandcamp-cover": new FakeElement("bandcamp-cover"),
    "#album-toggle": new FakeElement("album-toggle"),
    "#album-toggle-current": new FakeElement("album-toggle-current"),
    "#album-list": new FakeElement("album-list"),
    ".player-bar": new FakeElement("player-bar"),
    "#back-link": new FakeElement("back-link"),
    "#nav-inicio": new FakeElement("nav-inicio"),
    "#nav-fotos": new FakeElement("nav-fotos"),
    "#nav-musica": new FakeElement("nav-musica"),
    "#nav-fanzines": new FakeElement("nav-fanzines"),
    "#view-inicio": new FakeElement("view-inicio"),
    "#view-fotos": new FakeElement("view-fotos"),
    "#view-musica": new FakeElement("view-musica"),
    "#view-fanzines": new FakeElement("view-fanzines"),
    "#album-grid": new FakeElement("album-grid"),
    "#latest-video": new FakeElement("latest-video"),
    "#zine-grid": new FakeElement("zine-grid"),
    "#zine-status": new FakeElement("zine-status"),
    "#zine-index": new FakeElement("zine-index"),
    "#zine-reader": new FakeElement("zine-reader"),
    "#zine-spread": new FakeElement("zine-spread"),
    "#zine-prev": new FakeElement("zine-prev"),
    "#zine-next": new FakeElement("zine-next"),
    "#zine-progress": new FakeElement("zine-progress"),
    "#zine-layout": new FakeElement("zine-layout"),
    "#zine-download": new FakeElement("zine-download"),
  };

  selectors["#theme-toggle"].dataset = {};
  selectors["#main-photo"].hidden = true;
  selectors["#photo-loader"].hidden = true;

  const documentListeners = new Map();
  const windowListeners = new Map();
  let intervalId = 0;
  let timeoutId = 0;
  const timeouts = new Map();
  const mediaQueryListeners = new Map();
  const mediaQueryObjects = new Map();
  const localStorageStore = new Map();
  const sessionStorageStore = new Map();
  const fetchCalls = [];

  const document = {
    hidden: false,
    documentElement: { style: new FakeStyle(), dataset: {} },
    querySelector(selector) {
      return selectors[selector] || null;
    },
    createElement(tagName) {
      const element = new FakeElement(tagName);
      element.tagName = tagName;
      return element;
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      const evt = typeof event === "string" ? { type: event } : event;
      const listeners = documentListeners.get(evt.type) || [];
      for (const listener of listeners) {
        listener(evt);
      }
    },
  };

  const windowObject = {
    location: { hash: initialHash },
    localStorage: {
      getItem(key) {
        return localStorageStore.has(key) ? localStorageStore.get(key) : null;
      },
      setItem(key, value) {
        localStorageStore.set(key, String(value));
      },
      removeItem(key) {
        localStorageStore.delete(key);
      },
    },
    sessionStorage: {
      getItem(key) {
        return sessionStorageStore.has(key) ? sessionStorageStore.get(key) : null;
      },
      setItem(key, value) {
        sessionStorageStore.set(key, String(value));
      },
      removeItem(key) {
        sessionStorageStore.delete(key);
      },
    },
    matchMedia(query) {
      const mediaQuery = {
        media: query,
        matches: false,
        addEventListener(type, listener) {
          if (type !== "change") {
            return;
          }

          const listeners = mediaQueryListeners.get(query) || [];
          listeners.push(listener);
          mediaQueryListeners.set(query, listeners);
        },
        removeEventListener(type, listener) {
          if (type !== "change") {
            return;
          }

          const listeners = mediaQueryListeners.get(query) || [];
          mediaQueryListeners.set(
            query,
            listeners.filter((candidate) => candidate !== listener),
          );
        },
      };

      mediaQueryObjects.set(query, mediaQuery);
      return mediaQuery;
    },
    setInterval(fn) {
      intervalId += 1;
      return intervalId;
    },
    clearInterval() {},
    setTimeout(fn) {
      timeoutId += 1;
      timeouts.set(timeoutId, fn);
      return timeoutId;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      const evt = typeof event === "string" ? { type: event } : event;
      const listeners = windowListeners.get(evt.type) || [];
      for (const listener of listeners) {
        listener(evt);
      }
    },
  };

  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (String(url).startsWith("/api/media")) {
      return {
        ok: true,
        async json() {
          return mediaPayload;
        },
      };
    }

    if (String(url).startsWith("/static/data/albums.json")) {
      return {
        ok: true,
        async json() {
          return albums;
        },
      };
    }

    if (String(url).startsWith("/api/zines")) {
      return {
        ok: zines !== null,
        async json() {
          return { zines };
        },
      };
    }

    if (url === "/api/activity" || url === "/api/analytics/event") {
      return {
        ok: true,
        async json() {
          return {};
        },
      };
    }

    if (
      String(url).startsWith("/api/activity/summary")
      || String(url).startsWith("/api/analytics/summary")
    ) {
      return {
        ok: true,
        async json() {
          return {
            generated_at: "2026-03-30T12:00:00+00:00",
            totals: {
              visits: 0,
              play_starts: 0,
              sessions_with_music: 0,
            },
            top_tracks: [],
          };
        },
      };
    }

    return {
      ok: false,
      async json() {
        return {};
      },
    };
  };

  const sandboxMath = Object.create(Math);
  if (randomValues.length) {
    let index = 0;
    sandboxMath.random = () => {
      const value = randomValues[Math.min(index, randomValues.length - 1)];
      index += 1;
      return value;
    };
  }

  const sandbox = {
    console,
    document,
    window: windowObject,
    fetch,
    Math: sandboxMath,
    Date,
    Promise,
    HTMLInputElement: FakeInputElement,
    Image: FakeImage,
    ResizeObserver: FakeResizeObserver,
    setTimeout: windowObject.setTimeout.bind(windowObject),
    clearTimeout: windowObject.clearTimeout.bind(windowObject),
    setInterval: windowObject.setInterval.bind(windowObject),
    clearInterval: windowObject.clearInterval.bind(windowObject),
    navigator: connection ? { connection } : {},
  };

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  return {
    selectors,
    sandbox,
    fetchCalls,
    fakeImages: FakeImage.created,
    triggerImageLoad(index = FakeImage.created.length - 1) {
      const image = FakeImage.created[index];
      if (image?.onload) {
        image.onload();
      }
    },
    triggerImageError(index = FakeImage.created.length - 1) {
      const image = FakeImage.created[index];
      if (image?.onerror) {
        image.onerror();
      }
    },
    flushTimeouts() {
      const callbacks = Array.from(timeouts.values());
      timeouts.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
    async navigate(hash) {
      windowObject.location.hash = hash;
      windowObject.dispatchEvent({ type: "hashchange" });
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    },
    setColorSchemeMatches(matches) {
      const query = "(prefers-color-scheme: dark)";
      const mediaQuery = mediaQueryObjects.get(query);
      if (mediaQuery) {
        mediaQuery.matches = matches;
      }

      const listeners = mediaQueryListeners.get(query) || [];
      for (const listener of listeners) {
        listener({ matches });
      }
    },
  };
}

async function loadApp(options = {}) {
  const env = createEnvironment(
    options.mediaPayload || {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: [
        { file: "/assets/music/uno.mp3", title: "uno", track_number: 1 },
        { file: "/assets/music/dos.mp3", title: "dos", track_number: 2 },
      ],
    },
    options,
  );

  const scripts = [
    "media-api.js",
    "analytics.js",
    "theme.js",
    "router.js",
    "gallery.js",
    "music.js",
    "zines.js",
    "bandcamp.js",
    "main.js",
  ];

  for (const scriptName of scripts) {
    const scriptPath = path.join(
      __dirname,
      "..",
      "src",
      "static",
      "js",
      scriptName,
    );
    const code = fs.readFileSync(scriptPath, "utf8");
    vm.runInNewContext(code, env.sandbox, { filename: scriptName });
  }

  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }

  return env;
}

async function testPhotoControlsLockWhileLoading() {
  const env = await loadApp();
  const { selectors, fakeImages, triggerImageLoad } = env;

  assert.equal(selectors["#prev-photo"].disabled, true);
  assert.equal(selectors["#next-photo"].disabled, true);
  assert.equal(selectors["#photo-random"].disabled, true);
  assert.equal(selectors["#main-photo"].hidden, true);
  assert.equal(fakeImages[0].src.startsWith("/assets/photos/"), true);

  triggerImageLoad(0);

  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#prev-photo"].disabled, false);
  assert.equal(selectors["#next-photo"].disabled, false);
  assert.equal(selectors["#photo-random"].disabled, false);
  assert.equal(selectors["#main-photo"].src.startsWith("/assets/photos/"), true);
}

async function testPhotoLoadTimeoutUnlocksControls() {
  const env = await loadApp({ randomValues: [0] });
  const { selectors, fakeImages, flushTimeouts } = env;

  flushTimeouts();

  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#photo-caption"].textContent, "No se pudo cargar la foto.");
  assert.equal(selectors["#prev-photo"].disabled, false);
  assert.equal(selectors["#next-photo"].disabled, false);
  assert.equal(selectors["#photo-random"].disabled, false);
  assert.equal(fakeImages[0].src, "");
}

async function testTimedOutPhotoCanBeRetried() {
  const env = await loadApp({ randomValues: [0] });
  const { selectors, fakeImages, triggerImageLoad, flushTimeouts } = env;

  flushTimeouts();

  selectors["#next-photo"].click();
  assert.equal(fakeImages.length, 2);
  triggerImageLoad(1);
  assert.equal(selectors["#main-photo"].src.startsWith("/assets/photos/dos.jpg"), true);

  selectors["#prev-photo"].click();

  assert.equal(fakeImages.length, 3);
  assert.equal(selectors["#photo-loader"].hidden, false);

  triggerImageLoad(2);

  assert.equal(selectors["#main-photo"].src.startsWith("/assets/photos/uno.jpg"), true);
  assert.equal(selectors["#photo-loader"].hidden, true);
}

async function testBandcampPlayerUsesLightColorsByDefault() {
  const env = await loadApp();
  const { selectors } = env;

  const src = selectors["#bandcamp-player"].src;
  assert.equal(src.includes("album=356629898"), true);
  assert.equal(src.includes("bgcol=eef0ee"), true);
  assert.equal(src.includes("linkcol=2f5f4d"), true);
  // The embed's own artwork would come out negative under the dark-mode filter.
  assert.equal(src.includes("artwork=none"), true);
  assert.equal(selectors["#bandcamp-cover"].src, "/assets/icons/la-tormenta-portada.jpg");
}

async function testBandcampLoaderHidesOnceTheEmbedLoads() {
  const env = await loadApp();
  const { selectors } = env;

  assert.equal(selectors["#bandcamp-loader"].hidden, false);

  selectors["#bandcamp-player"].dispatchEvent("load");

  assert.equal(selectors["#bandcamp-loader"].hidden, true);
}

async function testBandcampPlayerKeepsPlayingWhenThemeToggled() {
  const env = await loadApp();
  const { selectors } = env;
  const player = selectors["#bandcamp-player"];
  const srcBeforeToggle = player.src;

  selectors["#theme-toggle"].click();

  // Re-pointing the embed would reload it and stop the music, so dark mode
  // is a CSS filter keyed off data-theme instead.
  assert.equal(player.src, srcBeforeToggle);
  assert.equal(player.dataset.theme, "dark");

  // Another album keeps the same light colours and the dark filter.
  selectors["#album-list"].querySelectorAll("button")[1].click();
  assert.equal(player.src.includes("bgcol=eef0ee"), true);
  assert.equal(player.dataset.theme, "dark");
  assert.equal(selectors["#bandcamp-cover"].src, "/assets/icons/ola-de-incendios-portada.jpg");
}

async function testBandcampPlayerKeepsPlayingWhenSystemThemeChanges() {
  const env = await loadApp();
  const { selectors, setColorSchemeMatches } = env;
  const player = selectors["#bandcamp-player"];
  const srcBeforeChange = player.src;

  setColorSchemeMatches(true);

  assert.equal(player.src, srcBeforeChange);
  assert.equal(player.dataset.theme, "dark");
}

async function testBandcampPlayerTileArtUsesAlbumCoverImages() {
  const env = await loadApp();
  const { selectors } = env;
  const tiles = selectors["#album-list"].querySelectorAll("img");

  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].src, "/assets/icons/la-tormenta-portada.jpg");
  assert.equal(tiles[1].src, "/assets/icons/ola-de-incendios-portada.jpg");

  selectors["#theme-toggle"].click();

  assert.equal(tiles[0].src, "/assets/icons/la-tormenta-portada.jpg");
  assert.equal(tiles[1].src, "/assets/icons/ola-de-incendios-portada.jpg");
}

async function testBandcampPlayerShowsCurrentAlbumInToggle() {
  const env = await loadApp();
  const { selectors } = env;
  const items = selectors["#album-list"].querySelectorAll("button");

  assert.equal(selectors["#album-toggle-current"].textContent, "la tormenta");
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].textContent, "la tormenta");
  assert.equal(items[0].getAttribute("aria-pressed"), "true");
  assert.equal(items[1].children[0].textContent, "ola de incendios");
  assert.equal(items[1].getAttribute("aria-pressed"), "false");
}

async function testBandcampPlayerTogglesAlbumListOpenAndClosed() {
  const env = await loadApp();
  const { selectors } = env;

  selectors["#album-toggle"].click();
  assert.equal(selectors["#album-toggle"].getAttribute("aria-expanded"), "true");
  assert.equal(selectors["#album-list"].dataset.state, "open");

  selectors["#album-toggle"].click();
  assert.equal(selectors["#album-toggle"].getAttribute("aria-expanded"), "false");
  assert.equal(selectors["#album-list"].dataset.state, "closed");
}

async function testBandcampPlayerSwitchesAlbumOnSelectAndRemembersChoice() {
  const env = await loadApp();
  const { selectors, sandbox } = env;
  const items = selectors["#album-list"].querySelectorAll("button");

  selectors["#album-toggle"].click();
  items[1].click();

  const src = selectors["#bandcamp-player"].src;
  assert.equal(src.includes("album=3133548639"), true);
  assert.equal(selectors["#album-toggle-current"].textContent, "ola de incendios");
  assert.equal(selectors["#album-toggle"].getAttribute("aria-expanded"), "false");
  assert.equal(items[1].getAttribute("aria-pressed"), "true");
  assert.equal(sandbox.window.localStorage.getItem("manturon-album"), "3133548639");
}

async function testTracksVisit() {
  const env = await loadApp();
  const { fetchCalls } = env;

  const analyticsCallsAfterLoad = fetchCalls.filter((call) => call.url === "/api/activity");
  assert.equal(analyticsCallsAfterLoad.length, 1);
  assert.equal(JSON.parse(analyticsCallsAfterLoad[0].options.body).type, "visit");
}

async function testPhotoCaptionOnlyShowsOnHoverWhenLoaded() {
  const env = await loadApp();
  const { selectors, triggerImageLoad } = env;

  triggerImageLoad(0);
  selectors["#main-photo"].dispatchEvent("mouseenter");
  assert.equal(selectors["#photo-caption"].classList.contains("photo-caption-visible"), true);

  selectors["#main-photo"].dispatchEvent("mouseleave");
  assert.equal(selectors["#photo-caption"].classList.contains("photo-caption-visible"), false);
}

async function testKeepsCurrentPhotoVisibleWhileNextLoads() {
  const env = await loadApp({
    mediaPayload: {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: [{ file: "/assets/music/uno.mp3", title: "uno", track_number: 1 }],
    },
    randomValues: [0],
  });
  const { selectors, triggerImageLoad } = env;

  triggerImageLoad(0);
  assert.equal(selectors["#main-photo"].src, "/assets/photos/uno.jpg");

  selectors["#next-photo"].click();

  assert.equal(selectors["#main-photo"].hidden, false);
  assert.equal(selectors["#main-photo"].src, "/assets/photos/uno.jpg");
  assert.equal(selectors["#photo-loader"].hidden, false);

  triggerImageLoad(1);

  assert.equal(selectors["#main-photo"].src, "/assets/photos/dos.jpg");
  assert.equal(selectors["#photo-loader"].hidden, true);
}

async function testShowsLoadedPhotoImmediatelyWhenRevisited() {
  const env = await loadApp({
    mediaPayload: {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: [{ file: "/assets/music/uno.mp3", title: "uno", track_number: 1 }],
    },
    randomValues: [0],
  });
  const { selectors, triggerImageLoad } = env;

  triggerImageLoad(0);
  selectors["#next-photo"].click();
  triggerImageLoad(1);
  selectors["#prev-photo"].click();
  selectors["#next-photo"].click();

  assert.equal(selectors["#main-photo"].src, "/assets/photos/dos.jpg");
  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#next-photo"].disabled, false);
}

async function testRandomButtonStartsANewPhotoLoad() {
  const env = await loadApp({
    mediaPayload: {
      photos: [
        "/assets/photos/uno.jpg",
        "/assets/photos/dos.jpg",
        "/assets/photos/tres.jpg",
      ],
      music: [{ file: "/assets/music/uno.mp3", title: "uno", track_number: 1 }],
    },
    randomValues: [0.99],
  });
  const { selectors, fakeImages, triggerImageLoad } = env;

  triggerImageLoad(0);
  selectors["#photo-random"].click();

  assert.equal(fakeImages.length, 2);
  assert.equal(selectors["#photo-loader"].hidden, false);
  triggerImageLoad(1);
  assert.equal(selectors["#main-photo"].src, "/assets/photos/dos.jpg");
  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#photo-random"].disabled, false);
}

async function testUsesResponsivePhotoCandidatesFromMediaPayload() {
  const env = await loadApp({
    mediaPayload: {
      photos: [
        {
          src: "/assets/photos/uno.jpg?v=1",
          srcset: "/assets/photos/uno--w960.jpg?v=1 960w, /assets/photos/uno.jpg?v=1 1600w",
          sizes: "(max-width: 640px) calc(100vw - 34px), 1224px",
        },
      ],
      music: [{ file: "/assets/music/uno.mp3", title: "uno", track_number: 1 }],
    },
  });
  const { fakeImages } = env;

  assert.equal(fakeImages[0].src, "/assets/photos/uno.jpg?v=1");
  assert.equal(
    fakeImages[0].srcset,
    "/assets/photos/uno--w960.jpg?v=1 960w, /assets/photos/uno.jpg?v=1 1600w",
  );
  assert.equal(
    fakeImages[0].sizes,
    "(max-width: 640px) calc(100vw - 34px), 1224px",
  );
}

function routerModule() {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "static", "js", "router.js"),
    "utf8",
  );
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "router.js" });
  return sandbox.ManturonRouter;
}

function zinesModule() {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "src", "static", "js", "zines.js"),
    "utf8",
  );
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "zines.js" });
  return sandbox.ManturonZines;
}

async function testRouteParsingFallsBackToHome() {
  const { parseRoute, routeHash, parentHash } = routerModule();

  assert.deepEqual(parseRoute(""), { route: "inicio", param: "" });
  assert.deepEqual(parseRoute("#/"), { route: "inicio", param: "" });
  assert.deepEqual(parseRoute("#/pepinillos"), { route: "inicio", param: "" });
  assert.deepEqual(parseRoute("#/fotos"), { route: "fotos", param: "" });
  assert.deepEqual(parseRoute("#/fanzines/la-tormenta"), {
    route: "fanzines",
    param: "la-tormenta",
  });
  assert.deepEqual(parseRoute("#/fanzines/%E2%98%85"), {
    route: "fanzines",
    param: "★",
  });
  // A malformed escape should not throw, just come back as written.
  assert.deepEqual(parseRoute("#/fanzines/%E0%A4%A"), {
    route: "fanzines",
    param: "%E0%A4%A",
  });

  assert.equal(routeHash("inicio", ""), "#/");
  assert.equal(routeHash("musica", ""), "#/musica");
  assert.equal(routeHash("fanzines", "san juan"), "#/fanzines/san%20juan");

  assert.equal(parentHash({ route: "inicio", param: "" }), "#/");
  assert.equal(parentHash({ route: "musica", param: "" }), "#/");
  assert.equal(parentHash({ route: "fanzines", param: "la-tormenta" }), "#/fanzines");
}

async function testSectionsSwapWithoutTouchingThePlayer() {
  const env = await loadApp({ initialHash: "#/" });
  const { selectors, navigate } = env;

  assert.equal(selectors["#view-inicio"].hidden, false);
  assert.equal(selectors["#view-fotos"].hidden, true);
  assert.equal(selectors["#back-link"].hidden, true);
  assert.equal(selectors["#nav-inicio"].getAttribute("aria-current"), "page");

  const playerSrcOnHome = selectors["#bandcamp-player"].src;

  await navigate("#/fanzines/la-tormenta");
  assert.equal(selectors["#view-inicio"].hidden, true);
  assert.equal(selectors["#view-fanzines"].hidden, false);
  assert.equal(selectors["#back-link"].hidden, false);
  // Backing out of a zine lands on the zine list, not on the home menu.
  assert.equal(selectors["#back-link"].getAttribute("href"), "#/fanzines");

  await navigate("#/musica");
  assert.equal(selectors["#back-link"].getAttribute("href"), "#/");
  // The side menu marks only the section being shown.
  assert.equal(selectors["#nav-musica"].getAttribute("aria-current"), "page");
  assert.equal(selectors["#nav-inicio"].getAttribute("aria-current"), null);
  assert.equal(selectors["#nav-fanzines"].getAttribute("aria-current"), null);

  // Changing section must never re-point the embed, or playback restarts.
  assert.equal(selectors["#bandcamp-player"].src, playerSrcOnHome);
}

async function testZineSpreadsKeepFacingPagesTogether() {
  const { buildSpreads, spreadIndexForPage, progressLabel } = zinesModule();

  assert.deepEqual(buildSpreads(8, true), [[1], [2, 3], [4, 5], [6, 7], [8]]);
  assert.deepEqual(buildSpreads(8, false), [[1], [2], [3], [4], [5], [6], [7], [8]]);
  assert.deepEqual(buildSpreads(0, true), []);

  const spreads = buildSpreads(8, true);
  assert.equal(spreadIndexForPage(spreads, 5), 2);
  assert.equal(spreadIndexForPage(spreads, 99), 0);

  assert.equal(progressLabel([4, 5], 8), "4-5 / 8");
  assert.equal(progressLabel([1], 8), "1 / 8");
  assert.equal(progressLabel([], 8), "");
}

async function testZineReaderPagesThroughSpreads() {
  const env = await loadApp({ initialHash: "#/fanzines/la-tormenta" });
  const { selectors } = env;

  // Two pages by default, on any screen size.
  assert.equal(selectors["#zine-index"].hidden, true);
  assert.equal(selectors["#zine-reader"].hidden, false);
  assert.equal(selectors["#zine-progress"].textContent, "1 / 8");
  assert.equal(selectors["#zine-prev"].disabled, true);

  selectors["#zine-next"].click();
  assert.equal(selectors["#zine-progress"].textContent, "2-3 / 8");
  assert.equal(selectors["#zine-spread"].dataset.pages, "2");
  assert.equal(selectors["#zine-prev"].disabled, false);

  // Spreads: [1], [2,3], [4,5], [6,7], [8] — three more clicks reach the end.
  selectors["#zine-next"].click();
  selectors["#zine-next"].click();
  selectors["#zine-next"].click();
  assert.equal(selectors["#zine-progress"].textContent, "8 / 8");
  assert.equal(selectors["#zine-next"].disabled, true);

  selectors["#zine-next"].click();
  assert.equal(selectors["#zine-progress"].textContent, "8 / 8");
}

async function testZineTurnLaysASheetOverTheNewPage() {
  const env = await loadApp({ initialHash: "#/fanzines/la-tormenta" });
  const { selectors } = env;
  const spread = selectors["#zine-spread"];

  // Opening a zine has nothing to turn away from.
  assert.equal(spread.querySelectorAll(".zine-sheet").length, 0);

  selectors["#zine-next"].click();
  const forward = spread.querySelectorAll(".zine-sheet");
  assert.equal(forward.length, 1);
  assert.equal(forward[0].classList.contains("zine-sheet-forward"), true);
  // The sheet is a copy of the page you just left.
  assert.equal(forward[0].src.includes("la-tormenta-p1.jpg"), true);

  selectors["#zine-prev"].click();
  const back = spread.querySelectorAll(".zine-sheet");
  assert.equal(back.length, 1);
  assert.equal(back[0].classList.contains("zine-sheet-back"), true);
  assert.equal(back[0].src.includes("la-tormenta-p2.jpg"), true);

  // The overlay is cleaned up even if no animation event ever arrives.
  env.flushTimeouts();
  assert.equal(spread.querySelectorAll(".zine-sheet").length, 0);
}

async function testZineLayoutTogglePersists() {
  const env = await loadApp({ initialHash: "#/fanzines/la-tormenta" });
  const { selectors, sandbox } = env;
  const layout = selectors["#zine-layout"];

  // Two pages by default, past the cover which is on its own either way.
  selectors["#zine-next"].click();
  assert.equal(selectors["#zine-spread"].dataset.pages, "2");
  assert.equal(selectors["#zine-progress"].textContent, "2-3 / 8");
  assert.equal(layout.textContent, "ver una página");

  layout.click();
  assert.equal(selectors["#zine-spread"].dataset.pages, "1");
  assert.equal(layout.textContent, "ver dos páginas");
  assert.equal(
    sandbox.window.localStorage.getItem("manturon-zine-layout"),
    "single",
  );

  layout.click();
  assert.equal(selectors["#zine-spread"].dataset.pages, "2");
  assert.equal(
    sandbox.window.localStorage.getItem("manturon-zine-layout"),
    "spread",
  );
}

async function testZineReaderOffersThePrintablePdf() {
  const env = await loadApp({ initialHash: "#/fanzines/la-tormenta" });
  const download = env.selectors["#zine-download"];

  assert.equal(download.hidden, false);
  assert.equal(
    download.getAttribute("href"),
    "/assets/zines/la-tormenta.pdf?v=2-1-1",
  );
  assert.equal(download.getAttribute("download"), "la-tormenta.pdf");
}

async function testZineWithoutAPdfHidesTheDownload() {
  const zines = [
    {
      slug: "sin-pdf",
      title: "sin pdf",
      pages: [{ number: 1, src: "/assets/zines/sin-pdf-p1.jpg" }],
    },
  ];
  const env = await loadApp({ initialHash: "#/fanzines/sin-pdf", zines });

  assert.equal(env.selectors["#zine-download"].hidden, true);
}

async function testZineReaderRespondsToArrowKeys() {
  const env = await loadApp({ initialHash: "#/fanzines/la-tormenta" });
  const { selectors, sandbox } = env;

  sandbox.document.dispatchEvent({ type: "keydown", key: "ArrowRight" });
  assert.equal(selectors["#zine-progress"].textContent, "2-3 / 8");

  sandbox.document.dispatchEvent({ type: "keydown", key: "ArrowLeft" });
  assert.equal(selectors["#zine-progress"].textContent, "1 / 8");
}

async function testUnknownZineFallsBackToTheList() {
  const env = await loadApp({ initialHash: "#/fanzines/no-existe" });
  const { selectors } = env;

  assert.equal(selectors["#zine-index"].hidden, false);
  assert.equal(selectors["#zine-reader"].hidden, true);
  assert.equal(selectors["#zine-grid"].children.length, 1);
}

async function testZineListReportsLoadFailures() {
  const env = await loadApp({ initialHash: "#/fanzines", zines: null });
  const { selectors } = env;

  assert.equal(selectors["#zine-status"].hidden, false);
  assert.equal(
    selectors["#zine-status"].textContent,
    "No se pudieron cargar los fanzines.",
  );
}

async function testMusicSectionListsTheAlbums() {
  const env = await loadApp({ initialHash: "#/musica" });
  const { selectors } = env;

  assert.equal(selectors["#album-grid"].children.length, DEFAULT_ALBUMS.length);
}

async function testLatestVideoOnlyLoadsOnceYouOpenMusic() {
  const env = await loadApp({ initialHash: "#/" });
  const { selectors, navigate } = env;
  const video = selectors["#latest-video"];

  assert.equal(video.src, "");

  await navigate("#/musica");
  assert.equal(
    video.src,
    "https://www.youtube-nocookie.com/embed/videoseries?list=UUVjNdPxE-IB14UBWkS5Glww",
  );

  // Coming back must not reload it, or a playing video would restart.
  video.src = `${video.src}#playing`;
  await navigate("#/fotos");
  await navigate("#/musica");
  assert.equal(video.src.endsWith("#playing"), true);
}

async function testMusicSectionAlbumSwitchesThePlayer() {
  const env = await loadApp({ initialHash: "#/musica" });
  const { selectors, sandbox } = env;

  const secondAlbum = selectors["#album-grid"].children[1];
  secondAlbum.children[0].click();

  assert.equal(
    selectors["#bandcamp-player"].src.includes(`album=${DEFAULT_ALBUMS[1].id}`),
    true,
  );
  assert.equal(
    sandbox.window.localStorage.getItem("manturon-album"),
    DEFAULT_ALBUMS[1].id,
  );
}

async function testPhotosOnlyLoadOnceYouOpenThatSection() {
  const env = await loadApp({ initialHash: "#/" });
  const { fetchCalls, navigate } = env;

  const mediaCallsOnHome = fetchCalls.filter((call) =>
    String(call.url).startsWith("/api/media"),
  );
  assert.equal(mediaCallsOnHome.length, 0);

  await navigate("#/fotos");
  const mediaCallsAfter = fetchCalls.filter((call) =>
    String(call.url).startsWith("/api/media"),
  );
  assert.equal(mediaCallsAfter.length, 1);
}

async function run() {
  const tests = [
    ["locks photo controls while loading", testPhotoControlsLockWhileLoading],
    ["unlocks photo controls after a stalled image times out", testPhotoLoadTimeoutUnlocksControls],
    ["retries a timed out photo when you come back to it", testTimedOutPhotoCanBeRetried],
    ["uses light bandcamp embed colors by default", testBandcampPlayerUsesLightColorsByDefault],
    ["hides the bandcamp loader once the embed loads", testBandcampLoaderHidesOnceTheEmbedLoads],
    ["keeps the bandcamp embed playing when the theme is toggled", testBandcampPlayerKeepsPlayingWhenThemeToggled],
    ["keeps the bandcamp embed playing when the system theme changes", testBandcampPlayerKeepsPlayingWhenSystemThemeChanges],
    ["uses each album's cover image for its tile art", testBandcampPlayerTileArtUsesAlbumCoverImages],
    ["shows the current album in the toggle", testBandcampPlayerShowsCurrentAlbumInToggle],
    ["toggles the album list open and closed", testBandcampPlayerTogglesAlbumListOpenAndClosed],
    ["switches album on select and remembers the choice", testBandcampPlayerSwitchesAlbumOnSelectAndRemembersChoice],
    ["tracks visits", testTracksVisit],
    ["shows photo caption only on hover after load", testPhotoCaptionOnlyShowsOnHoverWhenLoaded],
    ["keeps the current photo visible while the next one loads", testKeepsCurrentPhotoVisibleWhileNextLoads],
    ["shows a loaded photo immediately when revisited", testShowsLoadedPhotoImmediatelyWhenRevisited],
    ["starts a fresh load for random navigation", testRandomButtonStartsANewPhotoLoad],
    ["uses responsive photo candidates from the media payload", testUsesResponsivePhotoCandidatesFromMediaPayload],
    ["falls back to home for unknown routes", testRouteParsingFallsBackToHome],
    ["swaps sections without touching the player", testSectionsSwapWithoutTouchingThePlayer],
    ["keeps facing zine pages in the same spread", testZineSpreadsKeepFacingPagesTogether],
    ["pages through zine spreads", testZineReaderPagesThroughSpreads],
    ["lays a turning sheet over the new page", testZineTurnLaysASheetOverTheNewPage],
    ["lets you choose one or two pages", testZineLayoutTogglePersists],
    ["offers the printable pdf", testZineReaderOffersThePrintablePdf],
    ["hides the download when a zine has no pdf", testZineWithoutAPdfHidesTheDownload],
    ["turns zine pages with the arrow keys", testZineReaderRespondsToArrowKeys],
    ["falls back to the zine list for an unknown zine", testUnknownZineFallsBackToTheList],
    ["reports a failed zine load", testZineListReportsLoadFailures],
    ["lists the albums", testMusicSectionListsTheAlbums],
    ["switches the player from the music section", testMusicSectionAlbumSwitchesThePlayer],
    ["only loads the latest video once you open music", testLatestVideoOnlyLoadsOnceYouOpenMusic],
    ["only loads photos once you open that section", testPhotosOnlyLoadOnceYouOpenThatSection],
  ];

  for (const [name, testFn] of tests) {
    await testFn();
    process.stdout.write(`ok - ${name}\n`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
