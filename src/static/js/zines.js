(function (global) {
  const ZINES_URL = "/api/zines";
  const LAYOUT_STORAGE_KEY = "manturon-zine-layout";
  const TURN_DURATION_MS = 460;

  function normalizePage(page) {
    if (!page || typeof page.src !== "string" || !page.src) {
      return null;
    }

    return {
      number: Number.isInteger(page.number) ? page.number : 0,
      src: page.src,
      sizes: typeof page.sizes === "string" ? page.sizes : "",
      srcset: typeof page.srcset === "string" ? page.srcset : "",
    };
  }

  function normalizeZine(zine) {
    if (!zine || typeof zine.slug !== "string" || !zine.slug) {
      return null;
    }

    const pages = Array.isArray(zine.pages)
      ? zine.pages.map(normalizePage).filter(Boolean)
      : [];
    if (!pages.length) {
      return null;
    }

    const printable = zine.printable;
    return {
      slug: zine.slug,
      title:
        typeof zine.title === "string" && zine.title.trim()
          ? zine.title
          : zine.slug.replace(/-+/g, " "),
      printableUrl:
        printable && typeof printable.url === "string" ? printable.url : "",
      pages,
    };
  }

  async function fetchZines(fetchFn) {
    const response = await fetchFn(ZINES_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return Array.isArray(payload.zines)
      ? payload.zines.map(normalizeZine).filter(Boolean)
      : [];
  }

  // A folded zine opens as a booklet: the cover stands alone, the inner pages
  // face each other in pairs, and the back cover stands alone again. Keeping
  // those pairs together is what stops a photo drawn across two panels from
  // being cut in half.
  function buildSpreads(pageCount, paired) {
    if (pageCount <= 0) {
      return [];
    }

    if (!paired) {
      return Array.from({ length: pageCount }, (_, index) => [index + 1]);
    }

    const spreads = [[1]];
    for (let page = 2; page <= pageCount; page += 2) {
      if (page === pageCount) {
        spreads.push([page]);
        break;
      }

      spreads.push([page, page + 1]);
    }

    return spreads;
  }

  function spreadIndexForPage(spreads, page) {
    const found = spreads.findIndex((spread) => spread.includes(page));
    return found >= 0 ? found : 0;
  }

  function progressLabel(spread, pageCount) {
    if (!spread || !spread.length) {
      return "";
    }

    const range =
      spread.length > 1 ? `${spread[0]}-${spread[spread.length - 1]}` : `${spread[0]}`;
    return `${range} / ${pageCount}`;
  }

  function createZines({
    grid,
    status,
    index,
    reader,
    spread,
    prevButton,
    nextButton,
    progress,
    layoutButton,
    downloadLink,
    fetchFn,
    win = global.window,
  }) {
    let zines = [];
    let currentZine = null;
    let currentPage = 1;
    let loadPromise = null;
    // Two pages by default, on any screen size, until you say otherwise.
    let layoutChoice = readStoredLayout();

    const reducedMotionQuery = win.matchMedia
      ? win.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    function readStoredLayout() {
      const stored = win.localStorage
        ? win.localStorage.getItem(LAYOUT_STORAGE_KEY)
        : null;
      return stored === "single" ? "single" : "spread";
    }

    function isPaired() {
      return layoutChoice === "spread";
    }

    function syncLayoutButton() {
      if (!layoutButton) {
        return;
      }

      const paired = isPaired();
      layoutButton.textContent = paired ? "ver una página" : "ver dos páginas";
      layoutButton.setAttribute("aria-pressed", paired ? "true" : "false");
    }

    function toggleLayout() {
      layoutChoice = isPaired() ? "single" : "spread";
      if (win.localStorage) {
        win.localStorage.setItem(LAYOUT_STORAGE_KEY, layoutChoice);
      }

      syncLayoutButton();
      if (currentZine) {
        renderSpread();
      }
    }

    function currentSpreads() {
      if (!currentZine) {
        return [];
      }

      return buildSpreads(currentZine.pages.length, isPaired());
    }

    function pageByNumber(number) {
      return currentZine
        ? currentZine.pages.find((page) => page.number === number) || null
        : null;
    }

    function buildPageImage(page, className) {
      const image = global.document.createElement("img");
      image.className = className;
      image.src = page.src;
      image.alt = "";
      if (page.srcset) {
        image.setAttribute("srcset", page.srcset);
      }
      if (page.sizes) {
        image.setAttribute("sizes", page.sizes);
      }
      return image;
    }

    function preloadSpread(pages) {
      for (const number of pages) {
        const page = pageByNumber(number);
        if (!page) {
          continue;
        }

        const image = new global.Image();
        if (page.srcset) {
          image.srcset = page.srcset;
        }
        image.src = page.src;
      }
    }

    function removeTurningSheet() {
      for (const sheet of spread.querySelectorAll(".zine-sheet")) {
        sheet.remove();
      }
    }

    // The page you leave is copied on top of the new one and swung about the
    // spine, which is what makes it read as a sheet of paper being turned.
    // Going forward the right hand page turns left, and the other way round.
    function captureTurningSheet(direction) {
      if (!direction || (reducedMotionQuery && reducedMotionQuery.matches)) {
        return null;
      }

      const pages = spread.children;
      const leaving = direction > 0 ? pages[pages.length - 1] : pages[0];
      if (!leaving) {
        return null;
      }

      const pageRect = leaving.getBoundingClientRect();
      const stageRect = spread.getBoundingClientRect();
      const box = {
        left: pageRect.left - stageRect.left,
        top: pageRect.top - stageRect.top,
        width: pageRect.width,
        height: pageRect.height,
      };

      if (!Object.values(box).every((value) => Number.isFinite(value))) {
        return null;
      }

      return {
        box,
        direction,
        src: leaving.currentSrc || leaving.src,
      };
    }

    function playTurn(capture) {
      if (!capture) {
        return;
      }

      const sheet = global.document.createElement("img");
      sheet.className =
        capture.direction > 0
          ? "zine-sheet zine-sheet-forward"
          : "zine-sheet zine-sheet-back";
      sheet.src = capture.src;
      sheet.alt = "";
      sheet.style.left = `${capture.box.left}px`;
      sheet.style.top = `${capture.box.top}px`;
      sheet.style.width = `${capture.box.width}px`;
      sheet.style.height = `${capture.box.height}px`;

      spread.append(sheet);
      // animationend does not fire when the tab is hidden, so clean up anyway.
      win.setTimeout(() => sheet.remove(), TURN_DURATION_MS + 120);
    }

    function renderSpread(direction = 0) {
      if (!currentZine) {
        return;
      }

      const spreads = currentSpreads();
      const activeIndex = spreadIndexForPage(spreads, currentPage);
      const activeSpread = spreads[activeIndex] || [];
      currentPage = activeSpread[0] || 1;

      const capture = captureTurningSheet(direction);
      removeTurningSheet();

      const images = activeSpread
        .map((number) => pageByNumber(number))
        .filter(Boolean)
        .map((page) => buildPageImage(page, "zine-page"));

      spread.replaceChildren(...images);
      spread.dataset.pages = String(images.length);
      playTurn(capture);

      if (progress) {
        progress.textContent = progressLabel(activeSpread, currentZine.pages.length);
      }

      prevButton.disabled = activeIndex <= 0;
      nextButton.disabled = activeIndex >= spreads.length - 1;

      const nextSpread = spreads[activeIndex + 1];
      if (nextSpread) {
        preloadSpread(nextSpread);
      }
    }

    function move(step) {
      if (!currentZine) {
        return;
      }

      const spreads = currentSpreads();
      const activeIndex = spreadIndexForPage(spreads, currentPage);
      const nextIndex = Math.min(Math.max(activeIndex + step, 0), spreads.length - 1);
      if (nextIndex === activeIndex) {
        return;
      }

      currentPage = spreads[nextIndex][0];
      renderSpread(nextIndex > activeIndex ? 1 : -1);
    }

    function buildCard(zine) {
      const item = global.document.createElement("li");
      item.className = "zine-card";

      const link = global.document.createElement("a");
      link.className = "zine-card-link";
      link.setAttribute("href", `#/fanzines/${encodeURIComponent(zine.slug)}`);

      const cover = buildPageImage(zine.pages[0], "zine-card-cover");
      cover.setAttribute("loading", "lazy");

      const caption = global.document.createElement("span");
      caption.className = "zine-card-title";
      caption.textContent = zine.title;

      link.append(cover, caption);
      item.append(link);
      return item;
    }

    function renderIndex() {
      if (!grid) {
        return;
      }

      grid.replaceChildren(...zines.map(buildCard));
      if (status) {
        status.hidden = zines.length > 0;
        if (!zines.length) {
          status.textContent = "No hay fanzines todavía.";
        }
      }
    }

    function load() {
      if (!loadPromise) {
        loadPromise = fetchZines(fetchFn)
          .then((nextZines) => {
            zines = nextZines;
            renderIndex();
            return zines;
          })
          .catch(() => {
            zines = [];
            if (status) {
              status.hidden = false;
              status.textContent = "No se pudieron cargar los fanzines.";
            }
            return zines;
          });
      }

      return loadPromise;
    }

    function showIndex() {
      currentZine = null;
      index.hidden = false;
      reader.hidden = true;
      spread.replaceChildren();
    }

    function openZine(slug) {
      const zine = zines.find((candidate) => candidate.slug === slug);
      if (!zine) {
        showIndex();
        return false;
      }

      currentZine = zine;
      currentPage = 1;
      index.hidden = true;
      reader.hidden = false;

      if (downloadLink) {
        downloadLink.hidden = !zine.printableUrl;
        if (zine.printableUrl) {
          downloadLink.setAttribute("href", zine.printableUrl);
          downloadLink.setAttribute("download", `${zine.slug}.pdf`);
        }
      }

      syncLayoutButton();
      renderSpread();
      return true;
    }

    // The router owns the URL, so entering the section just replays it here.
    function show(slug) {
      return load().then(() => {
        if (slug) {
          return openZine(slug);
        }

        showIndex();
        return true;
      });
    }

    function handleKey(event) {
      if (!currentZine) {
        return;
      }

      if (event.key === "ArrowLeft") {
        move(-1);
      }

      if (event.key === "ArrowRight") {
        move(1);
      }
    }

    function init() {
      prevButton.addEventListener("click", () => move(-1));
      nextButton.addEventListener("click", () => move(1));

      if (layoutButton) {
        layoutButton.addEventListener("click", toggleLayout);
      }
      syncLayoutButton();
    }

    return {
      handleKey,
      init,
      isReading: () => Boolean(currentZine),
      show,
    };
  }

  global.ManturonZines = {
    buildSpreads,
    createZines,
    fetchZines,
    normalizeZine,
    progressLabel,
    spreadIndexForPage,
  };
})(globalThis);
