const mediaApi = globalThis.ManturonMediaApi;
const theme = globalThis.ManturonTheme;
const galleryModule = globalThis.ManturonGallery;
const playerModule = globalThis.ManturonPlayer;

const audioPlayer = document.querySelector("#audio-player");
const nowPlaying = document.querySelector("#now-playing");
const mainPhoto = document.querySelector("#main-photo");
const photoLoader = document.querySelector("#photo-loader");
const photoCaption = document.querySelector("#photo-caption");
const prevPhotoButton = document.querySelector("#prev-photo");
const nextPhotoButton = document.querySelector("#next-photo");
const photoRandomButton = document.querySelector("#photo-random");
const themeToggleButton = document.querySelector("#theme-toggle");
const themeToggleLabel = document.querySelector("#theme-toggle-label");
const prevTrackButton = document.querySelector("#prev-track");
const nextTrackButton = document.querySelector("#next-track");
const playToggleButton = document.querySelector("#play-toggle");
const trackPosition = document.querySelector("#track-position");
const trackListToggle = document.querySelector("#track-list-toggle");
const albumDrawer = document.querySelector("#album-drawer");
const trackList = document.querySelector("#track-list");
const seekBar = document.querySelector("#seek-bar");
const seekBarShell = document.querySelector("#seek-bar-shell");
const currentTimeLabel = document.querySelector("#current-time");
const totalTimeLabel = document.querySelector("#total-time");
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

const gallery = galleryModule.createGallery({
  mainPhoto,
  photoLoader,
  photoCaption,
  prevButton: prevPhotoButton,
  nextButton: nextPhotoButton,
  randomButton: photoRandomButton,
  onLayoutChange: syncPlayerBarHeight,
});

const player = playerModule.createPlayer({
  audioPlayer,
  nowPlaying,
  prevButton: prevTrackButton,
  nextButton: nextTrackButton,
  playButton: playToggleButton,
  trackPosition,
  trackListToggle,
  albumDrawer,
  trackList,
  seekBar,
  seekBarShell,
  currentTimeLabel,
  totalTimeLabel,
  onLayoutChange: syncPlayerBarHeight,
});

const themeController = theme.createThemeController({
  button: themeToggleButton,
  label: themeToggleLabel,
});

async function loadMedia() {
  let media;

  try {
    media = await mediaApi.fetchMediaPayload(fetch);
  } catch (error) {
    player.showLoadError();
    gallery.showLoadError();
    return;
  }

  const nextTracks = media.music.map((file) => ({
    file,
    title: mediaApi.fileNameToTitle(file),
  }));
  const nextPhotos = media.photos.map((file) => ({
    file,
    title: mediaApi.fileNameToTitle(file),
  }));

  if (!mediaApi.arraysEqual(player.getTrackFiles(), nextTracks.map((track) => track.file))) {
    player.setTracks(nextTracks);
  }

  if (!mediaApi.arraysEqual(gallery.getPhotoFiles(), nextPhotos.map((photo) => photo.file))) {
    gallery.setPhotos(nextPhotos);
  }
}

gallery.init();
player.init();
themeController.init();

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  gallery.handleKey(event);
  player.handleKey(event);
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
