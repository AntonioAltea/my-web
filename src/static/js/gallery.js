(function (global) {
  function randomIndex(length) {
    if (length <= 0) {
      return 0;
    }

    return Math.floor(Math.random() * length);
  }

  function createGallery({
    mainPhoto,
    photoLoader,
    photoCaption,
    prevButton,
    nextButton,
    randomButton,
    onLayoutChange,
  }) {
    let photos = [];
    let currentPhotoIndex = 0;
    let photoControlsLocked = false;
    let photoLoadRequestId = 0;
    let preloadedRandomPhotoIndex = null;
    const photoCache = new Map();

    function syncPhotoControls() {
      const hasPhotos = photos.length > 0;
      const canNavigate = hasPhotos && photos.length > 1 && !photoControlsLocked;

      prevButton.disabled = !canNavigate;
      nextButton.disabled = !canNavigate;
      randomButton.disabled = !canNavigate;
    }

    function ensurePhotoResource(file) {
      if (!file) {
        return null;
      }

      const existingResource = photoCache.get(file);
      if (existingResource) {
        return existingResource;
      }

      const image = new Image();
      const resource = {
        image,
        listeners: new Set(),
        status: "loading",
      };

      image.onload = () => {
        resource.status = "loaded";
        for (const listener of resource.listeners) {
          listener("loaded");
        }
        resource.listeners.clear();
      };
      image.onerror = () => {
        resource.status = "error";
        for (const listener of resource.listeners) {
          listener("error");
        }
        resource.listeners.clear();
      };
      image.src = file;
      photoCache.set(file, resource);
      return resource;
    }

    function watchPhotoResource(resource, onLoad, onError) {
      if (!resource) {
        onError();
        return;
      }

      if (resource.status === "loaded") {
        onLoad();
        return;
      }

      if (resource.status === "error") {
        onError();
        return;
      }

      resource.listeners.add((status) => {
        if (status === "loaded") {
          onLoad();
          return;
        }

        onError();
      });
    }

    function preloadPhoto(file) {
      ensurePhotoResource(file);
    }

    function selectableRandomPhotoIndices() {
      return photos
        .map((_, index) => index)
        .filter((index) => index !== currentPhotoIndex);
    }

    function chooseRandomPhotoIndex(candidates = selectableRandomPhotoIndices()) {
      if (!candidates.length) {
        return currentPhotoIndex;
      }

      return candidates[randomIndex(candidates.length)];
    }

    function preloadNearbyPhotos() {
      if (photos.length <= 1) {
        preloadedRandomPhotoIndex = null;
        return;
      }

      const nextIndices = new Set([
        (currentPhotoIndex - 1 + photos.length) % photos.length,
        (currentPhotoIndex + 1) % photos.length,
      ]);
      const randomCandidates = photos
        .map((_, index) => index)
        .filter((index) => index !== currentPhotoIndex && !nextIndices.has(index));

      if (randomCandidates.length) {
        const randomCandidateIndex = chooseRandomPhotoIndex(randomCandidates);
        preloadedRandomPhotoIndex = randomCandidateIndex;
        nextIndices.add(randomCandidateIndex);
      } else {
        preloadedRandomPhotoIndex = null;
      }

      for (const index of nextIndices) {
        preloadPhoto(photos[index]?.file);
      }
    }

    function finishPhotoUpdate(requestId, photo) {
      if (requestId !== photoLoadRequestId) {
        return;
      }

      mainPhoto.alt = photo.title;
      photoCaption.textContent = photo.title;
      mainPhoto.src = photo.file;
      mainPhoto.hidden = false;
      photoLoader.hidden = true;
      photoControlsLocked = false;
      syncPhotoControls();
      onLayoutChange();
    }

    function prunePhotoCache() {
      const activeFiles = new Set(photos.map((photo) => photo.file));
      for (const file of photoCache.keys()) {
        if (!activeFiles.has(file)) {
          photoCache.delete(file);
        }
      }

      if (
        preloadedRandomPhotoIndex !== null
        && (preloadedRandomPhotoIndex < 0 || preloadedRandomPhotoIndex >= photos.length)
      ) {
        preloadedRandomPhotoIndex = null;
      }
    }

    function failPhotoUpdate(requestId) {
      if (requestId !== photoLoadRequestId) {
        return;
      }

      photoLoader.hidden = true;
      photoCaption.textContent = "No se pudo cargar la foto.";
      photoCaption.classList.remove("photo-caption-visible");
      photoControlsLocked = false;
      syncPhotoControls();
    }

    function updatePhoto() {
      if (!photos.length) {
        mainPhoto.hidden = true;
        mainPhoto.removeAttribute("src");
        mainPhoto.alt = "";
        photoCaption.textContent = "No hay fotos todavia.";
        photoCaption.classList.remove("photo-caption-visible");
        photoControlsLocked = false;
        syncPhotoControls();
        photoLoader.hidden = true;
        return;
      }

      const photo = photos[currentPhotoIndex];
      const hasDisplayedPhoto = !mainPhoto.hidden && Boolean(mainPhoto.src);
      const requestId = photoLoadRequestId + 1;
      const resource = ensurePhotoResource(photo.file);

      photoLoadRequestId = requestId;
      photoControlsLocked = true;
      syncPhotoControls();
      photoLoader.hidden = false;
      photoCaption.classList.remove("photo-caption-visible");
      if (!hasDisplayedPhoto) {
        mainPhoto.hidden = true;
      }

      watchPhotoResource(resource, () => {
        finishPhotoUpdate(requestId, photo);
      }, () => {
        failPhotoUpdate(requestId);
      });
      preloadNearbyPhotos();
    }

    function movePhoto(step) {
      if (!photos.length) {
        return;
      }

      currentPhotoIndex = (currentPhotoIndex + step + photos.length) % photos.length;
      updatePhoto();
    }

    function showRandomPhoto() {
      if (photos.length <= 1) {
        return;
      }

      const randomCandidates = selectableRandomPhotoIndices();
      currentPhotoIndex = randomCandidates.includes(preloadedRandomPhotoIndex)
        ? preloadedRandomPhotoIndex
        : chooseRandomPhotoIndex(randomCandidates);
      preloadedRandomPhotoIndex = null;
      updatePhoto();
    }

    function getPhotoFiles() {
      return photos.map((photo) => photo.file);
    }

    function setPhotos(nextPhotos) {
      const currentPhotoFile = photos[currentPhotoIndex]?.file ?? null;

      photos = nextPhotos;
      prunePhotoCache();
      const matchingPhotoIndex = currentPhotoFile
        ? photos.findIndex((photo) => photo.file === currentPhotoFile)
        : -1;
      currentPhotoIndex = matchingPhotoIndex >= 0 ? matchingPhotoIndex : randomIndex(photos.length);
      updatePhoto();
    }

    function showLoadError() {
      photoLoader.hidden = true;
      photoCaption.textContent = "No se pudieron cargar las fotos.";
      photoCaption.classList.remove("photo-caption-visible");
      prevButton.disabled = true;
      nextButton.disabled = true;
      randomButton.disabled = true;
    }

    function handleKey(event) {
      if (event.key === "ArrowLeft") {
        movePhoto(-1);
      }

      if (event.key === "ArrowRight") {
        movePhoto(1);
      }
    }

    function init() {
      prevButton.addEventListener("click", () => movePhoto(-1));
      nextButton.addEventListener("click", () => movePhoto(1));
      randomButton.addEventListener("click", showRandomPhoto);

      mainPhoto.addEventListener("mouseenter", () => {
        if (!mainPhoto.hidden && photos.length) {
          photoCaption.classList.add("photo-caption-visible");
        }
      });

      mainPhoto.addEventListener("mouseleave", () => {
        photoCaption.classList.remove("photo-caption-visible");
      });
    }

    return {
      getPhotoFiles,
      handleKey,
      init,
      setPhotos,
      showLoadError,
    };
  }

  global.ManturonGallery = {
    createGallery,
  };
})(globalThis);
