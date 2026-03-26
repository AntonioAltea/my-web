(function (global) {
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
    nextButton,
    playButton,
    seekBar,
    seekBarShell,
    currentTimeLabel,
    totalTimeLabel,
    onLayoutChange,
  }) {
    let tracks = [];
    let shuffledTrackOrder = [];
    let trackCursor = 0;
    let isSeeking = false;
    let nowPlayingAnimationTimer = null;

    function currentTrack() {
      if (!tracks.length || !shuffledTrackOrder.length) {
        return null;
      }

      return tracks[shuffledTrackOrder[trackCursor]];
    }

    function currentTrackFile() {
      const track = currentTrack();
      return track ? track.file : null;
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
        audioPlayer.removeAttribute("src");
        playButton.disabled = true;
        prevButton.disabled = true;
        nextButton.disabled = true;
        seekBar.value = "0";
        currentTimeLabel.textContent = "0:00";
        totalTimeLabel.textContent = "0:00";
        updatePlayButton();
        return;
      }

      audioPlayer.src = track.file;
      setNowPlayingText(track.title, direction);
      playButton.disabled = false;
      prevButton.disabled = tracks.length <= 1;
      nextButton.disabled = tracks.length <= 1;
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
      loadCurrentTrack({ autoplay, direction: step > 0 ? "next" : "prev" });
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

    function showLoadError() {
      setNowPlayingText("Arranca la web con python3 -m src.server");
      playButton.disabled = true;
      prevButton.disabled = true;
      nextButton.disabled = true;
    }

    function handleKey(event) {
      if (event.code === "Space") {
        event.preventDefault();
        playButton.click();
      }
    }

    function init() {
      prevButton.addEventListener("click", () => stepTrack(-1));
      nextButton.addEventListener("click", () => stepTrack(1));

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
      audioPlayer.addEventListener("play", updatePlayButton);
      audioPlayer.addEventListener("pause", updatePlayButton);
      audioPlayer.addEventListener("ended", () => stepTrack(1, true));

      updatePlayButton();
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
