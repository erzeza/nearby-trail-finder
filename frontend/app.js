// ── Paletas de colores ──
const ROUTE_COLORS = ["#2979ff","#e53935","#fb8c00","#8e24aa","#00acc1","#f4511e","#3949ab","#c0ca33"];
const TRAIL_COLORS = ["#2e7d32","#388e3c","#43a047","#66bb6a","#1b5e20","#558b2f","#33691e","#827717"];

// ── Filtros por defecto (coinciden con los checkboxes del HTML) ──
const FILTER_DEFAULTS = {
  highway:   ["path"],
  sac_scale: ["mountain_hiking","demanding_mountain_hiking","alpine_hiking","demanding_alpine_hiking","difficult_alpine_hiking"],
  tracktype: ["4","5"],
  network:   ["lwn"],
  surface:   ["unpaved","gravel","dirt","grass","rock","sand","concrete","ground","compacted","untagged"],
};

// ── Estilos de ruta ──
const ROUTE_W         = 3;    // grosor fijo, nunca cambia
const ROUTE_OP_DEFAULT  = 0.85;
const ROUTE_OP_SELECTED = 0.95;
const ROUTE_OP_DIMMED   = 0.5;

// ── Estado global ──
let map, markerLayer, circleLayer;
let routeLayers    = [];
let routeColors    = [];   // color de cada ruta (mismo índice que routeLayers)
let directionLayers = [];  // marcadores inicio/fin + decorator de la ruta activa
let trailLayers    = [];
let highlightLayer = null;
let trailLabelLayer = null;
let activeTrailLi   = null;
let allTrails      = [];
let trailsLoaded   = false;

// ── Control "Centrar en punto seleccionado" ──
const CenterControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const a = L.DomUtil.create("a", "map-ctrl-btn", container);
    a.href = "#";
    a.title = "Centrar en el punto seleccionado";
    a.innerHTML = `<svg width="26" height="26" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
    </svg>`;
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
      if (!this._enabled) return;
      if (circleLayer) map.fitBounds(circleLayer.getBounds().pad(0.1));
      else if (markerLayer) map.setView(markerLayer.getLatLng(), 13);
    });
    this._a = a;
    this.setEnabled(false);
    return container;
  },
  setEnabled(enabled) {
    this._enabled = enabled;
    this._a.style.color  = enabled ? "#2979ff" : "#bbb";
    this._a.style.cursor = enabled ? "pointer"  : "not-allowed";
  },
});

// ── Control "Centrar en GPS" ──
const GpsControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const a = L.DomUtil.create("a", "map-ctrl-btn", container);
    a.href = "#";
    a.title = "Centrar en mi posición GPS";
    a.innerHTML = `<svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a.5.5 0 0 1 .5.5v.518A7 7 0 0 1 14.982 7.5h.518a.5.5 0 0 1 0 1h-.518A7 7 0 0 1 8.5 14.982v.518a.5.5 0 0 1-1 0v-.518A7 7 0 0 1 1.018 8.5H.5a.5.5 0 0 1 0-1h.518A7 7 0 0 1 7.5.518V.5A.5.5 0 0 1 8 0zm0 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
    </svg>`;
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
      tryGeolocation();
    });
    return container;
  },
});

// ── Mapa ──
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.4168, -3.7038], 6);
  L.control.zoom({ position: "topright" }).addTo(map);

  const layerOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    tileSize: 512,
    zoomOffset: -1,
  });

  const layerTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  });

  const layerCarto = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '© <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  });

  layerOSM.addTo(map);

  const layersCtrl = L.control.layers(
    { "OpenStreetMap": layerOSM, "OpenTopoMap": layerTopo, "CartoDB Voyager": layerCarto },
    {},
    { position: "topright", collapsed: true }
  ).addTo(map);

  // Abrir/cerrar con click (no con hover)
  const lc = layersCtrl._container;
  lc.addEventListener("mouseenter", (e) => e.stopImmediatePropagation(), true);
  lc.addEventListener("mouseleave", (e) => e.stopImmediatePropagation(), true);
  lc.querySelector(".leaflet-control-layers-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    lc.classList.contains("leaflet-control-layers-expanded")
      ? layersCtrl.collapse()
      : layersCtrl.expand();
  });
  map.on("click", () => layersCtrl.collapse());

  window.centerControl = new CenterControl();
  centerControl.addTo(map);
  new GpsControl().addTo(map);

  map.on("click", onMapClick);
}

