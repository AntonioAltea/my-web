(function (global) {
  const SESSION_KEY = "manturon-analytics-session";

  function readStorage(storage, key) {
    if (!storage || typeof storage.getItem !== "function") {
      return null;
    }

    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    if (!storage || typeof storage.setItem !== "function") {
      return;
    }

    try {
      storage.setItem(key, value);
    } catch {}
  }

  function createSessionId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `s-${Date.now().toString(36)}-${randomPart}`;
  }

  function storageForSession(windowObject) {
    return windowObject.sessionStorage || windowObject.localStorage || null;
  }

  function createAnalyticsController({ fetchImpl, windowObject = global.window }) {
    let sessionId = null;

    function getSessionId() {
      if (sessionId) {
        return sessionId;
      }

      const storage = storageForSession(windowObject);
      const savedId = readStorage(storage, SESSION_KEY);
      if (savedId) {
        sessionId = savedId;
        return sessionId;
      }

      sessionId = createSessionId();
      writeStorage(storage, SESSION_KEY, sessionId);
      return sessionId;
    }

    async function sendEvent(payload) {
      try {
        await fetchImpl("/api/activity", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: getSessionId(),
            ...payload,
          }),
        });
      } catch {}
    }

    function trackVisit() {
      void sendEvent({ type: "visit" });
    }

    function trackTrackPlay(track) {
      if (!track || !track.file) {
        return;
      }

      void sendEvent({
        type: "track_play",
        trackFile: track.file,
        trackTitle: track.title || "",
      });
    }

    return {
      trackVisit,
      trackTrackPlay,
    };
  }

  global.ManturonAnalytics = {
    createAnalyticsController,
  };
})(globalThis);
