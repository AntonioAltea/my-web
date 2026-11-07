(function (global) {
  // One hand-picked video ("donde debo estar"); new uploads do not replace it.
  const FEATURED_VIDEO_SRC =
    "https://www.youtube-nocookie.com/embed/gtOw5XbuhFg";

  function createMusic({ albumGrid, featuredVideo, onSelectAlbum }) {
    function buildAlbumCard(album) {
      const item = global.document.createElement("li");
      item.className = "album-card";

      const button = global.document.createElement("button");
      button.type = "button";
      button.className = "album-card-button";
      button.setAttribute("aria-label", `Escuchar ${album.title}`);
      button.addEventListener("click", () => {
        if (typeof onSelectAlbum === "function") {
          onSelectAlbum(album.id);
        }
      });

      const cover = global.document.createElement("img");
      cover.className = "album-card-cover";
      cover.src = album.cover;
      cover.alt = "";
      cover.setAttribute("loading", "lazy");

      const caption = global.document.createElement("span");
      caption.className = "album-card-title";
      caption.textContent = album.title;

      button.append(cover, caption);
      item.append(button);
      return item;
    }

    function renderAlbums(albums) {
      if (!albumGrid) {
        return;
      }

      albumGrid.replaceChildren(...albums.map(buildAlbumCard));
    }

    // Like the photos, the video only loads the first time the section opens.
    function showFeaturedVideo() {
      if (featuredVideo && !featuredVideo.src) {
        featuredVideo.src = FEATURED_VIDEO_SRC;
      }
    }

    return {
      renderAlbums,
      showFeaturedVideo,
    };
  }

  global.ManturonMusic = {
    FEATURED_VIDEO_SRC,
    createMusic,
  };
})(globalThis);