function onMapClick(e) {
  placeMarkerAndCircle(e.latlng);
  // Nuevo punto → invalidar caché de sendas
  invalidateTrailsCache();
  setSearchButtonsEnabled(true);
}

function placeMarkerAndCircle(latlng) {
  if (markerLayer) markerLayer.remove();
  if (circleLayer) circleLayer.remove();
  markerLayer = L.marker(latlng).addTo(map);
  circleLayer = L.circle(latlng, {
    radius: getRadius(),
    color: "#2979ff", fillColor: "#2979ff", fillOpacity: 0.08, weight: 2,
  }).addTo(map);
  centerControl.setEnabled(true);
}

function getRadius() {
  return parseInt(document.getElementById("radius-slider").value, 10);
}

function setSearchButtonsEnabled(enabled) {
  ["search-all-btn","search-strava-btn","search-trails-btn"].forEach((id) => {
    document.getElementById(id).disabled = !enabled;
  });
}

function invalidateTrailsCache() {
  allTrails = [];
  trailsLoaded = false;
  document.getElementById("trails-cache-info").classList.add("hidden");
}

// ── Slider ──
document.getElementById("radius-slider").addEventListener("input", (e) => {
  const r = parseInt(e.target.value, 10);
  document.getElementById("radius-label").textContent =
    r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`;
  if (circleLayer) {
    circleLayer.setRadius(r);
    // Radio cambió → invalidar caché
    invalidateTrailsCache();
  }
});


// ── Tabs ──
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

// ── Botones de búsqueda ──
document.getElementById("search-all-btn").addEventListener("click",    () => searchAll());
document.getElementById("search-strava-btn").addEventListener("click", () => searchStrava());
document.getElementById("search-trails-btn").addEventListener("click", () => searchTrails());

async function searchAll() {
  if (!markerLayer) return;
  clearResults();
  showLoading(true, "Buscando rutas y sendas...");
  await Promise.allSettled([
    doSearchStrava(),
    doSearchTrails(),
  ]);
  showLoading(false);
  fitAllLayers();
}

async function searchStrava() {
  if (!markerLayer) return;
  clearStravaResults();
  showLoading(true, "Buscando mis rutas...");
  await doSearchStrava();
  showLoading(false);
  fitAllLayers();
}

async function searchTrails() {
  if (!markerLayer) return;
  clearTrailResults();
  showLoading(true, "Buscando sendas...");
  await doSearchTrails();
  showLoading(false);
  fitAllLayers();
}

// ── Lógica de búsqueda ──
async function doSearchStrava() {
  const { lat, lng } = markerLayer.getLatLng();
  const radius = getRadius();
  try {
    const data = await fetchNearby(lat, lng, radius);
    renderStravaResults(data.activities);
  } catch (e) {
    const summary = document.getElementById("results-summary");
    if (e.message?.includes("401")) {
      summary.innerHTML = `
        Para ver tus rutas necesitas conectar tu cuenta de Strava.<br>
        <a href="/auth/strava" class="btn btn-strava" style="display:inline-block;margin-top:8px;width:auto;padding:8px 16px;">
          Conectar con Strava
        </a>`;
      summary.classList.remove("hidden");
      showClearBtn();
    } else {
      showSummary("results-summary", `Error Strava: ${e.message}`);
    }
  }
}

async function doSearchTrails() {
  const { lat, lng } = markerLayer.getLatLng();
  const radius = getRadius();

  if (!trailsLoaded) {
    // Primera vez para este punto/radio → llamar API
    try {
      const data = await fetchAllTrails(lat, lng, radius);
      allTrails = data.trails;
      trailsLoaded = true;
      updateCacheInfo();
    } catch (e) {
      showTrailsError(e.message, lat, lng, radius);
      return;
    }
  }

  applyTrailFilters();
}

// ── Filtros locales (sin llamada a API) ──
function applyTrailFilters() {
  if (!trailsLoaded) {
    // Aún no hay datos; no hacer nada
    return;
  }
  clearTrailLayers();
  document.getElementById("trails-list").innerHTML = "";
  document.getElementById("trails-summary").classList.add("hidden");

  const filtered = allTrails.filter(passesFilters);
  console.log("[applyTrailFilters]", filtered.length, "pass out of", allTrails.length, "cached");
  console.log("[applyTrailFilters] active filters:", getTrailFilters());
  renderTrailResults(filtered);
}

function passesFilters(trail) {
  const f = getTrailFilters();

  if (trail.osm_type === "way") {
    // ── Tipo de vía: siempre aplica (lista vacía = nada pasa) ──
    if (!f.highways.includes(trail.highway)) return false;

    // ── sac_scale: filtra solo si el trail tiene el tag Y no está en la lista ──
    if (f.sacScales.length && trail.sac_scale && !f.sacScales.includes(trail.sac_scale)) return false;

    // ── tracktype: filtra pistas con grado por debajo del mínimo permitido ──
    if (trail.highway === "track" && trail.tracktype) {
      const grade = parseInt(trail.tracktype.replace("grade", ""), 10);
      if (!isNaN(grade) && grade < f.minGrade) return false;
    }

    // ── Superficie: trata null como "untagged" ──
    if (f.surfaces.length) {
      const surface = trail.surface || "untagged";
      if (!f.surfaces.includes(surface)) return false;
    }
  }

  if (trail.osm_type === "relation") {
    // ── Red señalizada: filtra solo si el trail tiene network Y no está en la lista ──
    if (f.networks.length && trail.network && !f.networks.includes(trail.network)) return false;
  }

  return true;
}

function getTrailFilters() {
  const checked = (name) =>
    [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);

  const highways        = checked("highway");
  const sacScales       = checked("sac_scale");
  const tracktypeGrades = checked("tracktype").map(Number);
  const networks        = checked("network");
  const surfaces        = checked("surface");
  const minGrade        = tracktypeGrades.length ? Math.min(...tracktypeGrades) : 1;

  return { highways, sacScales, tracktypeGrades, networks, surfaces, minGrade };
}

// ── Modal de filtros ──
const filterModal = document.getElementById("filter-modal");

document.getElementById("filter-btn").addEventListener("click", () => {
  filterModal.classList.remove("hidden");
  document.getElementById("filter-btn").classList.add("active");
});

document.getElementById("filter-close").addEventListener("click", closeFilterModal);
filterModal.addEventListener("click", (e) => { if (e.target === filterModal) closeFilterModal(); });

function closeFilterModal() {
  filterModal.classList.add("hidden");
  document.getElementById("filter-btn").classList.remove("active");
}

document.getElementById("filter-apply").addEventListener("click", () => {
  closeFilterModal();
  updateFilterIndicator();
  // Aplicar filtros sobre el caché local, sin llamada a API
  applyTrailFilters();
});

document.getElementById("filter-reset").addEventListener("click", () => {
  ["highway","sac_scale","tracktype","network","surface"].forEach((name) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
      el.checked = FILTER_DEFAULTS[name].includes(el.value);
    });
  });
  updateFilterIndicator();
});

function isEverythingChecked() {
  return [...document.querySelectorAll('.modal-body input[type="checkbox"]')].every(cb => cb.checked);
}

function updateFilterIndicator() {
  const allChecked = isEverythingChecked();
  const btn = document.getElementById("filter-btn");
  // Filled icon = filtering (any checkbox unchecked); outline = all checked (no filter)
  document.getElementById("filter-icon-filled").classList.toggle("hidden", allChecked);
  document.getElementById("filter-icon-outline").classList.toggle("hidden", !allChecked);
  // Blue background while filtering
  btn.classList.toggle("filtering", !allChecked);
}

function updateCacheInfo() {
  const el = document.getElementById("trails-cache-info");
  const counts = {};
  allTrails.forEach(t => {
    const k = t.highway || t.osm_type;
    counts[k] = (counts[k] || 0) + 1;
  });
  const breakdown = Object.entries(counts).map(([k,v]) => `${k}:${v}`).join(', ');
  el.textContent = `${allTrails.length} sendas cargadas (${breakdown}) · filtrado local`;
  el.classList.remove("hidden");
  console.log("[Trails cache]", allTrails.length, "trails:", counts);
}

// ── Fetch ──
async function fetchNearby(lat, lng, radius) {
  const res = await fetch(`/api/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
  if (!res.ok) throw new Error(res.status === 401 ? "401" : `HTTP ${res.status}`);
  return res.json();
}

async function fetchAllTrails(lat, lng, radius) {
  const url = `/api/trails?lat=${lat}&lng=${lng}&radius=${radius}`;
  console.log("[fetchAllTrails] →", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log("[fetchAllTrails] ←", data.count, "trails total");
  if (data.trails?.length) {
    const typeCounts = {};
    data.trails.forEach(t => {
      const k = t.highway ?? t.osm_type;
      typeCounts[k] = (typeCounts[k] || 0) + 1;
    });
    console.log("[fetchAllTrails] breakdown:", typeCounts);
    console.log("[fetchAllTrails] first 5:", data.trails.slice(0, 5).map(t => ({ hw: t.highway, name: t.name, sac: t.sac_scale })));
  }
  return data;
}

// ── Render Strava ──
function renderStravaResults(activities) {
  const list = document.getElementById("results-list");
  if (!activities.length) {
    showSummary("results-summary", "No se encontraron tus rutas en este radio.");
    return;
  }
  showSummary("results-summary",
    `${activities.length} ruta${activities.length !== 1 ? "s" : ""} encontrada${activities.length !== 1 ? "s" : ""}`);

  activities.forEach((activity, i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    if (activity.polyline?.length > 0) {
      const layer = L.polyline(activity.polyline, {
        color, weight: ROUTE_W, opacity: ROUTE_OP_DEFAULT,
      }).addTo(map);
      layer.bindPopup(stravaPopup(activity));
      routeLayers.push(layer);
      routeColors.push(color);
    }
    const li = document.createElement("li");
    li.className = "result-item";
    li.style.cssText = `border-left: 4px solid ${color};`;
    li.innerHTML = `
      <div class="name" title="${activity.name}">${activity.name}</div>
      <div class="meta">
        <span>${activity.date?.slice(0,10) ?? ""}</span>
        <span>${(activity.distance_m/1000).toFixed(1)} km</span>
        <span>${Math.round(activity.elevation_gain_m)} m D+</span>
        <span class="closest">a ${fmtDist(activity.closest_point_m)}</span>
      </div>
      <a href="${activity.strava_url}" target="_blank" rel="noopener">Ver en Strava ↗</a>`;
    const idx = routeLayers.length - 1;
    li.addEventListener("click", () => focusRouteLayer(routeLayers[idx], li, idx));
    list.appendChild(li);
  });
}

function stravaPopup(a) {
  return `<strong>${a.name}</strong><br/>${a.date?.slice(0,10) ?? ""}<br/>
    ${(a.distance_m/1000).toFixed(1)} km · ${Math.round(a.elevation_gain_m)} m D+<br/>
    <a href="${a.strava_url}" target="_blank">Ver en Strava ↗</a>`;
}

// ── Render Sendas ──
function renderTrailResults(trails) {
  const list = document.getElementById("trails-list");

  if (!trails.length) {
    showSummary("trails-summary", "No hay sendas que coincidan con los filtros actuales.");
    return;
  }

  showSummary("trails-summary",
    `${trails.length} de ${allTrails.length} senda${allTrails.length !== 1 ? "s" : ""} (filtradas)`);

  trails.sort((a, b) => {
    const an = !!(a.name || a.ref), bn = !!(b.name || b.ref);
    return an !== bn ? (an ? -1 : 1) : 0;
  });

  trails.forEach((trail, i) => {
    const color = TRAIL_COLORS[i % TRAIL_COLORS.length];
    let layer;

    if (trail.osm_type === "way" && trail.coordinates?.length > 0) {
      layer = L.polyline(trail.coordinates, { color, weight: 2.5, opacity: 0.75, dashArray: "6,4" }).addTo(map);
    } else if (trail.osm_type === "relation" && trail.coordinates_segments?.length > 0) {
      layer = L.layerGroup(
        trail.coordinates_segments.map((seg) =>
          L.polyline(seg, { color, weight: 2.5, opacity: 0.75, dashArray: "6,4" })
        )
      ).addTo(map);
    }

    if (layer?.bindPopup) layer.bindPopup(trailPopup(trail));
    if (layer) trailLayers.push(layer);

    const li = document.createElement("li");
    li.className = "trail-item";
    li.style.cssText = `border-left: 4px solid ${color};`;
    const displayName = trail.name ?? trail.ref ?? "Sin nombre";
    const badge = trail.network_label
      ? `<span class="network-badge">${trail.network_label}</span>` : "";
    li.innerHTML = `
      <div class="name" title="${displayName}">${displayName}</div>
      <div class="meta">
        <span>${trail.type_label}</span>
        ${trail.surface ? `<span>${trail.surface}</span>` : ""}
        ${badge}
      </div>
      <a href="${trail.osm_url}" target="_blank" rel="noopener">Ver en OSM ↗</a>`;
    if (layer) li.addEventListener("click", () => focusTrailLayer(layer, li, color, displayName));
    list.appendChild(li);
  });
}

function trailPopup(t) {
  const name = t.name ?? t.ref ?? "Sin nombre";
  const net  = t.network_label ? `<br/>${t.network_label}` : "";
  return `<strong>${name}</strong><br/>${t.type_label}${net}<br/>
    <a href="${t.osm_url}" target="_blank">Ver en OSM ↗</a>`;
}

// ── Error de sendas con botón reintentar ──
function showTrailsError(message, lat, lng, radius) {
  const summary = document.getElementById("trails-summary");
  summary.innerHTML = "";
  summary.classList.remove("hidden");
  const isOverpass = message?.includes("503") || message?.includes("504");
  const div = document.createElement("div");
  div.className = "trails-error";
  div.innerHTML = isOverpass
    ? "El servidor de sendas (Overpass API) no está disponible. Prueba de nuevo en unos segundos."
    : `Error al cargar sendas: ${message}`;
  if (isOverpass) {
    const btn = document.createElement("button");
    btn.textContent = "Reintentar";
    btn.addEventListener("click", () => searchTrails());
    div.appendChild(btn);
  }
  summary.appendChild(div);
}

// ── Focus rutas Strava ──
let activeRouteIdx = -1;

function resetRouteStyles() {
  routeLayers.forEach((l) => l.setStyle({ opacity: ROUTE_OP_DEFAULT }));
  clearDirectionLayers();
  document.querySelectorAll(".result-item").forEach((el) => el.classList.remove("active"));
  activeRouteIdx = -1;
}

function focusRouteLayer(layer, li, idx) {
  // Click en la ruta ya activa → deseleccionar
  if (activeRouteIdx === idx) {
    resetRouteStyles();
    return;
  }
  activeRouteIdx = idx;

  document.querySelectorAll(".result-item").forEach((el) => el.classList.remove("active"));
  li.classList.add("active");

  // Solo opacidad — el grosor nunca cambia
  routeLayers.forEach((l, i) => {
    if (i === idx) {
      l.setStyle({ opacity: ROUTE_OP_SELECTED });
      l.bringToFront();
    } else {
      l.setStyle({ opacity: ROUTE_OP_DIMMED });
    }
  });

  if (layer?.getBounds) {
    map.fitBounds(layer.getBounds().pad(0.15));
    layer.openPopup?.();
  }

  // Dirección: marcadores inicio/fin + flechas
  clearDirectionLayers();
  const color = routeColors[idx] ?? "#2979ff";
  const coords = layer.getLatLngs?.();
  if (coords?.length > 1) {
    const mkIcon = (bg, radius) => L.divIcon({
      html: `<div style="width:12px;height:12px;background:${bg};border-radius:${radius};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], className: "",
    });
    const startMk = L.marker(coords[0],               { icon: mkIcon("#43a047", "50%"), zIndexOffset: 500 }).addTo(map);
    const endMk   = L.marker(coords[coords.length - 1], { icon: mkIcon("#e53935", "3px"),  zIndexOffset: 500 }).addTo(map);

    let decorator = null;
    if (L.polylineDecorator) {
      decorator = L.polylineDecorator(layer, {
        patterns: [{
          offset: "8%", repeat: "12%",
          symbol: L.Symbol.arrowHead({
            pixelSize: 14, polygon: true,
            pathOptions: { stroke: false, fillOpacity: 0.9, fill: true, fillColor: color },
          }),
        }],
      }).addTo(map);
    }

    directionLayers = [startMk, endMk, ...(decorator ? [decorator] : [])];
  }
}

function clearDirectionLayers() {
  directionLayers.forEach((l) => l.remove());
  directionLayers = [];
}

// ── Focus capas (genérico) ──
function focusLayer(layer, li, selector) {
  document.querySelectorAll(selector).forEach((el) => el.classList.remove("active"));
  li.classList.add("active");
  if (layer?.getBounds) { map.fitBounds(layer.getBounds().pad(0.15)); layer.openPopup?.(); }
}

function focusTrailLayer(layer, li, color, trailName) {
  // Toggle: click same trail again → deselect
  if (li === activeTrailLi) {
    document.querySelectorAll(".trail-item").forEach((el) => el.classList.remove("active"));
    clearHighlight();
    activeTrailLi = null;
    return;
  }

  document.querySelectorAll(".trail-item").forEach((el) => el.classList.remove("active"));
  li.classList.add("active");
  activeTrailLi = li;
  clearHighlight();

  let allCoords = [];

  if (layer?.getBounds) {
    const latlngs = layer.getLatLngs();
    highlightLayer = L.polyline(latlngs,
      { color, weight: 9, opacity: 0.45, lineCap: "round", lineJoin: "round" }).addTo(map);
    map.fitBounds(layer.getBounds().pad(0.15));
    allCoords = latlngs;
  } else if (layer?.getLayers) {
    const sublayers = layer.getLayers();
    highlightLayer = L.layerGroup(
      sublayers.map((l) =>
        L.polyline(l.getLatLngs(), { color, weight: 9, opacity: 0.45, lineCap: "round", lineJoin: "round" })
      )
    ).addTo(map);
    const bounds = L.featureGroup(sublayers).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
    allCoords = sublayers.flatMap((l) => l.getLatLngs());
  }

  // Label at midpoint (only if the trail has a real name)
  if (trailName && trailName !== "Sin nombre" && allCoords.length > 0) {
    const mid = allCoords[Math.floor(allCoords.length / 2)];
    const labelIcon = L.divIcon({
      html: `<div style="
        display: inline-block;
        transform: translate(-50%, -50%);
        background: rgba(255,255,255,0.93);
        color: #1b5e20;
        font-weight: 700;
        font-size: 26px;
        padding: 5px 12px;
        border-radius: 6px;
        border: 2px solid ${color};
        box-shadow: 0 2px 8px rgba(0,0,0,0.30);
        white-space: nowrap;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        line-height: 1.2;
      ">${trailName}</div>`,
      className: "",
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    trailLabelLayer = L.marker(mid, { icon: labelIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  }
}

function clearHighlight() {
  if (highlightLayer)  { highlightLayer.remove();  highlightLayer  = null; }
  if (trailLabelLayer) { trailLabelLayer.remove(); trailLabelLayer = null; }
}

// ── Limpiar ──
function clearStravaResults() {
  clearDirectionLayers();
  routeLayers.forEach((l) => l.remove()); routeLayers = [];
  routeColors = [];
  activeRouteIdx = -1;
  document.getElementById("results-list").innerHTML = "";
  document.getElementById("results-summary").classList.add("hidden");
}

function clearTrailLayers() {
  trailLayers.forEach((l) => l.remove()); trailLayers = [];
  clearHighlight();
  activeTrailLi = null;
}

function clearTrailResults() {
  clearTrailLayers();
  document.getElementById("trails-list").innerHTML = "";
  document.getElementById("trails-summary").classList.add("hidden");
}

function clearResults() {
  clearStravaResults();
  clearTrailResults();
}

document.getElementById("clear-btn").addEventListener("click", () => {
  clearResults();
  invalidateTrailsCache();
  if (markerLayer) markerLayer.remove();
  if (circleLayer) circleLayer.remove();
  markerLayer = circleLayer = null;
  document.getElementById("clear-btn").classList.add("hidden");
  centerControl.setEnabled(false);
  setSearchButtonsEnabled(false);
});

// Mostrar botón limpiar cuando hay resultados
function showClearBtn() {
  document.getElementById("clear-btn").classList.remove("hidden");
}

// ── Helpers ──
function showSummary(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.remove("hidden");
  showClearBtn();
}

function fitAllLayers() {
  const all = [...routeLayers, ...trailLayers];
  if (all.length > 0) map.fitBounds(L.featureGroup(all).getBounds().pad(0.1));
}

function fmtDist(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} km`;
}

function showLoading(visible, msg = "Buscando...") {
  document.getElementById("loading-msg").textContent = msg;
  document.getElementById("loading").classList.toggle("hidden", !visible);
}

// ── Auth ──
async function checkAuthStatus() {
  try {
    const res  = await fetch("/api/status");
    const data = await res.json();
    if (data.authenticated) {
      document.getElementById("auth-disconnected").classList.add("hidden");
      document.getElementById("auth-connected").classList.remove("hidden");
      document.getElementById("athlete-name").textContent = data.athlete_name;
      console.log("[auth] athlete_photo:", data.athlete_photo);
      const photoEl = document.getElementById("athlete-photo");
      if (data.athlete_photo) {
        photoEl.src = data.athlete_photo;
        photoEl.onerror = () => { photoEl.src = ""; photoEl.style.display = "none"; };
      }
      const locEl = document.getElementById("athlete-location");
      if (data.athlete_location) {
        locEl.textContent = "📍 " + data.athlete_location;
        locEl.classList.remove("hidden");
      }
    } else {
      document.getElementById("auth-disconnected").classList.remove("hidden");
      document.getElementById("auth-connected").classList.add("hidden");
    }
  } catch {
    /* silencioso */
  }
}

// ── Init ──
initMap();
checkAuthStatus();
updateFilterIndicator();
if (new URLSearchParams(window.location.search).get("connected") === "true") {
  history.replaceState({}, "", "/");
}

// ── Móvil: toggle sidebar + geolocalización ──
const isMobile = window.innerWidth < 768 || ("ontouchstart" in window);
const sidebarEl       = document.getElementById("sidebar");
const sidebarToggleEl = document.getElementById("sidebar-toggle");

function openSidebar()  { sidebarEl.classList.add("open");    sidebarToggleEl.textContent = "✕"; }
function closeSidebar() { sidebarEl.classList.remove("open"); sidebarToggleEl.textContent = "≡"; }

sidebarToggleEl?.addEventListener("click", () => {
  sidebarEl.classList.contains("open") ? closeSidebar() : openSidebar();
});

map.on("click", () => {
  if (isMobile && sidebarEl.classList.contains("open")) closeSidebar();
});

function tryGeolocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.setView(latlng, 14);
      placeMarkerAndCircle(latlng);
      invalidateTrailsCache();
      setSearchButtonsEnabled(true);
    },
    () => { /* permiso denegado o no disponible */ },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

if (isMobile) tryGeolocation();
