(function (global) {
  function fileNameToTitle(filePath) {
    const fileName = filePath.split("/").pop() || filePath;
    const withoutExtension = fileName.replace(/\.[^.]+$/, "");
    return withoutExtension.replace(/[_-]+/g, " ");
  }

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => item === right[index]);
  }

  async function fetchMediaPayload(fetchFn) {
    const response = await fetchFn(`/api/media?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  global.ManturonMediaApi = {
    arraysEqual,
    fetchMediaPayload,
    fileNameToTitle,
  };
})(globalThis);
