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

class FakeAudioElement extends FakeElement {
  constructor() {
    super("audio");
    this.paused = true;
    this.duration = 0;
    this.currentTime = 0;
  }

  play() {
    this.paused = false;
    this.dispatchEvent("play");
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatchEvent("pause");
  }
}

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

function createEnvironment(mediaPayload, { randomValues = [] } = {}) {
  FakeImage.reset();
  const selectors = {
    "#audio-player": new FakeAudioElement(),
    "#now-playing": new FakeElement("now-playing"),
    "#main-photo": new FakeElement("main-photo"),
    "#photo-loader": new FakeElement("photo-loader"),
    "#photo-caption": new FakeElement("photo-caption"),
    "#prev-photo": new FakeElement("prev-photo"),
    "#next-photo": new FakeElement("next-photo"),
    "#photo-random": new FakeElement("photo-random"),
    "#theme-toggle": new FakeElement("theme-toggle"),
    "#theme-toggle-label": new FakeElement("theme-toggle-label"),
    "#prev-track": new FakeElement("prev-track"),
    "#random-track": new FakeElement("random-track"),
    "#next-track": new FakeElement("next-track"),
    "#play-toggle": new FakeElement("play-toggle"),
    "#play-toggle-icon": new FakeElement("play-toggle-icon"),
    "#track-position": new FakeElement("track-position"),
    "#track-list-toggle": new FakeElement("track-list-toggle"),
    "#album-drawer": new FakeElement("album-drawer"),
    "#track-list-shell": new FakeElement("track-list-shell"),
    "#track-list": new FakeElement("track-list"),
    "#seek-bar": new FakeInputElement("seek-bar"),
    "#seek-bar-shell": new FakeElement("seek-bar-shell"),
    "#current-time": new FakeElement("current-time"),
    "#total-time": new FakeElement("total-time"),
    ".player-bar": new FakeElement("player-bar"),
  };

  selectors["#play-toggle"].dataset = {};
  selectors["#theme-toggle"].dataset = {};
  selectors["#seek-bar"].value = "0";
  selectors["#main-photo"].hidden = true;
  selectors["#photo-loader"].hidden = true;

  const documentListeners = new Map();
  const windowListeners = new Map();
  let intervalId = 0;
  let timeoutId = 0;
  const timeouts = new Map();
  const mediaQueryListeners = new Map();
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
  };
}

