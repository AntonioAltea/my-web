(function (global) {
  const ZINES_URL = "/api/zines";
  const TURN_DURATION_MS = 450;
  const TURN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
  const OPEN_DURATION_MS = 320;
  const PRESS_DURATION_MS = 200;
  const TURN_SHADE_OPACITY = 0.4;
  // Gap between stacked leaves, just enough for the browser to sort them.
  const LEAF_DEPTH_PX = 0.5;

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
  function buildSpreads(pageCount) {
    if (pageCount <= 0) {
      return [];
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

  // Each leaf is one sheet of the book, with a page on either side, so turning
  // it shows the next page on its back.
  function buildLeaves(pageCount) {
    const leaves = [];
    for (let page = 1; page <= pageCount; page += 2) {
      leaves.push({ front: page, back: page < pageCount ? page + 1 : null });
    }
    return leaves;
  }

  // A closed booklet sits on one side of its spine, so it slides half a page
  // to stay centred: the cover lies right of the spine, the back cover left.
  // The result is a percentage of the book, which is two pages wide.
  function bookShift(spreads, index) {
    if (index === 0) {
      return -25;
    }

    return index === spreads.length - 1 && spreads[index].length === 1 ? 25 : 0;
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
    downloadLink,
    fetchFn,
    win = global.window,
  }) {
    let zines = [];
    let currentZine = null;
    let currentPage = 1;
    let loadPromise = null;
    let book = null;
    let leaves = [];
    let flippedCount = 0;
    const turningLeaves = new Set();
    const reducedMotionQuery = win.matchMedia
      ? win.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    function currentSpreads() {
      if (!currentZine) {
        return [];
      }

      return buildSpreads(currentZine.pages.length);
    }

    function pageByNumber(number) {
      return currentZine
        ? currentZine.pages.find((page) => page.number === number) || null
        : null;
    }

    function setPageSource(image, page) {
      image.src = page.src;
      if (page.srcset) {
        image.setAttribute("srcset", page.srcset);
      }
      if (page.sizes) {
        image.setAttribute("sizes", page.sizes);
      }
    }

    function buildPageImage(page, className) {
      const image = global.document.createElement("img");
      image.className = className;
      image.alt = "";
      if (page) {
        setPageSource(image, page);
      }
      return image;
    }

    function canAnimate(element) {
      const reduced = reducedMotionQuery && reducedMotionQuery.matches;
      return !reduced && typeof element.animate === "function";
    }

    function buildFace(side, number) {
      const face = global.document.createElement("div");
      face.className = `zine-face zine-face-${side}`;
      // The covers are the outside of the booklet, so they have no gutter.
      if (number && number !== 1 && number !== currentZine.pages.length) {
        face.classList.add("zine-face-inner");
      }

      const shade = global.document.createElement("div");
      shade.className = "zine-shade";

      const image = number ? buildPageImage(null, "zine-page") : null;
      face.append(...(image ? [image, shade] : [shade]));
      return { face, image, number, shade };
    }

    function buildLeaf({ front, back }) {
      const element = global.document.createElement("div");
      element.className = "zine-leaf";

      const faces = [buildFace("front", front), buildFace("back", back)];
      element.append(...faces.map(({ face }) => face));

      return { animations: [], element, faces, timer: null };
    }

    function leafTransform(index, flipped) {
      const stacked = flipped ? index : leaves.length - 1 - index;
      const angle = flipped ? -180 : 0;
      return `translateZ(${stacked * LEAF_DEPTH_PX}px) rotateY(${angle}deg)`;
    }

    function isLeafShowing(index) {
      return (
        index === flippedCount ||
        index === flippedCount - 1 ||
        turningLeaves.has(index - 1) ||
        turningLeaves.has(index) ||
        turningLeaves.has(index + 1)
      );
    }

    function syncLeaves() {
      leaves.forEach((leaf, index) => {
        const flipped = index < flippedCount;
        const { style } = leaf.element;
        style.transform = leafTransform(index, flipped);
        style.visibility = isLeafShowing(index) ? "visible" : "hidden";
        if (turningLeaves.has(index)) {
          style.zIndex = String(leaves.length + 1);
        } else {
          style.zIndex = String(flipped ? index + 1 : leaves.length - index);
        }
      });
    }

    // Only the leaves around the open page fetch their images: the ones you
    // can see, plus the ones a turn either way would uncover.
    function fillNearbyLeaves() {
      const nearby = leaves.slice(Math.max(flippedCount - 2, 0), flippedCount + 2);
      for (const leaf of nearby) {
        for (const { image, number } of leaf.faces) {
          const page = pageByNumber(number);
          if (image && page && !image.src) {
            setPageSource(image, page);
          }
        }
      }
    }

    function syncReader() {
      const spreads = currentSpreads();
      const activeIndex = spreadIndexForPage(spreads, currentPage);
      const activeSpread = spreads[activeIndex] || [];
      currentPage = activeSpread[0] || 1;
      flippedCount = activeIndex;

      spread.dataset.pages = String(activeSpread.length);
      book.style.transform = `translateX(${bookShift(spreads, activeIndex)}%)`;
      syncLeaves();
      fillNearbyLeaves();

      if (progress) {
        progress.textContent = progressLabel(activeSpread, currentZine.pages.length);
      }

      prevButton.disabled = activeIndex <= 0;
      nextButton.disabled = activeIndex >= spreads.length - 1;
    }

    function clearBook() {
      for (const leaf of leaves) {
        win.clearTimeout(leaf.timer);
      }
      turningLeaves.clear();
      leaves = [];
      book = null;
    }

    function renderBook() {
      clearBook();
      leaves = buildLeaves(currentZine.pages.length).map(buildLeaf);

      book = global.document.createElement("div");
      book.className = "zine-book";
      book.append(...leaves.map(({ element }) => element));

      spread.replaceChildren(book);
      syncReader();
    }

    // The leaf already holds its final transform; these animations only play
    // the way there, so a tab that never runs them still ends up correct.
    function playTurn(index, forward, shiftBefore, shiftAfter) {
      const leaf = leaves[index];
      if (!canAnimate(leaf.element)) {
        return;
      }

      const timing = { duration: TURN_DURATION_MS, easing: TURN_EASING };
      win.clearTimeout(leaf.timer);
      leaf.animations.forEach((animation) => animation.cancel());

      turningLeaves.add(index);
      syncLeaves();

      leaf.animations = [
        leaf.element.animate(
          [
            { transform: leafTransform(index, !forward) },
            { transform: leafTransform(index, forward) },
          ],
          timing,
        ),
        ...leaf.faces.map(({ shade }) =>
          shade.animate(
            [
              { opacity: 0 },
              { offset: 0.5, opacity: TURN_SHADE_OPACITY },
              { opacity: 0 },
            ],
            timing,
          ),
        ),
      ];

      if (shiftBefore !== shiftAfter) {
        book.animate(
          [
            { transform: `translateX(${shiftBefore}%)` },
            { transform: `translateX(${shiftAfter}%)` },
          ],
          timing,
        );
      }

      // animationend does not fire when the tab is hidden, so use a timer.
      leaf.timer = win.setTimeout(() => {
        turningLeaves.delete(index);
        syncLeaves();
      }, TURN_DURATION_MS + 120);
    }

    function playPress(button) {
      if (canAnimate(button)) {
        button.animate([{ transform: "scale(0.94)" }, { transform: "none" }], {
          duration: PRESS_DURATION_MS,
          easing: TURN_EASING,
        });
      }
    }

    function playOpen() {
      if (canAnimate(spread)) {
        spread.animate(
          [
            { opacity: 0, transform: "translateY(16px) scale(0.94)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: OPEN_DURATION_MS, easing: TURN_EASING },
        );
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
      syncReader();
      playPress(step > 0 ? nextButton : prevButton);
      playTurn(
        Math.min(activeIndex, nextIndex),
        nextIndex > activeIndex,
        bookShift(spreads, activeIndex),
        bookShift(spreads, nextIndex),
      );
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
      clearBook();
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

      renderBook();
      playOpen();
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
    }

    return {
      handleKey,
      init,
      isReading: () => Boolean(currentZine),
      show,
    };
  }

  global.ManturonZines = {
    bookShift,
    buildLeaves,
    buildSpreads,
    createZines,
    fetchZines,
    normalizeZine,
    progressLabel,
    spreadIndexForPage,
  };
})(globalThis);
