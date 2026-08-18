(function (global) {
  const HOME_ROUTE = "inicio";
  const ROUTES = [HOME_ROUTE, "fotos", "musica", "fanzines"];

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function parseRoute(hash) {
    const segments = String(hash || "")
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean);
    const name = segments.length ? safeDecode(segments[0]) : HOME_ROUTE;
    const route = ROUTES.includes(name) ? name : HOME_ROUTE;
    const param =
      route !== HOME_ROUTE && segments.length > 1 ? safeDecode(segments[1]) : "";

    return { route, param };
  }

  function routeHash(route, param) {
    if (!route || route === HOME_ROUTE) {
      return "#/";
    }

    if (!param) {
      return `#/${route}`;
    }

    return `#/${route}/${encodeURIComponent(param)}`;
  }

  // Going back means going up one level: out of a zine to the zine list, and
  // out of a section to the home menu.
  function parentHash({ route, param }) {
    if (route === HOME_ROUTE || !param) {
      return routeHash(HOME_ROUTE, "");
    }

    return routeHash(route, "");
  }

  function createRouter({ views, backLink, onChange, win = global.window }) {
    let current = { route: HOME_ROUTE, param: "" };

    function apply(next) {
      for (const route of ROUTES) {
        const view = views[route];
        if (view) {
          view.hidden = route !== next.route;
        }
      }

      if (backLink) {
        backLink.hidden = next.route === HOME_ROUTE;
        backLink.setAttribute("href", parentHash(next));
      }

      const previous = current;
      current = next;
      if (typeof onChange === "function") {
        onChange(next, previous);
      }
    }

    function sync() {
      apply(parseRoute(win.location ? win.location.hash : ""));
    }

    function navigate(route, param) {
      const nextHash = routeHash(route, param);
      if (win.location && win.location.hash === nextHash) {
        sync();
        return;
      }

      win.location.hash = nextHash;
    }

    function getRoute() {
      return { route: current.route, param: current.param };
    }

    function init() {
      win.addEventListener("hashchange", sync);
      sync();
    }

    return { getRoute, init, navigate, sync };
  }

  global.ManturonRouter = {
    HOME_ROUTE,
    ROUTES,
    createRouter,
    parentHash,
    parseRoute,
    routeHash,
  };
})(globalThis);
