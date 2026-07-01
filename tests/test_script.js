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
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === child.name || selector === child.tagName) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
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
    return { width: 320, height: 180 };
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

function createEnvironment(mediaPayload, { randomValues = [], connection = null } = {}) {
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
    "#album-toggle": new FakeElement("album-toggle"),
    "#album-toggle-current": new FakeElement("album-toggle-current"),
    "#album-list": new FakeElement("album-list"),
    ".player-bar": new FakeElement("player-bar"),
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
    "albums.js",
    "analytics.js",
    "theme.js",
    "gallery.js",
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

  for (let index = 0; index < 6; index += 1) {
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
  assert.equal(src.includes("bgcol=f6f7f5"), true);
  assert.equal(src.includes("linkcol=2f5f4d"), true);
}

async function testBandcampPlayerSwitchesColorsWhenThemeToggled() {
  const env = await loadApp();
  const { selectors } = env;

  selectors["#theme-toggle"].click();

  const src = selectors["#bandcamp-player"].src;
  assert.equal(src.includes("bgcol=1c1c1c"), true);
  assert.equal(src.includes("linkcol=88b5a0"), true);
}

async function testBandcampPlayerFollowsSystemThemeInAutoMode() {
  const env = await loadApp();
  const { selectors, setColorSchemeMatches } = env;

  setColorSchemeMatches(true);

  const src = selectors["#bandcamp-player"].src;
  assert.equal(src.includes("bgcol=1c1c1c"), true);
  assert.equal(src.includes("linkcol=88b5a0"), true);
}

async function testBandcampPlayerTileArtMatchesAlbumsAndTheme() {
  const env = await loadApp();
  const { selectors } = env;
  const tiles = selectors["#album-list"].querySelectorAll("iframe");

  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].src.includes("album=356629898"), true);
  assert.equal(tiles[0].src.includes("minimal=true"), true);
  assert.equal(tiles[0].src.includes("bgcol=f6f7f5"), true);
  assert.equal(tiles[1].src.includes("album=3133548639"), true);

  selectors["#theme-toggle"].click();

  assert.equal(tiles[0].src.includes("bgcol=1c1c1c"), true);
  assert.equal(tiles[1].src.includes("bgcol=1c1c1c"), true);
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

async function run() {
  const tests = [
    ["locks photo controls while loading", testPhotoControlsLockWhileLoading],
    ["unlocks photo controls after a stalled image times out", testPhotoLoadTimeoutUnlocksControls],
    ["retries a timed out photo when you come back to it", testTimedOutPhotoCanBeRetried],
    ["uses light bandcamp embed colors by default", testBandcampPlayerUsesLightColorsByDefault],
    ["switches bandcamp embed colors when the theme is toggled", testBandcampPlayerSwitchesColorsWhenThemeToggled],
    ["follows the system theme for the bandcamp embed in auto mode", testBandcampPlayerFollowsSystemThemeInAutoMode],
    ["matches tile art to each album and the current theme", testBandcampPlayerTileArtMatchesAlbumsAndTheme],
    ["shows the current album in the toggle", testBandcampPlayerShowsCurrentAlbumInToggle],
    ["toggles the album list open and closed", testBandcampPlayerTogglesAlbumListOpenAndClosed],
    ["switches album on select and remembers the choice", testBandcampPlayerSwitchesAlbumOnSelectAndRemembersChoice],
    ["tracks visits", testTracksVisit],
    ["shows photo caption only on hover after load", testPhotoCaptionOnlyShowsOnHoverWhenLoaded],
    ["keeps the current photo visible while the next one loads", testKeepsCurrentPhotoVisibleWhileNextLoads],
    ["shows a loaded photo immediately when revisited", testShowsLoadedPhotoImmediatelyWhenRevisited],
    ["starts a fresh load for random navigation", testRandomButtonStartsANewPhotoLoad],
    ["uses responsive photo candidates from the media payload", testUsesResponsivePhotoCandidatesFromMediaPayload],
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
