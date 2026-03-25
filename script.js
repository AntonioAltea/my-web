const audioPlayer = document.querySelector("#audio-player");
const nowPlaying = document.querySelector("#now-playing");
const mainPhoto = document.querySelector("#main-photo");
const photoLoader = document.querySelector("#photo-loader");
const photoCaption = document.querySelector("#photo-caption");
const photoCounter = document.querySelector("#photo-counter");
const prevPhotoButton = document.querySelector("#prev-photo");
const nextPhotoButton = document.querySelector("#next-photo");
const photoRandomButton = document.querySelector("#photo-random");
const prevTrackButton = document.querySelector("#prev-track");
const nextTrackButton = document.querySelector("#next-track");
const playToggleButton = document.querySelector("#play-toggle");
const playToggleIcon = document.querySelector("#play-toggle-icon");
const seekBar = document.querySelector("#seek-bar");
const currentTimeLabel = document.querySelector("#current-time");
const totalTimeLabel = document.querySelector("#total-time");

let tracks = [];
let photos = [];
let currentPhotoIndex = 0;
let shuffledTrackOrder = [];
let trackCursor = 0;
let isSeeking = false;
let mediaPollTimer = null;

function fileNameToTitle(filePath) {
  const fileName = filePath.split("/").pop() || filePath;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[_-]+/g, " ");
}

