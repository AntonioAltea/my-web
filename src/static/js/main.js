const mediaApi = globalThis.ManturonMediaApi;
const analyticsModule = globalThis.ManturonAnalytics;
const theme = globalThis.ManturonTheme;
const routerModule = globalThis.ManturonRouter;
const galleryModule = globalThis.ManturonGallery;
const musicModule = globalThis.ManturonMusic;
const zinesModule = globalThis.ManturonZines;
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
const bandcampCover = document.querySelector("#bandcamp-cover");
const albumToggle = document.querySelector("#album-toggle");
const albumToggleCurrent = document.querySelector("#album-toggle-current");
const albumList = document.querySelector("#album-list");
const playerBar = document.querySelector(".player-bar");
const backLink = document.querySelector("#back-link");
const albumGrid = document.querySelector("#album-grid");
const zineGrid = document.querySelector("#zine-grid");
const zineStatus = document.querySelector("#zine-status");
const zineIndex = document.querySelector("#zine-index");
const zineReader = document.querySelector("#zine-reader");
const zineSpread = document.querySelector("#zine-spread");
const zinePrevButton = document.querySelector("#zine-prev");
const zineNextButton = document.querySelector("#zine-next");
const zineProgress = document.querySelector("#zine-progress");
const zineLayoutButton = document.querySelector("#zine-layout");
const zineDownloadLink = document.querySelector("#zine-download");

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
  cover: bandcampCover,
  loader: bandcampLoader,
  toggleButton: albumToggle,
  toggleCurrent: albumToggleCurrent,
  list: albumList,
});

const music = musicModule.createMusic({
  albumGrid,
  onSelectAlbum: (albumId) => bandcamp.selectAlbum(albumId),
});

const zines = zinesModule.createZines({
  grid: zineGrid,
  status: zineStatus,
  index: zineIndex,
  reader: zineReader,
  spread: zineSpread,
  prevButton: zinePrevButton,
  nextButton: zineNextButton,
  progress: zineProgress,
  layoutButton: zineLayoutButton,
  downloadLink: zineDownloadLink,
  fetchFn: fetch,
});

const themeController = theme.createThemeController({
  button: themeToggleButton,
  label: themeToggleLabel,
  onChange: bandcamp.setTheme,
});

const router = routerModule.createRouter({
  views: {
    inicio: document.querySelector("#view-inicio"),
    fotos: document.querySelector("#view-fotos"),
    musica: document.querySelector("#view-musica"),
    fanzines: document.querySelector("#view-fanzines"),
  },
  backLink,
  onChange: (next) => {
    if (next.route === "fotos") {
      loadMedia();
    }

    if (next.route === "fanzines") {
      zines.show(next.param);
    }

    syncPlayerBarHeight();
  },
});

let photosRequested = false;

async function loadMedia() {
  let media;

  try {
    media = await mediaApi.fetchMediaPayload(fetch);
  } catch (error) {
    gallery.showLoadError();
    return;
  }

  photosRequested = true;

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

function refreshMediaIfShowing() {
  if (photosRequested && router.getRoute().route === "fotos") {
    loadMedia();
  }
}

gallery.init();
zines.init();
themeController.init();
analytics.trackVisit();
bandcampModule.fetchAlbums(fetch).then((albums) => {
  bandcamp.init(albums);
  music.renderAlbums(albums);
});
router.init();

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  const { route } = router.getRoute();
  if (route === "fotos") {
    gallery.handleKey(event);
  }

  if (route === "fanzines") {
    zines.handleKey(event);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshMediaIfShowing();
  }
});

window.addEventListener("focus", refreshMediaIfShowing);

window.addEventListener("resize", syncPlayerBarHeight);
window.addEventListener("load", syncPlayerBarHeight);

syncPlayerBarHeight();
