(function (global) {
  const THEME_STORAGE_KEY = "manturon-theme";

  function createThemeController({ button, label }) {
    const themePreference = global.window.matchMedia("(prefers-color-scheme: dark)");

    function storedThemePreference() {
      const savedTheme = global.window.localStorage.getItem(THEME_STORAGE_KEY);
      return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "auto";
    }

    function effectiveTheme() {
      const storedTheme = storedThemePreference();
      if (storedTheme === "light" || storedTheme === "dark") {
        return storedTheme;
      }

      return themePreference.matches ? "dark" : "light";
    }

    function sync() {
      if (!button || !label) {
        return;
      }

      const storedTheme = storedThemePreference();
      const nextTheme = storedTheme === "auto"
        ? "dark"
        : storedTheme === "dark"
          ? "light"
          : "auto";
      const nextLabel = nextTheme === "auto"
        ? "tema automatico"
        : nextTheme === "dark"
          ? "oscuro"
          : "claro";
      const currentLabel = storedTheme === "auto"
        ? "automatico"
        : storedTheme === "dark"
          ? "oscuro"
          : "claro";

      label.textContent = storedTheme === "auto" ? "auto" : currentLabel;
      button.setAttribute("aria-label", `Tema ${currentLabel}. Cambiar a ${nextLabel}`);
      button.setAttribute("aria-pressed", String(effectiveTheme() === "dark"));
      button.dataset.themeMode = storedTheme;
    }

    function setTheme(theme) {
      if (theme === "light" || theme === "dark") {
        global.document.documentElement.dataset.theme = theme;
        global.window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } else {
        delete global.document.documentElement.dataset.theme;
        global.window.localStorage.removeItem(THEME_STORAGE_KEY);
      }
      sync();
    }

    function cycleTheme() {
      const storedTheme = storedThemePreference();
      const nextTheme = storedTheme === "auto"
        ? "dark"
        : storedTheme === "dark"
          ? "light"
          : "auto";
      setTheme(nextTheme);
    }

    function init() {
      button?.addEventListener("click", cycleTheme);
      themePreference.addEventListener("change", sync);
      sync();
    }

    return {
      init,
    };
  }

  global.ManturonTheme = {
    createThemeController,
  };
})(globalThis);
