(function (global) {
  const ALBUM_STORAGE_KEY = "manturon-album";
  const ALBUMS_URL = "/static/data/albums.json";

  function findAlbum(albums, id) {
    return albums.find((album) => album.id === id) || albums[0];
  }

  function embedSrc(albumId, theme) {
    const { bgcol, linkcol } =
      theme === "dark"
        ? { bgcol: "141414", linkcol: "88b5a0" }
        : { bgcol: "eef0ee", linkcol: "2f5f4d" };
    return (
      `https://bandcamp.com/EmbeddedPlayer/album=${albumId}/size=large/` +
      `bgcol=${bgcol}/linkcol=${linkcol}/tracklist=false/artwork=small/transparent=true/`
    );
  }

  async function fetchAlbums(fetchFn) {
    try {
      const response = await fetchFn(ALBUMS_URL);
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return Array.isArray(payload) ? payload : [];
    } catch (error) {
      return [];
    }
  }

  function createBandcampPlayer({ iframe, loader, toggleButton, toggleCurrent, list }) {
    let theme = "light";
    let albums = [];
    let album = null;
    let isOpen = false;
    let tiles = [];

    function renderIframe() {
      if (!album) {
        return;
      }

      const nextSrc = embedSrc(album.id, theme);
      if (iframe.src !== nextSrc) {
        if (loader) {
          loader.hidden = false;
        }
        iframe.src = nextSrc;
      }
    }

    function syncToggle() {
      if (!album) {
        return;
      }

      toggleCurrent.textContent = album.title;
      toggleButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
      list.hidden = false;
      list.dataset.state = isOpen ? "open" : "closed";
      list.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }

    function syncSelection() {
      tiles.forEach(({ button, data }) => {
        const isCurrent = album && data.id === album.id;
        button.classList.toggle("album-tile-select-current", isCurrent);
        button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
      });
    }

    function setTheme(nextTheme) {
      theme = nextTheme === "dark" ? "dark" : "light";
      renderIframe();
    }

    function selectAlbum(id) {
      album = findAlbum(albums, id);
      global.window.localStorage.setItem(ALBUM_STORAGE_KEY, album.id);
      isOpen = false;
      renderIframe();
      syncToggle();
      syncSelection();
    }

    function toggleOpen() {
      isOpen = !isOpen;
      syncToggle();
    }

    function buildTile(candidate) {
      const item = global.document.createElement("li");
      item.className = "album-list-item";

      const tile = global.document.createElement("div");
      tile.className = "album-tile";

      const art = global.document.createElement("img");
      art.className = "album-tile-art";
      art.src = candidate.cover;
      art.alt = "";
      art.setAttribute("loading", "lazy");

      const button = global.document.createElement("button");
      button.type = "button";
      button.className = "album-tile-select";
      button.setAttribute("aria-label", `Elegir el álbum ${candidate.title}`);
      button.addEventListener("click", () => selectAlbum(candidate.id));

      const caption = global.document.createElement("span");
      caption.className = "album-tile-caption";
      caption.textContent = candidate.title;
      button.append(caption);

      tile.append(art, button);
      item.append(tile);

      return { item, button, data: candidate };
    }

    function init(nextAlbums) {
      albums = nextAlbums;
      if (!albums.length) {
        return;
      }

      album = findAlbum(albums, global.window.localStorage.getItem(ALBUM_STORAGE_KEY));
      tiles = albums.map(buildTile);
      list.replaceChildren(...tiles.map((tile) => tile.item));

      toggleButton.addEventListener("click", toggleOpen);

      if (loader) {
        iframe.addEventListener("load", () => {
          loader.hidden = true;
        });
      }

      syncToggle();
      syncSelection();
      renderIframe();
    }

    return {
      init,
      selectAlbum,
      setTheme,
    };
  }

  global.ManturonBandcamp = {
    createBandcampPlayer,
    fetchAlbums,
  };
})(globalThis);
