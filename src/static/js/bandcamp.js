(function (global) {
  const ALBUM_ID = "356629898";

  function embedSrc(theme) {
    const bgcol = theme === "dark" ? "1c1c1c" : "f6f7f5";
    const linkcol = theme === "dark" ? "88b5a0" : "2f5f4d";
    return (
      `https://bandcamp.com/EmbeddedPlayer/album=${ALBUM_ID}/size=large/` +
      `bgcol=${bgcol}/linkcol=${linkcol}/tracklist=false/artwork=small/transparent=true/`
    );
  }

  function createBandcampPlayer({ iframe }) {
    function setTheme(theme) {
      const nextSrc = embedSrc(theme === "dark" ? "dark" : "light");
      if (iframe.src !== nextSrc) {
        iframe.src = nextSrc;
      }
    }

    return {
      setTheme,
    };
  }

  global.ManturonBandcamp = {
    createBandcampPlayer,
  };
})(globalThis);
