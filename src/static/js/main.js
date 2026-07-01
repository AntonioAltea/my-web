const mediaApi = globalThis.ManturonMediaApi;
const analyticsModule = globalThis.ManturonAnalytics;
const theme = globalThis.ManturonTheme;
const galleryModule = globalThis.ManturonGallery;
const bandcampModule = globalThis.ManturonBandcamp;

const mainPhoto = document.querySelector("#main-photo");
const photoLoader = document.querySelector("#photo-loader");
const photoCaption = document.querySelector("#photo-caption");
const prevPhotoButton = document.querySelector("#prev-photo");
const nextPhotoButton = document.querySelector("#next-photo");
const photoRandomButton = document.querySelector("#photo-random");
const themeToggleButton = document.querySelector("#theme-toggle");
const themeToggleLabel = document.querySelector("#theme-toggle-label");
const bandcampIframe = document.querySelector("#bandcamp-player");
const bandcampLoader = document.querySelector("#bandcamp-loader");
const albumToggle = document.querySelector("#album-toggle");
const albumToggleCurrent = document.querySelector("#album-toggle-current");
const albumList = document.querySelector("#album-list");
const playerBar = document.querySelector(".player-bar");

function syncPlayerBarHeight() {
  if (!playerBar) {
    return;
  }

  document.documentElement.style.setProperty(
    "--player-bar-height",
    `${playerBar.offsetHeight}px`,
  );
}

if (playerBar && typeof ResizeObserver === "function") {
  const playerBarResizeObserver = new ResizeObserver(() => {
    syncPlayerBarHeight();
  });
  playerBarResizeObserver.observe(playerBar);
}

const analytics = analyticsModule.createAnalyticsController({ fetchImpl: fetch });

const gallery = galleryModule.createGallery({
  mainPhoto,
  photoLoader,
  photoCaption,
  prevButton: prevPhotoButton,
  nextButton: nextPhotoButton,
  randomButton: photoRandomButton,
  onLayoutChange: syncPlayerBarHeight,
});

const bandcamp = bandcampModule.createBandcampPlayer({
  iframe: bandcampIframe,
  loader: bandcampLoader,
  toggleButton: albumToggle,
  toggleCurrent: albumToggleCurrent,
  list: albumList,
});

const themeController = theme.createThemeController({
  button: themeToggleButton,
  label: themeToggleLabel,
  onChange: bandcamp.setTheme,
});

async function loadMedia() {
  let media;

  try {
    media = await mediaApi.fetchMediaPayload(fetch);
  } catch (error) {
    gallery.showLoadError();
    return;
  }

  const nextPhotos = media.photos.map((photo) => ({
    file: photo.file,
    sizes: photo.sizes,
    srcset: photo.srcset,
    title: mediaApi.fileNameToTitle(photo.file),
  }));

  if (!mediaApi.arraysEqual(gallery.getPhotoFiles(), nextPhotos.map((photo) => photo.file))) {
    gallery.setPhotos(nextPhotos);
  }
}

gallery.init();
themeController.init();
analytics.trackVisit();
bandcampModule.fetchAlbums(fetch).then((albums) => bandcamp.init(albums));

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  gallery.handleKey(event);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadMedia();
  }
});

window.addEventListener("focus", () => {
  loadMedia();
});

window.addEventListener("resize", syncPlayerBarHeight);
window.addEventListener("load", syncPlayerBarHeight);

loadMedia();
syncPlayerBarHeight();