function shuffleIndices(length) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function randomIndex(length) {
  if (length <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * length);
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function currentTrack() {
  if (!tracks.length || !shuffledTrackOrder.length) {
    return null;
  }

  const trackIndex = shuffledTrackOrder[trackCursor];
  return tracks[trackIndex];
}

function currentTrackFile() {
  const track = currentTrack();
  return track ? track.file : null;
}

function updatePlayButton() {
  playToggleIcon.className = audioPlayer.paused ? "icon-play" : "icon-pause";
  playToggleButton.setAttribute("aria-label", audioPlayer.paused ? "Reproducir" : "Pausar");
}

function loadCurrentTrack({ autoplay = false } = {}) {
  const track = currentTrack();
  if (!track) {
    nowPlaying.textContent = "No hay canciones en assets/music";
    audioPlayer.removeAttribute("src");
    playToggleButton.disabled = true;
    prevTrackButton.disabled = true;
    nextTrackButton.disabled = true;
    seekBar.value = "0";
    currentTimeLabel.textContent = "0:00";
    totalTimeLabel.textContent = "0:00";
    updatePlayButton();
    return;
  }

  audioPlayer.src = track.file;
  nowPlaying.textContent = track.title;
  playToggleButton.disabled = false;
  prevTrackButton.disabled = tracks.length <= 1;
  nextTrackButton.disabled = tracks.length <= 1;
  seekBar.value = "0";
  currentTimeLabel.textContent = "0:00";
  totalTimeLabel.textContent = "0:00";

  if (autoplay) {
    audioPlayer.play().catch(() => {
      updatePlayButton();
    });
  }

  updatePlayButton();
}

function stepTrack(step, autoplay = true) {
  if (!tracks.length) {
    return;
  }

  trackCursor = (trackCursor + step + shuffledTrackOrder.length) % shuffledTrackOrder.length;
  loadCurrentTrack({ autoplay });
}

function updatePhoto() {
  if (!photos.length) {
    mainPhoto.hidden = true;
    mainPhoto.removeAttribute("src");
    mainPhoto.alt = "";
    photoCaption.textContent = "No hay fotos todavia.";
    photoCounter.textContent = "0 / 0";
    prevPhotoButton.disabled = true;
    nextPhotoButton.disabled = true;
    photoRandomButton.disabled = true;
    photoLoader.hidden = true;
    return;
  }

  prevPhotoButton.disabled = photos.length <= 1;
  nextPhotoButton.disabled = photos.length <= 1;
  photoRandomButton.disabled = photos.length <= 1;

  const photo = photos[currentPhotoIndex];
  photoLoader.hidden = false;
  mainPhoto.alt = photo.title;
  photoCaption.textContent = photo.title;
  photoCounter.textContent = `${currentPhotoIndex + 1} / ${photos.length}`;
  mainPhoto.hidden = true;
  mainPhoto.src = photo.file;
}

function movePhoto(step) {
  if (!photos.length) {
    return;
  }

  currentPhotoIndex = (currentPhotoIndex + step + photos.length) % photos.length;
  updatePhoto();
}

function updateProgress() {
  if (isSeeking) {
    return;
  }

  const duration = audioPlayer.duration || 0;
  const currentTime = audioPlayer.currentTime || 0;
  const progress = duration ? (currentTime / duration) * 100 : 0;
  seekBar.value = String(progress);
  currentTimeLabel.textContent = formatTime(currentTime);
  totalTimeLabel.textContent = formatTime(duration);
}

async function loadMedia() {
  let media;

  try {
    const response = await fetch(`/api/media?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    media = await response.json();
  } catch (error) {
    nowPlaying.textContent = "Arranca la web con python3 server.py";
    photoCaption.textContent = "No se pudieron cargar las fotos.";
    photoCounter.textContent = "0 / 0";
    prevPhotoButton.disabled = true;
    nextPhotoButton.disabled = true;
    playToggleButton.disabled = true;
    prevTrackButton.disabled = true;
    nextTrackButton.disabled = true;
    return;
  }

  const nextTracks = media.music.map((file) => ({
    file,
    title: fileNameToTitle(file),
  }));
  const nextPhotos = media.photos.map((file) => ({
    file,
    title: fileNameToTitle(file),
  }));
  const currentPhotoFile = photos[currentPhotoIndex]?.file ?? null;
  const currentTrackPath = currentTrackFile();
  const tracksChanged = !arraysEqual(
    tracks.map((track) => track.file),
    nextTracks.map((track) => track.file),
  );
  const photosChanged = !arraysEqual(
    photos.map((photo) => photo.file),
    nextPhotos.map((photo) => photo.file),
  );

  if (!tracksChanged && !photosChanged) {
    return;
  }

  if (photosChanged) {
    photos = nextPhotos;
    const matchingPhotoIndex = currentPhotoFile
      ? photos.findIndex((photo) => photo.file === currentPhotoFile)
      : -1;
    currentPhotoIndex = matchingPhotoIndex >= 0 ? matchingPhotoIndex : randomIndex(photos.length);
    updatePhoto();
  }

  if (tracksChanged) {
    tracks = nextTracks;
    shuffledTrackOrder = shuffleIndices(tracks.length);

    if (!tracks.length) {
      trackCursor = 0;
      loadCurrentTrack();
      return;
    }

    const matchingTrackIndex = currentTrackPath
      ? tracks.findIndex((track) => track.file === currentTrackPath)
      : -1;

    if (matchingTrackIndex >= 0) {
      const shuffledIndex = shuffledTrackOrder.indexOf(matchingTrackIndex);
      trackCursor = shuffledIndex >= 0 ? shuffledIndex : 0;
    } else {
      trackCursor = randomIndex(shuffledTrackOrder.length);
    }

    loadCurrentTrack();
  }
}

function startMediaPolling() {
  if (mediaPollTimer !== null) {
    window.clearInterval(mediaPollTimer);
  }

  mediaPollTimer = window.setInterval(() => {
    loadMedia();
  }, 15000);
}

prevPhotoButton.addEventListener("click", () => movePhoto(-1));
nextPhotoButton.addEventListener("click", () => movePhoto(1));
photoRandomButton.addEventListener("click", () => {
  if (photos.length <= 1) {
    return;
  }

  let nextIndex = currentPhotoIndex;
  while (nextIndex === currentPhotoIndex) {
    nextIndex = Math.floor(Math.random() * photos.length);
  }

  currentPhotoIndex = nextIndex;
  updatePhoto();
});
prevTrackButton.addEventListener("click", () => stepTrack(-1));
nextTrackButton.addEventListener("click", () => stepTrack(1));

playToggleButton.addEventListener("click", async () => {
  if (!tracks.length) {
    return;
  }

  if (audioPlayer.src) {
    if (audioPlayer.paused) {
      await audioPlayer.play().catch(() => {});
    } else {
      audioPlayer.pause();
    }
  } else {
    loadCurrentTrack({ autoplay: true });
  }

  updatePlayButton();
});

seekBar.addEventListener("input", () => {
  isSeeking = true;
  const duration = audioPlayer.duration || 0;
  const nextTime = (Number(seekBar.value) / 100) * duration;
  currentTimeLabel.textContent = formatTime(nextTime);
});

seekBar.addEventListener("change", () => {
  const duration = audioPlayer.duration || 0;
  audioPlayer.currentTime = (Number(seekBar.value) / 100) * duration;
  isSeeking = false;
});

audioPlayer.addEventListener("loadedmetadata", updateProgress);
audioPlayer.addEventListener("timeupdate", updateProgress);
audioPlayer.addEventListener("play", updatePlayButton);
audioPlayer.addEventListener("pause", updatePlayButton);
audioPlayer.addEventListener("ended", () => stepTrack(1, true));
mainPhoto.addEventListener("load", () => {
  mainPhoto.hidden = false;
  photoLoader.hidden = true;
});
mainPhoto.addEventListener("error", () => {
  photoLoader.hidden = true;
  photoCaption.textContent = "No se pudo cargar la foto.";
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.key === "ArrowLeft") {
    movePhoto(-1);
  }

  if (event.key === "ArrowRight") {
    movePhoto(1);
  }

  if (event.code === "Space") {
    event.preventDefault();
    playToggleButton.click();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadMedia();
  }
});

window.addEventListener("focus", () => {
  loadMedia();
});

loadMedia();
startMediaPolling();
