(function (global) {
  function fileNameToTitle(filePath) {
    const fileName = filePath.split("/").pop() || filePath;
    const withoutExtension = fileName.replace(/\.[^.]+$/, "");
    return withoutExtension.replace(/[_-]+/g, " ");
  }

  function normalizeTrack(track) {
    if (typeof track === "string") {
      return {
        file: track,
        title: fileNameToTitle(track),
        trackNumber: null,
      };
    }

    if (!track || typeof track.file !== "string") {
      return null;
    }

    return {
      file: track.file,
      title:
        typeof track.title === "string" && track.title.trim()
          ? track.title
          : fileNameToTitle(track.file),
      trackNumber: Number.isInteger(track.track_number) ? track.track_number : null,
    };
  }

  function compareTracks(left, right) {
    const leftHasTrackNumber = Number.isInteger(left.trackNumber) && left.trackNumber > 0;
    const rightHasTrackNumber = Number.isInteger(right.trackNumber) && right.trackNumber > 0;

    if (leftHasTrackNumber && rightHasTrackNumber && left.trackNumber !== right.trackNumber) {
      return left.trackNumber - right.trackNumber;
    }

    if (leftHasTrackNumber !== rightHasTrackNumber) {
      return leftHasTrackNumber ? -1 : 1;
    }

    return left.file.localeCompare(right.file);
  }

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => item === right[index]);
  }

  function normalizePhoto(photo) {
    if (typeof photo === "string") {
      return {
        file: photo,
        sizes: "",
        srcset: "",
      };
    }

    if (!photo || typeof photo.src !== "string") {
      return null;
    }

    return {
      file: photo.src,
      sizes: typeof photo.sizes === "string" ? photo.sizes : "",
      srcset: typeof photo.srcset === "string" ? photo.srcset : "",
    };
  }

  async function fetchMediaPayload(fetchFn) {
    const response = await fetchFn(`/api/media?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const photos = Array.isArray(payload.photos)
      ? payload.photos.map(normalizePhoto).filter(Boolean)
      : [];
    const music = Array.isArray(payload.music)
      ? payload.music.map(normalizeTrack).filter(Boolean)
      : [];
    music.sort(compareTracks);

    return {
      photos,
      music,
    };
  }

  global.ManturonMediaApi = {
    arraysEqual,
    fetchMediaPayload,
    fileNameToTitle,
    normalizePhoto,
    normalizeTrack,
  };
})(globalThis);