async function loadApp(options = {}) {
  const env = createEnvironment(
    options.mediaPayload || {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: ["/assets/music/uno.mp3", "/assets/music/dos.mp3"],
    },
    options,
  );

  const scripts = [
    "media-api.js",
    "analytics.js",
    "theme.js",
    "gallery.js",
    "player.js",
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

async function testTrackTitleAnimatesByDirection() {
  const env = await loadApp();
  const { selectors, flushTimeouts } = env;

  selectors["#next-track"].click();
  assert.equal(selectors["#now-playing"].classList.contains("now-playing-enter-next"), true);
  flushTimeouts();
  assert.equal(selectors["#now-playing"].classList.contains("now-playing-enter-next"), false);

  selectors["#prev-track"].click();
  assert.equal(selectors["#now-playing"].classList.contains("now-playing-enter-prev"), true);
}

async function testRandomTrackButtonPlaysAnotherTrack() {
  const env = await loadApp({ randomValues: [0] });
  const { selectors } = env;

  await selectors["#play-toggle"].listeners.get("click")[0]({ type: "click" });
  selectors["#random-track"].click();

  assert.equal(selectors["#track-position"].textContent, "tema 02");
  assert.equal(selectors["#now-playing"].textContent, "dos");
  assert.equal(selectors["#play-toggle"].dataset.state, "playing");
}

async function testPlayButtonTogglesPlayingState() {
  const env = await loadApp();
  const { selectors } = env;

  await selectors["#play-toggle"].listeners.get("click")[0]({ type: "click" });
  assert.equal(selectors["#play-toggle"].dataset.state, "playing");
  assert.equal(selectors["#seek-bar-shell"].classList.contains("seek-bar-shell-playing"), true);

  await selectors["#play-toggle"].listeners.get("click")[0]({ type: "click" });
  assert.equal(selectors["#play-toggle"].dataset.state, "paused");
  assert.equal(selectors["#seek-bar-shell"].classList.contains("seek-bar-shell-playing"), false);
}

async function testAlbumTrackListShowsOrderedTracks() {
  const env = await loadApp();
  const { selectors } = env;
  const trackButtons = selectors["#track-list"].querySelectorAll("button");

  assert.equal(selectors["#track-position"].textContent, "tema 01");
  assert.equal(selectors["#now-playing"].textContent, "uno");
  assert.equal(selectors["#album-drawer"].hidden, false);
  assert.equal(selectors["#album-drawer"].dataset.state, "closed");
  assert.equal(selectors["#album-drawer"].getAttribute("aria-hidden"), "true");
  assert.equal(selectors["#track-list-toggle"].textContent, "ver canciones");
  assert.equal(selectors["#track-list-toggle"].getAttribute("aria-expanded"), "false");
  assert.equal(trackButtons.length, 2);
  assert.equal(trackButtons[0].textContent, "");
  assert.equal(trackButtons[0].getAttribute("aria-current"), "true");
  assert.equal(trackButtons[1].getAttribute("aria-current"), "false");
  assert.equal(selectors["#random-track"].disabled, false);
}

async function testRandomTrackButtonStaysDisabledWithSingleTrack() {
  const env = await loadApp({
    mediaPayload: {
      photos: ["/assets/photos/uno.jpg"],
      music: ["/assets/music/uno.mp3"],
    },
  });
  const { selectors } = env;

  assert.equal(selectors["#random-track"].disabled, true);
}

async function testTrackListToggleShowsAndHidesAlbumTracks() {
  const env = await loadApp();
  const { selectors } = env;

  selectors["#track-list-toggle"].click();
  assert.equal(selectors["#album-drawer"].hidden, false);
  assert.equal(selectors["#album-drawer"].dataset.state, "open");
  assert.equal(selectors["#album-drawer"].getAttribute("aria-hidden"), "false");
  assert.equal(selectors["#track-list-toggle"].textContent, "ocultar canciones");
  assert.equal(selectors["#track-list-toggle"].getAttribute("aria-expanded"), "true");

  selectors["#track-list-toggle"].click();
  assert.equal(selectors["#album-drawer"].hidden, false);
  assert.equal(selectors["#album-drawer"].dataset.state, "closed");
  assert.equal(selectors["#album-drawer"].getAttribute("aria-hidden"), "true");
  assert.equal(selectors["#track-list-toggle"].textContent, "ver canciones");
  assert.equal(selectors["#track-list-toggle"].getAttribute("aria-expanded"), "false");
}

async function testTrackListCanSelectTrack() {
  const env = await loadApp();
  const { selectors } = env;
  const trackButtons = selectors["#track-list"].querySelectorAll("button");

  trackButtons[1].click();

  assert.equal(selectors["#track-position"].textContent, "tema 02");
  assert.equal(selectors["#now-playing"].textContent, "dos");
  assert.equal(trackButtons[1].getAttribute("aria-current"), "true");
}

async function testTracksVisitAndTrackPlayback() {
  const env = await loadApp();
  const { selectors, fetchCalls } = env;

  const analyticsCallsAfterLoad = fetchCalls.filter((call) => call.url === "/api/activity");
  assert.equal(analyticsCallsAfterLoad.length, 1);
  assert.equal(JSON.parse(analyticsCallsAfterLoad[0].options.body).type, "visit");

  await selectors["#play-toggle"].listeners.get("click")[0]({ type: "click" });

  const analyticsCallsAfterPlay = fetchCalls.filter((call) => call.url === "/api/activity");
  assert.equal(analyticsCallsAfterPlay.length, 2);
  const playPayload = JSON.parse(analyticsCallsAfterPlay[1].options.body);
  assert.equal(playPayload.type, "track_play");
  assert.equal(playPayload.trackFile, "/assets/music/uno.mp3");
  assert.equal(playPayload.trackTitle, "uno");
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

async function testPreloadsAdjacentAndRandomPhotos() {
  const env = await loadApp({
    mediaPayload: {
      photos: [
        "/assets/photos/uno.jpg",
        "/assets/photos/dos.jpg",
        "/assets/photos/tres.jpg",
        "/assets/photos/cuatro.jpg",
      ],
      music: ["/assets/music/uno.mp3"],
    },
    randomValues: [0, 0, 0],
  });
  const { selectors, fakeImages, triggerImageLoad } = env;

  assert.deepEqual(
    fakeImages.map((image) => image.src),
    [
      "/assets/photos/uno.jpg",
      "/assets/photos/cuatro.jpg",
      "/assets/photos/dos.jpg",
      "/assets/photos/tres.jpg",
    ],
  );

  triggerImageLoad(0);
  selectors["#next-photo"].click();

  assert.deepEqual(
    fakeImages.map((image) => image.src),
    [
      "/assets/photos/uno.jpg",
      "/assets/photos/cuatro.jpg",
      "/assets/photos/dos.jpg",
      "/assets/photos/tres.jpg",
    ],
  );
}

async function testKeepsCurrentPhotoVisibleWhileNextLoads() {
  const env = await loadApp({
    mediaPayload: {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: ["/assets/music/uno.mp3"],
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

async function testShowsPreloadedPhotoImmediately() {
  const env = await loadApp({
    mediaPayload: {
      photos: ["/assets/photos/uno.jpg", "/assets/photos/dos.jpg"],
      music: ["/assets/music/uno.mp3"],
    },
    randomValues: [0],
  });
  const { selectors, triggerImageLoad } = env;

  triggerImageLoad(0);
  triggerImageLoad(1);
  selectors["#next-photo"].click();

  assert.equal(selectors["#main-photo"].src, "/assets/photos/dos.jpg");
  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#next-photo"].disabled, false);
}

async function testRandomButtonUsesPreloadedRandomPhoto() {
  const env = await loadApp({
    mediaPayload: {
      photos: [
        "/assets/photos/uno.jpg",
        "/assets/photos/dos.jpg",
        "/assets/photos/tres.jpg",
        "/assets/photos/cuatro.jpg",
      ],
      music: ["/assets/music/uno.mp3"],
    },
    randomValues: [0, 0, 0],
  });
  const { selectors, triggerImageLoad } = env;

  triggerImageLoad(0);
  triggerImageLoad(3);
  selectors["#photo-random"].click();

  assert.equal(selectors["#main-photo"].src, "/assets/photos/tres.jpg");
  assert.equal(selectors["#photo-loader"].hidden, true);
  assert.equal(selectors["#photo-random"].disabled, false);
}

async function run() {
  const tests = [
    ["locks photo controls while loading", testPhotoControlsLockWhileLoading],
    ["animates track title by direction", testTrackTitleAnimatesByDirection],
    ["plays another track from the random button", testRandomTrackButtonPlaysAnotherTrack],
    ["toggles playing state from play button", testPlayButtonTogglesPlayingState],
    ["shows the album track list in order", testAlbumTrackListShowsOrderedTracks],
    ["disables random track when there is only one track", testRandomTrackButtonStaysDisabledWithSingleTrack],
    ["toggles the album track list open and closed", testTrackListToggleShowsAndHidesAlbumTracks],
    ["lets you select a track from the album list", testTrackListCanSelectTrack],
    ["tracks visits and playback analytics", testTracksVisitAndTrackPlayback],
    ["shows photo caption only on hover after load", testPhotoCaptionOnlyShowsOnHoverWhenLoaded],
    ["preloads previous next and random photos", testPreloadsAdjacentAndRandomPhotos],
    ["keeps the current photo visible while the next one loads", testKeepsCurrentPhotoVisibleWhileNextLoads],
    ["shows a preloaded photo immediately", testShowsPreloadedPhotoImmediately],
    ["uses the preloaded random photo on random navigation", testRandomButtonUsesPreloadedRandomPhoto],
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
