(function (global) {
  function formatTrackNumber(index) {
    return String(index + 1).padStart(2, "0");
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

  function createPlayer({
    audioPlayer,
    nowPlaying,
    prevButton,
    randomButton,
    nextButton,
    playButton,
    trackPosition,
    trackListToggle,
    albumDrawer,
    trackListShell,
    trackList,
    seekBar,
    seekBarShell,
    currentTimeLabel,
    totalTimeLabel,
    onLayoutChange,
    onTrackPlay = () => {},
  }) {
    let tracks = [];
    let trackCursor = 0;
    let isSeeking = false;
    let nowPlayingAnimationTimer = null;
    let isTrackListOpen = false;
    let layoutSyncTimer = null;
    let lastTrackedPlayFile = null;

    function currentTrack() {
      if (!tracks.length) {
        return null;
      }

      return tracks[trackCursor];
    }

    function currentTrackFile() {
      const track = currentTrack();
      return track ? track.file : null;
    }

    function updateTrackListSelection() {
      const buttons = trackList.querySelectorAll("button");
      buttons.forEach((button, index) => {
        const isCurrent = index === trackCursor;
        button.classList.toggle("track-list-button-current", isCurrent);
        button.setAttribute("aria-current", isCurrent ? "true" : "false");
      });
    }

    function updateTrackListScrollCue() {
      const canScroll = trackList.scrollHeight > trackList.clientHeight + 1;
      const atTop = trackList.scrollTop <= 1;
      const atBottom = trackList.scrollTop + trackList.clientHeight >= trackList.scrollHeight - 1;
      trackListShell.classList.toggle("track-list-scrollable", canScroll);
      trackListShell.classList.toggle("track-list-scroll-up", canScroll && !atTop);
      trackListShell.classList.toggle("track-list-scroll-down", canScroll && !atBottom);
    }

    function scheduleLayoutSync() {
      onLayoutChange();
      updateTrackListScrollCue();

      if (layoutSyncTimer !== null) {
        global.window.clearTimeout(layoutSyncTimer);
      }

      layoutSyncTimer = global.window.setTimeout(() => {
        onLayoutChange();
        updateTrackListScrollCue();
        layoutSyncTimer = null;
      }, 240);
    }

    function syncTrackListVisibility() {
      const hasTracks = tracks.length > 0;
      albumDrawer.hidden = !hasTracks;
      albumDrawer.dataset.state = isTrackListOpen ? "open" : "closed";
      albumDrawer.setAttribute("aria-hidden", isTrackListOpen ? "false" : "true");
      if (isTrackListOpen) {
        trackList.scrollTop = 0;
      }
      trackListToggle.disabled = !hasTracks;
      trackListToggle.textContent = isTrackListOpen ? "ocultar canciones" : "ver canciones";
      trackListToggle.setAttribute("aria-expanded", isTrackListOpen ? "true" : "false");
      scheduleLayoutSync();
    }

    function renderTrackList() {
      trackList.replaceChildren();

      tracks.forEach((track, index) => {
        const item = document.createElement("li");
        item.className = "track-list-item";

        const button = document.createElement("button");
        button.className = "track-list-button";
        button.type = "button";
        button.setAttribute("aria-label", `Reproducir ${track.title}`);
        button.dataset.index = String(index);

        const number = document.createElement("span");
        number.className = "track-list-number";
        number.textContent = formatTrackNumber(index);

        const title = document.createElement("span");
        title.className = "track-list-title";
        title.textContent = track.title;

        button.append(number, title);
        button.addEventListener("click", () => {
          trackCursor = index;
          loadCurrentTrack({ autoplay: true });
        });

        item.append(button);
        trackList.append(item);
      });

      updateTrackListSelection();
      updateTrackListScrollCue();
      syncTrackListVisibility();
    }

    function updatePlayButton() {
      playButton.dataset.state = audioPlayer.paused ? "paused" : "playing";
      playButton.setAttribute("aria-label", audioPlayer.paused ? "Reproducir" : "Pausar");
      seekBarShell.classList.toggle("seek-bar-shell-playing", !audioPlayer.paused);
      onLayoutChange();
    }

    function setNowPlayingText(nextTitle, direction = "none") {
      if (nowPlayingAnimationTimer !== null) {
        global.window.clearTimeout(nowPlayingAnimationTimer);
        nowPlayingAnimationTimer = null;
      }

      nowPlaying.classList.remove("now-playing-enter-next", "now-playing-enter-prev");
      nowPlaying.textContent = nextTitle;

      if (direction === "next" || direction === "prev") {
        const className = direction === "next" ? "now-playing-enter-next" : "now-playing-enter-prev";
        void nowPlaying.offsetWidth;
        nowPlaying.classList.add(className);
        nowPlayingAnimationTimer = global.window.setTimeout(() => {
          nowPlaying.classList.remove(className);
          nowPlayingAnimationTimer = null;
        }, 220);
      }
    }

    function loadCurrentTrack({ autoplay = false, direction = "none" } = {}) {
      const track = currentTrack();
      if (!track) {
        setNowPlayingText("No hay canciones en assets/music");
        trackPosition.textContent = "tema --";
        audioPlayer.removeAttribute("src");
        playButton.disabled = true;
        prevButton.disabled = true;
        randomButton.disabled = true;
        nextButton.disabled = true;
        seekBar.value = "0";
        currentTimeLabel.textContent = "0:00";
        totalTimeLabel.textContent = "0:00";
        seekBarShell.style.setProperty("--seek-progress", "0%");
        trackList.replaceChildren();
        isTrackListOpen = false;
        syncTrackListVisibility();
        updatePlayButton();
        return;
      }

      audioPlayer.src = track.file;
      trackPosition.textContent = `tema ${formatTrackNumber(trackCursor)}`;
      setNowPlayingText(track.title, direction);
      playButton.disabled = false;
      prevButton.disabled = false;
      randomButton.disabled = tracks.length < 2;
      nextButton.disabled = false;
      seekBar.value = "0";
      currentTimeLabel.textContent = "0:00";
      totalTimeLabel.textContent = "0:00";
      seekBarShell.style.setProperty("--seek-progress", "0%");
      updateTrackListSelection();

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

      trackCursor = (trackCursor + step + tracks.length) % tracks.length;
      loadCurrentTrack({ autoplay, direction: step > 0 ? "next" : "prev" });
    }

    function playRandomTrack() {
      if (tracks.length < 2) {
        return;
      }

      const candidateIndices = tracks
        .map((_, index) => index)
        .filter((index) => index !== trackCursor);
      const randomIndex = Math.floor(Math.random() * candidateIndices.length);
      trackCursor = candidateIndices[randomIndex];
      loadCurrentTrack({ autoplay: true });
    }

    function updateProgress() {
      if (isSeeking) {
        return;
      }

      const duration = audioPlayer.duration || 0;
      const currentTime = audioPlayer.currentTime || 0;
      const progress = duration ? (currentTime / duration) * 100 : 0;
      seekBar.value = String(progress);
      seekBarShell.style.setProperty("--seek-progress", `${progress}%`);
      currentTimeLabel.textContent = formatTime(currentTime);
      totalTimeLabel.textContent = formatTime(duration);
    }

    function getTrackFiles() {
      return tracks.map((track) => track.file);
    }

    function setTracks(nextTracks) {
      const currentTrackPath = currentTrackFile();

      tracks = nextTracks;
      renderTrackList();

      if (!tracks.length) {
        trackCursor = 0;
        loadCurrentTrack();
        return;
      }

      const matchingTrackIndex = currentTrackPath
        ? tracks.findIndex((track) => track.file === currentTrackPath)
        : -1;

      if (matchingTrackIndex >= 0) {
        trackCursor = matchingTrackIndex;
      } else {
        trackCursor = 0;
      }

      syncTrackListVisibility();
      loadCurrentTrack();
    }

    function showLoadError() {
      setNowPlayingText("Arranca la web con python3 -m src.server");
      trackPosition.textContent = "tema --";
      playButton.disabled = true;
      prevButton.disabled = true;
      randomButton.disabled = true;
      nextButton.disabled = true;
      trackListToggle.disabled = true;
      isTrackListOpen = false;
      syncTrackListVisibility();
    }

    function handleKey(event) {
      if (event.code === "Space") {
        event.preventDefault();
        playButton.click();
      }
    }

    function init() {
      prevButton.addEventListener("click", () => stepTrack(-1));
      randomButton.addEventListener("click", playRandomTrack);
      nextButton.addEventListener("click", () => stepTrack(1));
      trackListToggle.addEventListener("click", () => {
        if (!tracks.length) {
          return;
        }

        isTrackListOpen = !isTrackListOpen;
        syncTrackListVisibility();
      });
      trackList.addEventListener("scroll", updateTrackListScrollCue);

      playButton.addEventListener("click", async () => {
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
        seekBarShell.style.setProperty("--seek-progress", `${seekBar.value}%`);
        currentTimeLabel.textContent = formatTime(nextTime);
      });

      seekBar.addEventListener("change", () => {
        const duration = audioPlayer.duration || 0;
        audioPlayer.currentTime = (Number(seekBar.value) / 100) * duration;
        seekBarShell.style.setProperty("--seek-progress", `${seekBar.value}%`);
        isSeeking = false;
      });

      audioPlayer.addEventListener("loadedmetadata", updateProgress);
      audioPlayer.addEventListener("timeupdate", updateProgress);
      audioPlayer.addEventListener("play", () => {
        const track = currentTrack();
        const currentTime = audioPlayer.currentTime || 0;
        if (track && (lastTrackedPlayFile !== track.file || currentTime < 1)) {
          lastTrackedPlayFile = track.file;
          onTrackPlay(track);
        }

        updatePlayButton();
      });
      audioPlayer.addEventListener("pause", updatePlayButton);
      audioPlayer.addEventListener("ended", () => stepTrack(1, true));
      albumDrawer.addEventListener("transitionend", (event) => {
        if (event.target !== albumDrawer) {
          return;
        }

        onLayoutChange();
        updateTrackListScrollCue();
      });

      updatePlayButton();
      syncTrackListVisibility();
    }

    return {
      getTrackFiles,
      handleKey,
      init,
      setTracks,
      showLoadError,
    };
  }

  global.ManturonPlayer = {
    createPlayer,
  };
})(globalThis);
