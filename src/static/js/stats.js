(function () {
  const visits = document.querySelector("#stats-visits");
  const playStarts = document.querySelector("#stats-play-starts");
  const sessionsWithMusic = document.querySelector("#stats-sessions-with-music");
  const topTracks = document.querySelector("#stats-top-tracks");
  const updated = document.querySelector("#stats-updated");
  const debug = document.querySelector("#stats-debug");

  function formatNumber(value) {
    return new Intl.NumberFormat("es-ES").format(value || 0);
  }

  function renderTopTracks(items) {
    renderList(topTracks, items, {
      emptyText: "Todavía no hay reproducciones.",
      toText(track) {
        return `${track.title} · ${formatNumber(track.play_starts)}`;
      },
    });
  }

  function renderList(root, items, { emptyText, toText }) {
    root.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("li");
      empty.textContent = emptyText;
      root.append(empty);
      return;
    }

    items.forEach((itemData) => {
      const item = document.createElement("li");
      item.textContent = toText(itemData);
      root.append(item);
    });
  }

  async function loadStats() {
    try {
      const response = await fetch(`/api/activity/summary?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("stats request failed");
      }

      const data = await response.json();
      visits.textContent = formatNumber(data.totals.visits);
      playStarts.textContent = formatNumber(data.totals.play_starts);
      sessionsWithMusic.textContent = formatNumber(data.totals.sessions_with_music);
      renderTopTracks(data.top_tracks || []);
      debug.hidden = true;
      debug.textContent = "";

      const timestamp = data.generated_at ? new Date(data.generated_at) : null;
      updated.textContent = timestamp && !Number.isNaN(timestamp.getTime())
        ? `actualizado ${timestamp.toLocaleString("es-ES")}`
        : "datos cargados";
    } catch {
      updated.textContent = "no se pudo cargar la analítica";
      debug.hidden = false;
      debug.textContent = "si usas un bloqueador, prueba a desactivarlo para esta web";
    }
  }

  loadStats();
})();
