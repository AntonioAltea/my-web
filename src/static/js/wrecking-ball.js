// Wrecking-ball reveal for the /peliculas random pick: the poster waits
// behind a pane of frosted glass, a steel ball on a chain swings in from the
// top left, hits the pane from the front and shatters it, and the shards fall
// away leaving the poster sharp in its own place. Everything is drawn on one
// fixed canvas over the page, so nothing in the card moves. Sound comes from
// Web Audio, synthesized on the spot. Pure helpers are exposed for the tests.
(function (global) {
  const TIMING = { swingMs: 760, crackMs: 70, afterHitMs: 1700 };

  // Deterministic generator (mulberry32), so a given seed gives the same
  // break pattern; the page seeds it at random.
  function rng(seed) {
    let state = seed | 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function unit(x, y, z) {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  }

  // Sutherland–Hodgman: clip a polygon to an axis-aligned rectangle.
  function clipPoly(poly, rect) {
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    const sides = [
      [(p) => p[0] >= rect.x, (a, b) => [rect.x, a[1] + ((rect.x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
      [(p) => p[0] <= right, (a, b) => [right, a[1] + ((right - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
      [(p) => p[1] >= rect.y, (a, b) => [a[0] + ((rect.y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), rect.y]],
      [(p) => p[1] <= bottom, (a, b) => [a[0] + ((bottom - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), bottom]],
    ];
    let out = poly;
    for (const [inside, cut] of sides) {
      if (!out.length) break;
      const input = out;
      out = [];
      input.forEach((a, i) => {
        const b = input[(i + 1) % input.length];
        if (inside(a)) out.push(a);
        if (inside(a) !== inside(b)) out.push(cut(a, b));
      });
    }
    return out;
  }

  function polyArea(poly) {
    let sum = 0;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      sum += a[0] * b[1] - b[0] * a[1];
    });
    return Math.abs(sum) / 2;
  }

  function splitQuad(quad, random) {
    const t = 0.35 + random() * 0.3;
    const along = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const m1 = along(quad[0], quad[1]);
    const m2 = along(quad[3], quad[2]);
    return [[quad[0], m1, m2, quad[3]], [m1, quad[1], quad[2], m2]];
  }

  // The break: spokes out of the impact point crossed by rings that widen
  // outwards, jittered once per lattice point so neighbouring shards share
  // their edges, and clipped to the pane. The shards tile the pane exactly.
  function makeShards(rect, ix, iy, random) {
    const spokes = 14;
    const angles = [];
    for (let i = 0; i < spokes; i += 1) angles.push(((i + 0.25 + random() * 0.5) / spokes) * Math.PI * 2);
    const far = Math.hypot(rect.w, rect.h) * 1.2 + Math.hypot(ix - rect.x - rect.w / 2, iy - rect.y - rect.h / 2);
    const rings = [0];
    let radius = 6;
    while (radius < far) {
      rings.push(radius);
      radius *= 1.55 + random() * 0.35;
    }
    rings.push(far * 1.5);
    const last = rings.length - 1;
    const lattice = rings.map((ring, ri) => angles.map((angle) => {
      // The outermost ring stays round so it surely encloses the pane.
      const still = ri === 0 || ri === last;
      const r = ring + (still ? 0 : ring * 0.18 * (random() - 0.5));
      const a = angle + (still ? 0 : (random() - 0.5) * 0.12);
      return [ix + Math.cos(a) * r, iy + Math.sin(a) * r];
    }));
    const shards = [];
    for (let ri = 0; ri < last; ri += 1) {
      for (let ai = 0; ai < spokes; ai += 1) {
        const an = (ai + 1) % spokes;
        const cell = ri === 0
          ? [lattice[0][0], lattice[1][ai], lattice[1][an]]
          : [lattice[ri][ai], lattice[ri + 1][ai], lattice[ri + 1][an], lattice[ri][an]];
        // Long outer cells split once more so the edges don't fall as slabs.
        const pieces = ri >= 2 && random() < 0.7 ? splitQuad(cell, random) : [cell];
        for (const piece of pieces) {
          const poly = clipPoly(piece, rect);
          if (poly.length < 3 || polyArea(poly) < 0.01) continue;
          const cx = poly.reduce((sum, p) => sum + p[0], 0) / poly.length;
          const cy = poly.reduce((sum, p) => sum + p[1], 0) / poly.length;
          shards.push({ poly, cx, cy, dist: Math.hypot(cx - ix, cy - iy), r: random(), r2: random(), r3: random() });
        }
      }
    }
    return shards;
  }

  // The swing as a function of time: it falls from theta0 to the bottom of
  // the arc in swingMs (fastest at the bottom, as a pendulum), keeps 45% of
  // its speed through the glass, rises to a small peak and starts back.
  function swingAngle(t, theta0, swingMs) {
    const theta1 = Math.abs(theta0) * 0.28;
    const riseMs = (theta1 / (Math.abs(theta0) * 0.45)) * swingMs;
    if (t <= 0) return theta0;
    if (t < swingMs) return theta0 * Math.cos((Math.PI / 2) * (t / swingMs));
    const u = t - swingMs;
    if (u < riseMs) return theta1 * Math.sin((Math.PI / 2) * (u / riseMs));
    const v = Math.min(1, (u - riseMs) / 900);
    return theta1 * (1 - 0.6 * v * v);
  }

  function riseMs(theta0, swingMs) {
    return ((Math.abs(theta0) * 0.28) / (Math.abs(theta0) * 0.45)) * swingMs;
  }

  // The ball, shaded per pixel once into its own canvas: a key light with a
  // tight highlight, a soft fill, a studio-like environment reflected by
  // Fresnel, some worn-paint grain and a darker underside.
  function renderBall(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d");
    const image = g.createImageData(size, size);
    const r = size / 2;
    const key = unit(-0.55, -0.75, 0.65);
    const fill = unit(0.8, 0.2, 0.5);
    const half = unit(key[0], key[1], key[2] + 1);
    const noise = rng(7);
    const base = [0.11, 0.115, 0.125];
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const x = (px + 0.5 - r) / r;
        const y = (py + 0.5 - r) / r;
        const rr = x * x + y * y;
        const grainDraw = noise();
        if (rr > 1.02) continue;
        const z = Math.sqrt(Math.max(0, 1 - rr));
        const lambert = Math.max(0, x * key[0] + y * key[1] + z * key[2]);
        const lambertFill = Math.max(0, x * fill[0] + y * fill[1] + z * fill[2]);
        const facing = Math.max(0, x * half[0] + y * half[1] + z * half[2]);
        const reflectY = 2 * z * y;
        let env = 0.05;
        if (reflectY < -0.15) env = 0.55 + 0.35 * clamp((-reflectY - 0.15) * 2, 0, 1);
        else if (reflectY < 0.1) env = 0.25;
        const fresnel = 0.06 + 0.94 * (1 - z) ** 4;
        const occlusion = 0.55 + 0.45 * clamp(1 - (y + 0.2) * 0.7, 0, 1);
        const grain = 1 + (grainDraw - 0.5) * 0.12;
        const cover = clamp((1 - Math.sqrt(rr)) * r + 0.5, 0, 1);
        const o = (py * size + px) * 4;
        for (let i = 0; i < 3; i += 1) {
          const value = base[i] * (0.15 + 1.3 * lambert + 0.35 * lambertFill) * occlusion * grain
            + env * fresnel * 0.55 + facing ** 60 * 1.1 + facing ** 8 * 0.08;
          image.data[o + i] = clamp(value ** (1 / 2.2) * 255, 0, 255);
        }
        image.data[o + 3] = cover * 255;
      }
    }
    g.putImageData(image, 0, 0);
    return canvas;
  }

  // Frosted pane: the poster blurred by scaling it down and back up (works in
  // every browser, unlike ctx.filter), hazed, grained and given a sheen. The
  // grain is its own canvas, so a cross-origin poster never needs reading.
  function frostTexture(image, w, h, scale, dark) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext("2d");
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(2, Math.round(w / 14));
    tiny.height = Math.max(2, Math.round(h / 14));
    tiny.getContext("2d").drawImage(image, 0, 0, tiny.width, tiny.height);
    const mid = document.createElement("canvas");
    mid.width = tiny.width * 3;
    mid.height = tiny.height * 3;
    const midCtx = mid.getContext("2d");
    midCtx.imageSmoothingQuality = "high";
    midCtx.drawImage(tiny, 0, 0, mid.width, mid.height);
    g.imageSmoothingQuality = "high";
    g.scale(scale, scale);
    g.drawImage(mid, 0, 0, w, h);
    g.fillStyle = dark ? "rgba(205,214,220,0.6)" : "rgba(238,242,245,0.72)";
    g.fillRect(0, 0, w, h);

    const grain = document.createElement("canvas");
    grain.width = grain.height = 96;
    const grainCtx = grain.getContext("2d");
    const dots = grainCtx.createImageData(96, 96);
    const random = rng(3);
    for (let i = 0; i < dots.data.length; i += 4) {
      const light = random() < 0.5;
      dots.data[i] = dots.data[i + 1] = dots.data[i + 2] = light ? 255 : 0;
      dots.data[i + 3] = random() * 14;
    }
    grainCtx.putImageData(dots, 0, 0);
    g.fillStyle = g.createPattern(grain, "repeat");
    g.fillRect(0, 0, w, h);

    const sheen = g.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.35, "rgba(255,255,255,0.28)");
    sheen.addColorStop(0.42, "rgba(255,255,255,0)");
    sheen.addColorStop(0.55, "rgba(255,255,255,0.12)");
    sheen.addColorStop(0.6, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
    return canvas;
  }

  // Chain: alternating links, one seen face-on, the next edge-on.
  function drawChain(g, x0, y0, x1, y1) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const step = 11;
    g.save();
    g.translate(x0, y0);
    g.rotate(Math.atan2(y1 - y0, x1 - x0));
    const steel = g.createLinearGradient(0, -5, 0, 5);
    steel.addColorStop(0, "#6b6f75");
    steel.addColorStop(0.35, "#d9dde2");
    steel.addColorStop(0.6, "#5c6066");
    steel.addColorStop(1, "#24262a");
    let i = 0;
    for (let s = length; s > -step; s -= step, i += 1) {
      const x = Math.max(0, s);
      if (i % 2 === 0) {
        g.strokeStyle = steel;
        g.lineWidth = 2.4;
        g.beginPath();
        g.ellipse(x, 0, 8, 4.2, 0, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.fillStyle = steel;
        g.fillRect(x - 8, -1.6, 16, 3.2);
      }
    }
    g.restore();
  }

  // Sound: a swish while the ball swings, a thud with the crash of glass on
  // the hit, then small pings as the shards land. The context has to be
  // made inside the click that picked the movie, hence its own function.
  function openAudio() {
    try {
      const Context = global.AudioContext || global.webkitAudioContext;
      if (!Context) return null;
      const audio = new Context();
      if (audio.state === "suspended") audio.resume();
      return audio;
    } catch {
      return null;
    }
  }

  function noiseBuffer(audio, seconds) {
    const buffer = audio.createBuffer(1, Math.round(audio.sampleRate * seconds), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playSmash(audio, hitInSeconds, swingSeconds) {
    if (!audio) return () => {};
    const now = audio.currentTime;
    const hit = now + hitInSeconds;
    const swingFrom = Math.max(now, hit - swingSeconds);
    const out = audio.createGain();
    out.gain.value = 0.8;
    out.connect(audio.destination);
    const sources = [];
    const noise = (seconds) => {
      const source = audio.createBufferSource();
      source.buffer = noiseBuffer(audio, seconds);
      sources.push(source);
      return source;
    };

    const swish = noise(swingSeconds + 0.4);
    const band = audio.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(300, swingFrom);
    band.frequency.exponentialRampToValueAtTime(1400, hit);
    const swishGain = audio.createGain();
    swishGain.gain.setValueAtTime(0.0001, swingFrom);
    swishGain.gain.exponentialRampToValueAtTime(0.25, hit - 0.02);
    swishGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.08);
    swish.connect(band).connect(swishGain).connect(out);
    swish.start(swingFrom);
    swish.stop(hit + 0.2);

    const thud = audio.createOscillator();
    sources.push(thud);
    thud.frequency.setValueAtTime(110, hit);
    thud.frequency.exponentialRampToValueAtTime(38, hit + 0.25);
    const thudGain = audio.createGain();
    thudGain.gain.setValueAtTime(0.9, hit);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.35);
    thud.connect(thudGain).connect(out);
    thud.start(hit);
    thud.stop(hit + 0.4);

    const crash = noise(0.9);
    const high = audio.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2200;
    const crashGain = audio.createGain();
    crashGain.gain.setValueAtTime(0.0001, hit);
    crashGain.gain.exponentialRampToValueAtTime(0.7, hit + 0.005);
    crashGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.7);
    crash.connect(high).connect(crashGain).connect(out);
    crash.start(hit);
    crash.stop(hit + 0.9);

    for (let i = 0; i < 26; i += 1) {
      const at = hit + 0.04 + Math.random() ** 1.8 * 1.1;
      const ping = audio.createOscillator();
      sources.push(ping);
      ping.frequency.value = 2800 + Math.random() * 4200;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.09, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06 + Math.random() * 0.12);
      ping.connect(gain).connect(out);
      ping.start(at);
      ping.stop(at + 0.2);
    }

    // Skipping ahead fades it out quickly; the context closes once quiet.
    return (early) => {
      const at = audio.currentTime;
      if (early) {
        out.gain.cancelScheduledValues(at);
        out.gain.setValueAtTime(out.gain.value, at);
        out.gain.linearRampToValueAtTime(0, at + 0.08);
      }
      global.setTimeout(() => {
        sources.forEach((source) => {
          try {
            source.stop();
          } catch {
            // already stopped
          }
        });
        audio.close().catch(() => {});
      }, early ? 150 : 1500);
    };
  }

  // Runs the whole thing over `poster` (an element in the page), drawing
  // `image` (the loaded poster) behind the glass. Options:
  //   audio: from openAudio(), or null for silence
  //   shake: element nudged on the hit
  //   dark: haze the glass for a dark page
  //   alive(): false once another pick takes over, which ends it at once
  //   onCovered(): the pane is drawn, the real poster can show beneath it
  //   onHit(): the glass broke
  //   onDone(): over, everything removed
  function smash(poster, image, options = {}) {
    const scale = global.devicePixelRatio || 1;
    const stage = document.createElement("canvas");
    stage.className = "movies-smash-stage";
    stage.setAttribute("aria-hidden", "true");
    document.body.append(stage);
    const ctx = stage.getContext("2d");
    let viewW = 0;
    let viewH = 0;
    const fitStage = () => {
      if (stage.clientWidth === viewW && stage.clientHeight === viewH) return;
      viewW = stage.clientWidth;
      viewH = stage.clientHeight;
      stage.width = Math.round(viewW * scale);
      stage.height = Math.round(viewH * scale);
    };
    fitStage();

    const box = poster.getBoundingClientRect();
    const rect = { x: box.left, y: box.top, w: box.width, h: box.height };
    const size = Math.round(clamp(rect.w * 0.62, 70, 110));
    const ball = renderBall(Math.round(size * scale));
    const frost = frostTexture(image, rect.w, rect.h, scale, options.dark);

    // Pendulum hung straight above the pane, off screen; the ball comes in
    // from the top left and is at the bottom of its arc over the pane.
    const ix = rect.x + rect.w / 2;
    const iy = rect.y + rect.h * 0.48;
    const pivotY = Math.min(-160, rect.y - 260);
    const length = iy - pivotY;
    const theta0 = -Math.acos(clamp((-size - pivotY) / length, -1, 1));
    const rise = riseMs(theta0, TIMING.swingMs);
    const lift = (t) => {
      const u = t - TIMING.swingMs - rise;
      return u < 0 ? 0 : (u / 650) ** 2 * (length + size * 2);
    };
    const ballAt = (t) => {
      const angle = swingAngle(t, theta0, TIMING.swingMs);
      const top = pivotY - lift(t);
      return [ix + Math.sin(angle) * length, top + Math.cos(angle) * length, top];
    };

    // The hit: once the ball's leading edge is well over the pane.
    let hitAt = TIMING.swingMs;
    for (let t = 0; t < TIMING.swingMs; t += 2) {
      if (ballAt(t)[0] + size * 0.15 >= rect.x + rect.w * 0.2) {
        hitAt = t;
        break;
      }
    }
    const [hx, hy] = ballAt(hitAt);
    const hitX = clamp(hx + size * 0.1, rect.x + 8, rect.x + rect.w - 8);
    const hitY = clamp(hy, rect.y + 8, rect.y + rect.h - 8);
    const random = rng(Math.floor(Math.random() * 2 ** 31));
    const shards = makeShards(rect, hitX, hitY, random);
    const [ax, ay] = ballAt(hitAt - 8);
    const [bx, by] = ballAt(hitAt + 8);
    const ballVX = ((bx - ax) / 16) * 1000;
    const ballVY = ((by - ay) / 16) * 1000;
    const glints = Array.from({ length: 36 }, () => ({
      angle: random() * Math.PI * 2,
      speed: 120 + random() * 520,
      size: 0.6 + random() * 1.6,
      delay: random() * 60,
    }));
    const endAt = hitAt + TIMING.afterHitMs;
    const hush = playSmash(options.audio, hitAt / 1000, TIMING.swingMs / 1000);

    let hitDone = false;
    let raf = 0;
    let fallback = 0;
    let over = false;
    const finish = (early) => {
      if (over) return;
      over = true;
      global.cancelAnimationFrame(raf);
      global.clearTimeout(fallback);
      stage.remove();
      document.removeEventListener("keydown", onKey);
      if (options.shake) options.shake.style.transform = "";
      hush(early);
      if (!hitDone && options.onHit) options.onHit();
      if (options.onDone) options.onDone();
    };
    const onKey = (event) => {
      if (event.key === "Escape") finish(true);
    };
    stage.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey);

    const drawBall = (t) => {
      const [x, y, top] = ballAt(t);
      // In front of the glass: a touch bigger as it swings in close to us,
      // shrinking to the pane's depth as it hits and on through it.
      const near = t < hitAt
        ? 1 + 0.16 * clamp((hitAt - t) / 500, 0, 1)
        : 1 - 0.07 * clamp((t - hitAt) / 400, 0, 1);
      const r = (size / 2) * near;
      if (y + r < -10) return;
      drawChain(ctx, ix, top, x, y - r * 0.92);
      ctx.fillStyle = "#3a3d42";
      ctx.fillRect(x - r * 0.18, y - r * 1.05, r * 0.36, r * 0.22);
      const [px, py] = ballAt(t - 14);
      if (Math.hypot(x - px, y - py) > 4) {
        for (let k = 3; k >= 1; k -= 1) {
          const [gx, gy] = ballAt(t - k * 9);
          ctx.globalAlpha = (0.12 * (4 - k)) / 3;
          ctx.drawImage(ball, gx - r, gy - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(ball, x - r, y - r, r * 2, r * 2);
    };

    const drawShards = (since) => {
      for (const shard of shards) {
        const u = Math.max(0, (since - TIMING.crackMs - shard.dist * 0.9 - shard.r * 30) / 1000);
        const alpha = clamp(1 - (u - 0.45) / 0.5, 0, 1);
        if (alpha <= 0) continue;
        const near = 1 / (1 + shard.dist / 35);
        const dx = shard.cx - hitX;
        const dy = shard.cy - hitY;
        const dl = Math.hypot(dx, dy) || 1;
        const burst = 180 + 900 * near;
        const vx = (dx / dl) * burst * (0.6 + shard.r2 * 0.6) + ballVX * (0.15 + 0.35 * near);
        const vy = (dy / dl) * burst * (0.5 + shard.r3 * 0.5) + ballVY * 0.2 - 120 * near;
        const flip = Math.cos(u * (4 + shard.r2 * 8)); // tumbling, faked as a squash
        const depth = Math.max(0.35, 1 - u * (0.3 + near * 0.9)); // knocked away from us
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(shard.cx + vx * u, shard.cy + vy * u + 1100 * u * u);
        ctx.rotate((shard.r - 0.5) * 9 * u);
        ctx.scale(depth * (0.35 + 0.65 * Math.abs(flip)), depth);
        ctx.translate(-shard.cx, -shard.cy);
        ctx.beginPath();
        shard.poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.save();
        ctx.clip();
        ctx.drawImage(frost, rect.x, rect.y, rect.w, rect.h);
        if (u > 0) {
          ctx.fillStyle = `rgba(255,255,255,${0.35 * Math.max(0, flip) * Math.min(1, u * 8)})`;
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = u > 0 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.95)";
        ctx.lineWidth = u > 0 ? 0.8 / depth : 0.6;
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#fff";
      for (const glint of glints) {
        const u = (since - TIMING.crackMs - glint.delay) / 1000;
        if (u < 0 || u > 0.7) continue;
        ctx.globalAlpha = (1 - u / 0.7) * 0.9;
        ctx.fillRect(
          hitX + Math.cos(glint.angle) * glint.speed * u + ballVX * 0.2 * u,
          hitY + Math.sin(glint.angle) * glint.speed * u + 1100 * u * u,
          glint.size,
          glint.size,
        );
      }
      ctx.globalAlpha = 1;
      if (since < 120) {
        const k = 1 - since / 120;
        const flash = ctx.createRadialGradient(hitX, hitY, 0, hitX, hitY, 60);
        flash.addColorStop(0, `rgba(255,255,255,${0.7 * k})`);
        flash.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = flash;
        ctx.fillRect(hitX - 60, hitY - 60, 120, 120);
      }
    };

    const frame = (t) => {
      fitStage();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);
      const since = t - hitAt;
      let sx = 0;
      let sy = 0;
      if (since > 0 && since < 260) {
        const k = (1 - since / 260) * 4;
        sx = Math.sin(since * 0.11) * k;
        sy = Math.cos(since * 0.13) * k * 0.6;
      }
      if (options.shake) options.shake.style.transform = sx || sy ? `translate(${sx}px, ${sy}px)` : "";
      // Follow the poster if the page scrolled or reflowed since we measured.
      const now = poster.getBoundingClientRect();
      const k = now.width / rect.w || 1;
      ctx.translate(now.left - rect.x * k, now.top - rect.y * k);
      ctx.scale(k, k);

      if (since < 0) {
        ctx.drawImage(frost, rect.x, rect.y, rect.w, rect.h);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      } else {
        if (!hitDone) {
          hitDone = true;
          if (options.onHit) options.onHit();
        }
        drawShards(since);
      }
      drawBall(t);
    };

    frame(0);
    if (options.onCovered) options.onCovered();
    const start = performance.now();
    const tick = (now) => {
      if (over) return;
      if (options.alive && !options.alive()) {
        finish(true);
        return;
      }
      const t = now - start;
      if (t >= endAt) {
        finish(false);
        return;
      }
      frame(t);
      raf = global.requestAnimationFrame(tick);
    };
    raf = global.requestAnimationFrame(tick);
    // Frames stop in a background tab; this still ends it on time.
    fallback = global.setTimeout(() => finish(false), endAt + 500);
    return () => finish(true);
  }

  global.ManturonWreckingBall = {
    TIMING,
    rng,
    clipPoly,
    polyArea,
    makeShards,
    swingAngle,
    riseMs,
    openAudio,
    smash,
  };
})(globalThis);
