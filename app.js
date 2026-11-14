// Wine Ratings: Supabase-backed. Config lives in config.js (SUPABASE_URL, SUPABASE_ANON_KEY).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  const wineKey = (p, n) => norm(p) + "|" + norm(n);
  const thisYear = new Date().getFullYear();

  // Wine Spectator-style 100-point bands
  function band(score) {
    if (score >= 95) return { cls: "b95", label: "Classic" };
    if (score >= 90) return { cls: "b90", label: "Outstanding" };
    if (score >= 85) return { cls: "b85", label: "Very good" };
    if (score >= 80) return { cls: "b80", label: "Good" };
    if (score >= 75) return { cls: "b0", label: "Mediocre" };
    return { cls: "b0", label: "Not recommended" };
  }
  const fmtScore = (x) => Number.isInteger(x) ? String(x) : x.toFixed(1);
  const fmtPrice = (v) => v == null || v === "" ? "" : "US$ " + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const cellarOverrides = {
    "artadi|vina de gain|2019": {
      label: "Drink now",
      window: "Now–2030",
      note: "At a good stage today. More time may soften it and add savory notes, but it is unlikely to improve dramatically.",
      serving: "Decant 45–60 minutes.",
      basis: "Published guidance",
    },
    "artadi|vina de gain|2022": {
      label: "Hold or drink",
      window: "Best estimate: 2027–2030 · broader window: 2025–2032",
      note: "The structured tannins and bright acidity should integrate over the next 2–4 years.",
      serving: "If opening now, decant 1–2 hours.",
      basis: "Published guidance",
    },
  };

  const cellarProfiles = [
    { match: /cabernet|nebbiolo|tannat|aglianico|barolo|barbaresco|bordeaux|petit verdot/, ages: [6, 15], kind: "structured red" },
    { match: /tempranillo|sangiovese|syrah|shiraz|malbec|mourvedre|monastrell|touriga|rioja|ribera/, ages: [4, 12], kind: "structured red" },
    { match: /merlot|grenache|garnacha|pinot noir|gamay|zinfandel|primitivo/, ages: [2, 8], kind: "medium-bodied red" },
    { match: /riesling|chenin|chardonnay|semillon|viura|white burgundy/, ages: [2, 10], kind: "ageable white" },
    { match: /sauvignon|albarino|verdejo|pinot grigio|pinot gris|rose|rosado/, ages: [0, 4], kind: "fresh white or rosé" },
    { match: /champagne|cava|sparkling|espumoso|prosecco/, ages: [1, 8], kind: "sparkling wine" },
  ];

  function estimatedCellarAdvice(wine, vintage) {
    if (vintage === "NV") return {
      label: "Drink now",
      window: `Best estimate: now–${thisYear + 3}`,
      note: "Non-vintage wine is generally blended for current drinking, though good storage can preserve it for a few years.",
      serving: "Open when ready and serve at the appropriate temperature for its style.",
      basis: "Automatic estimate · non-vintage",
    };

    const year = Number(vintage);
    const identity = norm([wine.grape, wine.region, wine.name].join(" "));
    const profile = cellarProfiles.find(x => x.match.test(identity)) || { ages: [2, 8], kind: "general wine" };
    const [startAge, endAge] = profile.ages;
    const start = year + startAge;
    const end = year + endAge;
    const label = thisYear < start ? "Hold" : thisYear >= end - 1 ? "Drink now" : "Drink or hold";
    const note = thisYear < start
      ? `Likely to integrate and soften with more bottle age; start checking it around ${start}.`
      : thisYear > end
        ? "Likely at or beyond its estimated peak; further aging carries more risk than reward."
        : `Inside its estimated drinking window, with room to develop through about ${end}.`;
    const serving = profile.kind === "structured red" ? "If opening now, decant 45–90 minutes."
      : profile.kind === "medium-bodied red" ? "If opening now, decant 30–60 minutes."
      : profile.kind === "ageable white" ? "Serve cool and let it open for 15–30 minutes."
      : profile.kind === "fresh white or rosé" || profile.kind === "sparkling wine" ? "Serve well chilled; no decant needed."
      : "Let it breathe for about 30 minutes after opening.";
    const basisName = wine.grape || wine.region || "limited wine details";
    return {
      label,
      window: `Estimated window: ${start}–${end}`,
      note,
      serving,
      basis: `Automatic estimate · ${basisName}`,
    };
  }

  function cellarAdvice(wine, vintage) {
    return cellarOverrides[`${norm(wine.producer)}|${norm(wine.name)}|${vintage}`]
      || estimatedCellarAdvice(wine, vintage);
  }

  let sb = null;
  let wines = new Map();      // id -> {id, producer, name, region, grape}
  let tastings = new Map();   // id -> {id, wineId, vintage, rating, price, createdAt}
  let loaded = false;
  const open = new Set();
  let editing = null;

  function setStatus(msg, err) {
    const el = $("status");
    if (!msg) { el.hidden = true; return; }
    el.hidden = false; el.textContent = msg; el.classList.toggle("err", !!err);
  }

  // ---------- data ----------
  const toWine = (r) => ({ id: r.id, producer: r.producer, name: r.name, region: r.region || "", grape: r.grape || "" });
  const toTasting = (r) => ({
    id: r.id, wineId: r.wine_id, rating: r.rating, price: r.price,
    vintage: /^\d{4}$/.test(r.vintage) ? Number(r.vintage) : r.vintage,
    createdAt: new Date(r.created_at).getTime(),
  });

  async function load() {
    const [w, t] = await Promise.all([
      sb.from("wines").select("*"),
      sb.from("tastings").select("*"),
    ]);
    if (w.error || t.error) throw (w.error || t.error);
    wines = new Map(w.data.map(r => [r.id, toWine(r)]));
    tastings = new Map(t.data.map(r => [r.id, toTasting(r)]));
    loaded = true;
    render();
  }

  async function refresh() {
    try { await load(); }
    catch { setStatus(loaded ? "Couldn't refresh. Showing the last loaded list." : "Couldn't load wines. Check your connection and reopen the app.", true); }
  }

  // ---------- grouping ----------
  function grouped() {
    const byWine = new Map();
    for (const t of tastings.values()) {
      if (!wines.has(t.wineId)) continue;
      if (!byWine.has(t.wineId)) byWine.set(t.wineId, []);
      byWine.get(t.wineId).push(t);
    }
    const out = [];
    for (const [wid, ts] of byWine) {
      const w = wines.get(wid);
      const vmap = new Map();
      for (const t of ts) {
        const k = String(t.vintage);
        if (!vmap.has(k)) vmap.set(k, []);
        vmap.get(k).push(t);
      }
      const vintages = [...vmap.entries()].map(([v, list]) => {
        list.sort((a, b) => b.createdAt - a.createdAt);
        const priced = list.find(x => x.price != null && x.price !== "");
        return { vintage: v, list, avg: avg(list.map(x => x.rating)), lastPrice: priced ? fmtPrice(priced.price) : "" };
      }).sort((a, b) => (a.vintage === "NV") - (b.vintage === "NV") || Number(b.vintage) - Number(a.vintage));
      const best = vintages.reduce((m, v) => v.avg > m.avg ? v : m, vintages[0]);
      out.push({ w, vintages, avg: avg(ts.map(x => x.rating)), best, latest: Math.max(...ts.map(x => x.createdAt)) });
    }
    return out;
  }

  // ---------- render ----------
  function render() {
    const groups = grouped();
    const allRatings = [...tastings.values()].filter(t => wines.has(t.wineId)).map(t => t.rating);
    $("s-wines").textContent = groups.length;
    $("s-tastings").textContent = allRatings.length;
    $("s-avg").textContent = allRatings.length ? avg(allRatings).toFixed(1) : "–";
    fillDatalists();

    const q = norm($("q").value);
    let shown = groups;
    if (q) shown = groups.filter(g => norm([g.w.producer, g.w.name, g.w.region, g.w.grape, ...g.vintages.map(v => v.vintage)].join(" ")).includes(q));
    const s = $("sort").value;
    shown.sort(s === "recent" ? (a, b) => b.latest - a.latest
      : s === "name" ? (a, b) => norm(a.w.producer).localeCompare(norm(b.w.producer)) || norm(a.w.name).localeCompare(norm(b.w.name))
      : (a, b) => b.avg - a.avg);

    if (loaded) {
      if (!groups.length) setStatus("No wines yet. Tap “+ Add wine” to log your first bottle.");
      else if (!shown.length) setStatus("No wines match “" + $("q").value + "”.");
      else setStatus("");
    }

    $("list").innerHTML = shown.map(g => {
      const b = band(g.avg);
      const metaBits = [g.w.region, g.w.grape].filter(Boolean).map(esc).join(" · ");
      const bestNote = g.vintages.length > 1 ? `Best: ${esc(g.best.vintage)} · ${fmtScore(+g.best.avg.toFixed(1))}` : "";
      return `<article class="wine">
        <div class="wine-head">
          <div>
            <div class="producer">${esc(g.w.producer)}</div>
            <h2>${esc(g.w.name)}</h2>
            ${metaBits ? `<div class="meta">${metaBits}</div>` : ""}
          </div>
          <div class="score">
            <b class="num">${fmtScore(+g.avg.toFixed(1))}</b>
            <span>${g.vintages.length > 1 ? "avg across vintages" : "rating"}</span>
            <span class="band ${b.cls}">${b.label}</span>
            ${bestNote ? `<span>${bestNote}</span>` : ""}
          </div>
        </div>
        <div class="vintages">
          ${g.vintages.map(v => {
            const key = g.w.id + "|" + v.vintage;
            const isOpen = open.has(key);
            const vb = band(v.avg);
            const cellar = cellarAdvice(g.w, v.vintage);
            const sub = [v.list.length > 1 ? `${v.list.length} tastings` : "1 tasting", v.lastPrice].filter(Boolean).join(" · ");
            return `<button class="vrow" type="button" data-toggle="${esc(key)}" aria-expanded="${isOpen}">
                <span class="yr num">${esc(v.vintage)}</span>
                <span><span class="band ${vb.cls}">${vb.label}</span> <span class="sub">${esc(sub)}</span>
                  <div class="bar" aria-hidden="true"><i style="width:${Math.max(0, (v.avg - 50) * 2)}%"></i></div></span>
                <span class="pts num">${fmtScore(+v.avg.toFixed(1))}</span>
                <span class="chev" aria-hidden="true">Edit ›</span>
              </button>
              ${isOpen ? `<div class="tastings">
                ${cellar ? `<aside class="cellar-note">
                  <div class="cellar-head"><b>${esc(cellar.label)}</b><span>${esc(cellar.window)}</span></div>
                  <p>${esc(cellar.note)}</p>
                  <p class="cellar-serving">${esc(cellar.serving)} Store around 12–16°C; if kept in a warm room, drink sooner.</p>
                  <p class="cellar-basis">${esc(cellar.basis)}</p>
                </aside>` : ""}
                ${v.list.map(t => `
                <div class="tasting">
                  <span class="p num">${t.rating}</span>
                  <span class="when">${fmtDate(t.createdAt)}${t.price != null && t.price !== "" ? " · " + esc(fmtPrice(t.price)) : ""}</span>
                  <button class="btn" type="button" data-edit="${esc(t.id)}">Edit price / rating</button>
                </div>`).join("")}
                <button class="btn ghost" type="button" data-again="${esc(g.w.id)}" data-vintage="${esc(v.vintage)}">+ Rate this vintage again</button>
              </div>` : ""}`;
          }).join("")}
          <button class="vrow" type="button" data-again="${esc(g.w.id)}" style="color:var(--accent);grid-template-columns:1fr"><span>+ Add another vintage</span></button>
        </div>
      </article>`;
    }).join("");
  }

  function fillDatalists() {
    const ws = [...wines.values()];
    const uniq = (arr) => [...new Map(arr.filter(Boolean).map(x => [norm(x), x.trim()])).values()].sort((a, b) => a.localeCompare(b));
    const opt = (arr) => arr.map(x => `<option value="${esc(x)}"></option>`).join("");
    $("dl-producers").innerHTML = opt(uniq(ws.map(w => w.producer)));
    $("dl-regions").innerHTML = opt(uniq(ws.map(w => w.region)));
    $("dl-grapes").innerHTML = opt(uniq(ws.map(w => w.grape)));
    updateNameList();
  }
  function updateNameList() {
    const p = norm($("f-producer").value);
    const names = [...wines.values()].filter(w => !p || norm(w.producer) === p).map(w => w.name);
    $("dl-names").innerHTML = [...new Set(names)].sort().map(x => `<option value="${esc(x)}"></option>`).join("");
  }

  // ---------- form ----------
  const dlg = $("dlg");
  function findWine(p, n) {
    const k = wineKey(p, n);
    for (const w of wines.values()) if (wineKey(w.producer, w.name) === k) return w;
    return null;
  }
  function vintageCount(wid) {
    return new Set([...tastings.values()].filter(t => t.wineId === wid).map(t => String(t.vintage))).size;
  }
  function onWineInput() {
    updateNameList();
    const w = findWine($("f-producer").value, $("f-name").value);
    if (w && $("f-producer").value && $("f-name").value) {
      const n = vintageCount(w.id);
      $("f-match").textContent = `Already in the list (${n} vintage${n === 1 ? "" : "s"}). This rating will be grouped with it.`;
      if (!$("f-region").value) $("f-region").value = w.region || "";
      if (!$("f-grape").value) $("f-grape").value = w.grape || "";
    } else {
      $("f-match").textContent = "";
    }
  }
  function syncRating(src) {
    const v = Number(src.value);
    if (src.id === "f-range") $("f-rating").value = v; else if (v >= 50 && v <= 100) $("f-range").value = v;
    $("f-band").textContent = v >= 50 && v <= 100 ? band(v).label : "Enter 50–100";
  }

  function openForm({ tasting = null, wineId = null, vintage = null } = {}) {
    editing = tasting ? tasting.id : null;
    $("f-err").textContent = "";
    const w = tasting ? wines.get(tasting.wineId) : wineId ? wines.get(wineId) : null;
    $("f-producer").value = w ? w.producer : "";
    $("f-name").value = w ? w.name : "";
    $("f-region").value = w ? (w.region || "") : "";
    $("f-grape").value = w ? (w.grape || "") : "";
    const vin = tasting ? String(tasting.vintage) : vintage;
    $("f-nv").checked = vin === "NV";
    $("f-vintage").value = vin && vin !== "NV" ? vin : "";
    $("f-vintage").disabled = vin === "NV";
    $("f-price").value = tasting && tasting.price != null ? tasting.price : "";
    $("f-rating").value = tasting ? tasting.rating : 90;
    syncRating($("f-rating"));
    $("dlg-title").textContent = tasting ? "Edit tasting" : "Add a tasting";
    $("f-delete").hidden = !tasting;
    onWineInput();
    dlg.showModal();
  }

  async function save(e) {
    e.preventDefault();
    const producer = $("f-producer").value.trim();
    const name = $("f-name").value.trim();
    const region = $("f-region").value.trim();
    const grape = $("f-grape").value.trim();
    const nv = $("f-nv").checked;
    const vRaw = $("f-vintage").value.trim();
    const rating = Number($("f-rating").value);
    const priceRaw = $("f-price").value.trim();

    const err = (m) => { $("f-err").textContent = m; };
    if (!producer || !name) return err("Enter both the producer and the wine.");
    if (!nv && !/^\d{4}$/.test(vRaw)) return err("Enter a 4-digit vintage, or tick Non-vintage.");
    if (!nv && (Number(vRaw) < 1900 || Number(vRaw) > thisYear + 1)) return err(`Vintage must be between 1900 and ${thisYear + 1}.`);
    if (!Number.isInteger(rating) || rating < 50 || rating > 100) return err("Rating must be a whole number from 50 to 100.");
    const price = priceRaw === "" ? null : Number(priceRaw);
    if (price != null && (!isFinite(price) || price < 0)) return err("Price must be a positive number.");
    const vintage = nv ? "NV" : vRaw;

    $("f-save").disabled = true;
    try {
      let w = findWine(producer, name);
      if (!w) {
        const r = await sb.from("wines").insert({ producer, name, region, grape }).select().single();
        if (r.error) throw r.error;
        w = toWine(r.data);
      } else if ((region && region !== w.region) || (grape && grape !== w.grape)) {
        const r = await sb.from("wines").update({ region: region || w.region, grape: grape || w.grape }).eq("id", w.id);
        if (r.error) throw r.error;
      }
      const body = { wine_id: w.id, vintage, rating, price };
      let oldWineId = null;
      if (editing) {
        const prev = tastings.get(editing);
        oldWineId = prev && prev.wineId !== w.id ? prev.wineId : null;
        const r = await sb.from("tastings").update(body).eq("id", editing);
        if (r.error) throw r.error;
      } else {
        const r = await sb.from("tastings").insert(body);
        if (r.error) throw r.error;
      }
      if (oldWineId) await removeWineIfEmpty(oldWineId, editing);
      open.add(w.id + "|" + vintage);
      dlg.close();
      await refresh();
    } catch {
      err("Couldn't save. Check your connection and try again.");
    } finally {
      $("f-save").disabled = false;
    }
  }

  async function removeWineIfEmpty(wineId, exceptTastingId) {
    const left = [...tastings.values()].some(t => t.wineId === wineId && t.id !== exceptTastingId);
    if (!left) await sb.from("wines").delete().eq("id", wineId);
  }

  let confirmArmed = false;
  async function del() {
    if (!editing) return;
    if (!confirmArmed) {
      confirmArmed = true;
      $("f-delete").textContent = "Tap again to delete";
      setTimeout(() => { confirmArmed = false; $("f-delete").textContent = "Delete tasting"; }, 3000);
      return;
    }
    confirmArmed = false;
    $("f-delete").textContent = "Delete tasting";
    const t = tastings.get(editing);
    try {
      const r = await sb.from("tastings").delete().eq("id", editing);
      if (r.error) throw r.error;
      if (t) await removeWineIfEmpty(t.wineId, editing);
      dlg.close();
      await refresh();
    } catch {
      $("f-err").textContent = "Couldn't delete. Check your connection and try again.";
    }
  }

  // ---------- events ----------
  $("add").addEventListener("click", () => openForm());
  $("form").addEventListener("submit", save);
  $("f-cancel").addEventListener("click", () => dlg.close());
  $("f-delete").addEventListener("click", del);
  $("f-producer").addEventListener("input", onWineInput);
  $("f-name").addEventListener("input", onWineInput);
  $("f-rating").addEventListener("input", (e) => syncRating(e.target));
  $("f-range").addEventListener("input", (e) => syncRating(e.target));
  $("f-nv").addEventListener("change", (e) => { $("f-vintage").disabled = e.target.checked; if (e.target.checked) $("f-vintage").value = ""; });
  $("q").addEventListener("input", render);
  $("sort").addEventListener("change", () => { try { localStorage.setItem("wine-sort", $("sort").value); } catch {} render(); });
  try { const s = localStorage.getItem("wine-sort"); if (s) $("sort").value = s; } catch {}

  $("list").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    const ag = e.target.closest("[data-again]");
    const tg = e.target.closest("[data-toggle]");
    if (ed) return openForm({ tasting: tastings.get(ed.dataset.edit) });
    if (ag) return openForm({ wineId: ag.dataset.again, vintage: ag.dataset.vintage || null });
    if (tg) { const k = tg.dataset.toggle; open.has(k) ? open.delete(k) : open.add(k); render(); }
  });

  // Pick up friends' changes when the app comes back to the foreground, and every minute while open.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sb) refresh(); });
  setInterval(() => { if (!document.hidden && sb) refresh(); }, 60000);

  // ---------- start ----------
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("YOUR_")) {
    setStatus("The database isn't connected yet.", true);
    $("add").disabled = true;
    return;
  }
  sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  refresh();
})();
