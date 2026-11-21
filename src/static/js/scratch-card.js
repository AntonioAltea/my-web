// Scratch-card reveal for the /peliculas random pick: the poster comes covered
// in silver foil, like a lottery ticket, and you scratch it off with the
// mouse or a finger. Flakes of foil fall where you scratch and a soft
// scratching sound follows your speed. Once enough is gone, the rest fades
// and the details show. The foil is drawn without the poster, so reading how
// much is left never touches a cross-origin image. Pure helpers are exposed
// for the tests.
(function (global) {
  const SCRATCH = { brush: 0.11, cells: 12, doneAt: 0.6, fadeMs: 450 };

  // Coverage on a coarse grid: a cell counts as scratched once the brush
  // passes over its centre.
  function coverageGrid(w, h, cols = SCRATCH.cells) {
    const rows = Math.max(1, Math.round((cols * h) / w));
    const cleared = new Uint8Array(cols * rows);
    let count = 0;
    return {
      cols,
      rows,
      mark(x, y, radius) {
        const top = Math.max(0, Math.floor(((y - radius) / h) * rows));
        const bottom = Math.min(rows - 1, Math.floor(((y + radius) / h) * rows));
        const left = Math.max(0, Math.floor(((x - radius) / w) * cols));
        const right = Math.min(cols - 1, Math.floor(((x + radius) / w) * cols));
        for (let cy = top; cy <= bottom; cy += 1) {
          for (let cx = left; cx <= right; cx += 1) {
            const mx = ((cx + 0.5) * w) / cols;
            const my = ((cy + 0.5) * h) / rows;
            const i = cy * cols + cx;
            if (!cleared[i] && Math.hypot(mx - x, my - y) <= radius) {
              cleared[i] = 1;
              count += 1;
            }
          }
        }
      },
      fraction() {
        return count / cleared.length;
      },
    };
  }

  // Points along a stroke, close enough that a fast swipe leaves no gaps.
  function strokePoints(from, to, spacing) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    const points = [];
    for (let i = 1; i <= steps; i += 1) {
      points.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    }
    return points;
  }

  // Brushed silver, a dashed printed frame, small stars round the edge and
  // "RASCA" in the middle.
  function paintFoil(g, w, h) {
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#b9bdc3");
    base.addColorStop(0.3, "#e4e7ea");
    base.addColorStop(0.5, "#a9adb3");
    base.addColorStop(0.72, "#dfe2e6");
    base.addColorStop(1, "#9ea2a8");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 0.5;
    for (let i = 0; i < h * 1.5; i += 1) {
      const y = Math.random() * h;
      const tone = Math.random() < 0.5 ? "255,255,255" : "60,64,70";
      g.strokeStyle = `rgba(${tone},${0.05 + Math.random() * 0.08})`;
      g.beginPath();
      g.moveTo(Math.random() * w * 0.3, y);
      g.lineTo(w * (0.7 + Math.random() * 0.3), y);
      g.stroke();
    }
    for (let i = 0; i < (w * h) / 40; i += 1) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    const inset = Math.round(w * 0.06);
    g.strokeStyle = "rgba(70,74,80,0.45)";
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.strokeRect(inset + 0.5, inset + 0.5, w - inset * 2 - 1, h - inset * 2 - 1);
    g.setLineDash([]);
    g.fillStyle = "rgba(70,74,80,0.55)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-0.12);
    g.font = `600 ${Math.round(w * 0.15)}px Literata, Georgia, serif`;
    g.fillText("RASCA", 0, -w * 0.06);
    g.font = `italic ${Math.round(w * 0.075)}px Literata, Georgia, serif`;
    g.fillText("y descubre la película", 0, w * 0.1);
    g.restore();
    g.font = `${Math.round(w * 0.06)}px Georgia, serif`;
    g.fillStyle = "rgba(70,74,80,0.35)";
    const step = w * 0.12;
    for (let x = inset + step / 2; x < w - inset; x += step) {
      g.fillText("✦", x, inset / 2 + 1);
      g.fillText("✦", x, h - inset / 2);
    }
  }

  // Flakes of foil, on one fixed canvas over the page, falling with gravity.
  function flakeLayer() {
    const canvas = document.createElement("canvas");
    canvas.className = "movies-scratch-flakes";
    canvas.setAttribute("aria-hidden", "true");
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    let flakes = [];
    let raf = 0;
    let last = 0;
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const scale = global.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      flakes = flakes.filter((flake) => flake.life < 0.9);
      for (const flake of flakes) {
        flake.life += dt;
        flake.vy += 900 * dt;
        flake.x += flake.vx * dt;
        flake.y += flake.vy * dt;
        flake.rot += flake.vr * dt;
        ctx.save();
        ctx.globalAlpha = 1 - flake.life / 0.9;
        ctx.translate(flake.x, flake.y);
        ctx.rotate(flake.rot);
        ctx.scale(1, Math.abs(Math.cos(flake.rot * 1.7)) + 0.2);
        ctx.fillStyle = `rgb(${flake.shade},${flake.shade + 3},${flake.shade + 8})`;
        ctx.fillRect(-flake.size, -flake.size / 2, flake.size * 2, flake.size);
        ctx.restore();
      }
      raf = flakes.length ? global.requestAnimationFrame(step) : 0;
    };
    return {
      spawn(x, y, count) {
        for (let i = 0; i < count; i += 1) {
          flakes.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 90,
            vy: -20 - Math.random() * 60,
            size: 1 + Math.random() * 2.2,
            rot: Math.random() * 6,
            vr: (Math.random() - 0.5) * 14,
            shade: Math.round(150 + Math.random() * 90),
            life: 0,
          });
        }
        if (!raf) {
          last = performance.now();
          raf = global.requestAnimationFrame(step);
        }
      },
      // Lets the last flakes land, then goes.
      remove() {
        global.setTimeout(() => {
          global.cancelAnimationFrame(raf);
          canvas.remove();
        }, 900);
      },
    };
  }

  // Band-passed noise whose loudness follows how fast you scratch; opened on
  // the first touch of the foil, since browsers need a gesture for sound.
  function scratchSound() {
    let audio = null;
    let gain = null;
    return {
      start() {
        if (audio) return;
        try {
          const Context = global.AudioContext || global.webkitAudioContext;
          if (!Context) return;
          audio = new Context();
          const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i += 1) {
            data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.3);
          }
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const band = audio.createBiquadFilter();
          band.type = "bandpass";
          band.frequency.value = 3200;
          band.Q.value = 0.8;
          gain = audio.createGain();
          gain.gain.value = 0;
          source.connect(band).connect(gain).connect(audio.destination);
          source.start();
        } catch {
          audio = null;
          gain = null;
        }
      },
      speed(pixelsPerSecond) {
        if (!gain) return;
        gain.gain.setTargetAtTime(Math.min(0.18, pixelsPerSecond * 0.0009), audio.currentTime, 0.03);
      },
      stop() {
        if (!audio) return;
        gain.gain.setTargetAtTime(0, audio.currentTime, 0.05);
        const closing = audio;
        audio = null;
        gain = null;
        global.setTimeout(() => closing.close().catch(() => {}), 400);
      },
    };
  }

  // Covers `poster` (an element in `card`) with foil and waits for scratching.
  // Options:
  //   hint: element shown beside the poster meanwhile (it may hold a button
  //     with data-uncover that takes the foil off at once)
  //   alive(): false once another pick takes over, which ends it at once
  //   onDone(): over; the foil may still be fading
  function cover(card, poster, options = {}) {
    const w = poster.offsetWidth;
    const h = poster.offsetHeight;
    const scale = global.devicePixelRatio || 1;
    const foil = document.createElement("canvas");
    foil.className = "movies-scratch-foil";
    foil.width = Math.round(w * scale);
    foil.height = Math.round(h * scale);
    foil.style.left = `${poster.offsetLeft}px`;
    foil.style.top = `${poster.offsetTop}px`;
    foil.style.width = `${w}px`;
    foil.style.height = `${h}px`;
    const g = foil.getContext("2d");
    g.scale(scale, scale);
    paintFoil(g, w, h);
    card.append(foil);
    const hint = options.hint || null;
    if (hint) card.append(hint);

    const grid = coverageGrid(w, h);
    const brush = Math.max(9, w * SCRATCH.brush);
    const flakes = flakeLayer();
    const sound = scratchSound();
    let lastPoint = null;
    let lastTime = 0;
    let finished = false;
    let down = false;

    const scratchTo = (x, y, time) => {
      const from = lastPoint || { x, y };
      g.globalCompositeOperation = "destination-out";
      for (const point of strokePoints(from, { x, y }, brush * 0.25)) {
        // A slightly ragged round brush, like a coin edge.
        g.beginPath();
        for (let k = 0; k < 10; k += 1) {
          const angle = (k / 10) * Math.PI * 2;
          const r = (brush / 2) * (0.82 + Math.random() * 0.25);
          const px = point.x + Math.cos(angle) * r;
          const py = point.y + Math.sin(angle) * r;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.fill();
        grid.mark(point.x, point.y, brush * 0.8);
      }
      g.globalCompositeOperation = "source-over";
      const dist = Math.hypot(x - from.x, y - from.y);
      sound.speed(lastTime ? (dist / Math.max(1, time - lastTime)) * 1000 : 0);
      if (dist > 1.5) {
        const box = foil.getBoundingClientRect();
        flakes.spawn(box.left + x, box.top + y, Math.min(4, Math.ceil(dist / 6)));
      }
      lastPoint = { x, y };
      lastTime = time;
      if (grid.fraction() >= SCRATCH.doneAt) finish(false);
    };

    const local = (event) => {
      const box = foil.getBoundingClientRect();
      // The foil may be drawn at a different size than its box (zoom).
      return [((event.clientX - box.left) * w) / box.width, ((event.clientY - box.top) * h) / box.height];
    };

    const onDown = (event) => {
      if (finished) return;
      if (options.alive && !options.alive()) {
        finish(true);
        return;
      }
      event.preventDefault();
      down = true;
      lastPoint = null;
      lastTime = 0;
      if (foil.setPointerCapture) foil.setPointerCapture(event.pointerId);
      sound.start();
      scratchTo(...local(event), event.timeStamp);
    };
    const onMove = (event) => {
      if (!down || finished) return;
      const coalesced = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
      for (const each of coalesced.length ? coalesced : [event]) {
        if (finished) break;
        scratchTo(...local(each), each.timeStamp);
      }
    };
    const onUp = () => {
      down = false;
      lastPoint = null;
      sound.speed(0);
    };
    foil.addEventListener("pointerdown", onDown);
    foil.addEventListener("pointermove", onMove);
    foil.addEventListener("pointerup", onUp);
    foil.addEventListener("pointercancel", onUp);
    const uncover = hint && hint.querySelector("[data-uncover]");
    if (uncover) uncover.addEventListener("click", () => finish(false));
    // A redraw or a new pick can take the card away under us.
    const watch = global.setInterval(() => {
      if (!foil.isConnected || (options.alive && !options.alive())) finish(true);
    }, 400);

    function finish(instant) {
      if (finished) return;
      finished = true;
      global.clearInterval(watch);
      sound.stop();
      flakes.remove();
      if (hint) hint.remove();
      if (instant) {
        foil.remove();
      } else {
        // What's left of the foil fades off; the poster was there all along.
        foil.classList.add("movies-scratch-gone");
        global.setTimeout(() => foil.remove(), SCRATCH.fadeMs + 50);
      }
      if (options.onDone) options.onDone();
    }
    return () => finish(true);
  }

  global.ManturonScratchCard = { SCRATCH, coverageGrid, strokePoints, cover };
})(globalThis);
