(function (global) {
  // The channel's uploads playlist ("UU" + the channel id without "UC") lists
  // the newest upload first, so embedding it always opens on the latest video
  // without the server having to read the channel feed.
  const LATEST_VIDEO_SRC =
    "https://www.youtube-nocookie.com/embed/videoseries?list=UUVjNdPxE-IB14UBWkS5Glww";

  function createMusic({ albumGrid, latestVideo, onSelectAlbum }) {
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
    function showLatestVideo() {
      if (latestVideo && !latestVideo.src) {
        latestVideo.src = LATEST_VIDEO_SRC;
      }
    }

    return {
      renderAlbums,
      showLatestVideo,
    };
  }

  global.ManturonMusic = {
    LATEST_VIDEO_SRC,
    createMusic,
  };
})(globalThis);
