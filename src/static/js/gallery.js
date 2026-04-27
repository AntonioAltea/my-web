(function (global) {
  const PHOTO_LOAD_TIMEOUT_MS = 12000;

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
    const photoCache = new Map();

    function photoRequestSrc(file, attempt) {
      if (attempt <= 0) {
        return file;
      }

      const separator = file.includes("?") ? "&" : "?";
      return `${file}${separator}manturon-photo-retry=${attempt}`;
    }

    function photoRequestSrcset(srcset, attempt) {
      if (attempt <= 0 || !srcset) {
        return srcset;
      }

      return srcset
        .split(",")
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .map((candidate) => {
          const separatorIndex = candidate.lastIndexOf(" ");
          if (separatorIndex < 0) {
            return photoRequestSrc(candidate, attempt);
          }

          const url = candidate.slice(0, separatorIndex);
          const descriptor = candidate.slice(separatorIndex + 1);
          return `${photoRequestSrc(url, attempt)} ${descriptor}`;
        })
        .join(", ");
    }

    function detachPhotoImage(image, { clearSrc = false } = {}) {
      if (!image) {
        return;
      }

      image.onload = null;
      image.onerror = null;
      if (clearSrc) {
        image.src = "";
      }
    }

    function clearPhotoResourceTimeout(resource) {
      if (resource?.timeoutId == null) {
        return;
      }

      global.clearTimeout(resource.timeoutId);
      resource.timeoutId = null;
    }

    function abortPhotoResourceLoad(resource) {
      if (!resource) {
        return;
      }

      clearPhotoResourceTimeout(resource);
      detachPhotoImage(resource.image, { clearSrc: true });
      resource.image = null;
      resource.listeners.clear();
      if (resource.status === "loading") {
        resource.status = "idle";
      }
    }

    function notifyPhotoResource(resource, status) {
      for (const listener of resource.listeners) {
        listener(status);
      }
      resource.listeners.clear();
    }

    function finalizePhotoResource(resource, image, status) {
      if (resource.image !== image || resource.status !== "loading") {
        return;
      }

      clearPhotoResourceTimeout(resource);
      resource.status = status;
      if (status === "loaded") {
        resource.loadedSrc = image.currentSrc || image.src;
      } else {
        detachPhotoImage(image, { clearSrc: true });
        resource.image = null;
      }
      notifyPhotoResource(resource, status);
    }

    function startPhotoResourceLoad(resource) {
      abortPhotoResourceLoad(resource);

      resource.attempt += 1;
      resource.status = "loading";

      const image = new Image();
      const requestSrc = photoRequestSrc(resource.file, resource.attempt - 1);
      const requestSrcset = photoRequestSrcset(resource.srcset, resource.attempt - 1);

      image.decoding = "async";
      image.fetchPriority = "high";
      if (requestSrcset) {
        image.srcset = requestSrcset;
      }
      if (resource.sizes) {
        image.sizes = resource.sizes;
      }
      resource.image = image;
      image.onload = () => {
        finalizePhotoResource(resource, image, "loaded");
      };
      image.onerror = () => {
        finalizePhotoResource(resource, image, "error");
      };
      resource.timeoutId = global.setTimeout(() => {
        finalizePhotoResource(resource, image, "error");
      }, PHOTO_LOAD_TIMEOUT_MS);
      image.src = requestSrc;
    }

    function syncPhotoControls() {
      const hasPhotos = photos.length > 0;
      const canNavigate = hasPhotos && photos.length > 1 && !photoControlsLocked;

      prevButton.disabled = !canNavigate;
      nextButton.disabled = !canNavigate;
      randomButton.disabled = !canNavigate;
    }

    function ensurePhotoResource(photo, { retryOnError = false } = {}) {
      const file = photo?.file;
      if (!file) {
        return null;
      }

      const existingResource = photoCache.get(file);
      if (existingResource) {
        existingResource.sizes = photo.sizes || "";
        existingResource.srcset = photo.srcset || "";
        if (retryOnError && existingResource.status === "error") {
          startPhotoResourceLoad(existingResource);
        }
        return existingResource;
      }

      const resource = {
        attempt: 0,
        file,
        image: null,
        listeners: new Set(),
        loadedSrc: file,
        sizes: photo.sizes || "",
        srcset: photo.srcset || "",
        status: "idle",
        timeoutId: null,
      };

      photoCache.set(file, resource);
      startPhotoResourceLoad(resource);
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

    function finishPhotoUpdate(requestId, photo, resource) {
      if (requestId !== photoLoadRequestId) {
        return;
      }

      mainPhoto.alt = photo.title;
      photoCaption.textContent = photo.title;
      mainPhoto.src = resource?.loadedSrc || photo.file;
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
          abortPhotoResourceLoad(photoCache.get(file));
          photoCache.delete(file);
        }
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
      const resource = ensurePhotoResource(photo, { retryOnError: true });

      photoLoadRequestId = requestId;
      photoControlsLocked = true;
      syncPhotoControls();
      photoLoader.hidden = false;
      photoCaption.classList.remove("photo-caption-visible");
      if (!hasDisplayedPhoto) {
        mainPhoto.hidden = true;
      }

      watchPhotoResource(resource, () => {
        finishPhotoUpdate(requestId, photo, resource);
      }, () => {
        failPhotoUpdate(requestId);
      });
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

      currentPhotoIndex = chooseRandomPhotoIndex();
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
