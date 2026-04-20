/* ═══════════════════════════════════════════════════════════════
   India Border Surveillance — Web Edition
   Pure JS + Leaflet.js  (no backend required)
   ═══════════════════════════════════════════════════════════════ */

// ── Zone geometry ────────────────────────────────────────────────
const POLYGON = [
  [37.1, 73.9], [35.5, 77.8], [28.0, 97.3], [22.0, 92.3],
  [8.4,  77.5], [8.5,  76.9], [20.0, 68.7], [24.0, 68.1]
];
const BOUNDS  = { latMin: 8.4, latMax: 37.6, lonMin: 68.7, lonMax: 97.4 };
const BUFFER  = 2.0;

const COLORS = { INSIDE: "#00c853", BUFFER: "#ffd600", OUTSIDE: "#d50000" };
const LABELS = {
  INSIDE:  "✅ Inside India",
  BUFFER:  "⚠️ Buffer Zone — WARNING",
  OUTSIDE: "🚨 Outside India"
};

/** Ray-casting point-in-polygon test */
function getZone(lat, lon) {
  let inside = false;
  const n = POLYGON.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = POLYGON[i];
    const [yj, xj] = POLYGON[j];
    if ((yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  if (inside) return "INSIDE";
  const { latMin, latMax, lonMin, lonMax } = BOUNDS;
  return (lat >= latMin - BUFFER && lat <= latMax + BUFFER &&
          lon >= lonMin - BUFFER && lon <= lonMax + BUFFER)
    ? "BUFFER" : "OUTSIDE";
}

// ── Route data (mirrors routes.csv) ─────────────────────────────
const ROUTES = {
  "India → China (IND→CHN)": [
    [28.61, 77.20], [30.00, 79.00], [31.50, 81.00],
    [33.00, 83.00], [34.50, 85.00]
  ],
  "Colombo → Chennai (LKA→IND)": [
    [6.92, 79.86], [7.50, 79.90], [8.10, 80.10],
    [8.60, 80.20], [10.07, 78.97]
  ],
  "Delhi → Kathmandu (IND→NEP)": [
    [28.61, 77.20], [28.70, 80.00], [27.90, 82.00],
    [27.71, 85.32], [27.70, 85.50]
  ],
  "Kabul → Amritsar (AFG→IND)": [
    [34.55, 69.20], [33.00, 70.50], [31.80, 72.00],
    [31.60, 74.57], [31.63, 74.87]
  ]
};

// ── Leaflet map setup ────────────────────────────────────────────
const map = L.map("map", {
  center: [22, 82],
  zoom: 4,
  zoomControl: true,
  attributionControl: true
});

// Dark tile layer
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19
  }
).addTo(map);

// India polygon overlay
L.polygon(POLYGON, {
  color: "#00ff88",
  weight: 2,
  fillColor: "#003300",
  fillOpacity: 0.25
}).addTo(map).bindTooltip("India Border", { permanent: false, direction: "center" });

// Buffer zone rectangle
const { latMin, latMax, lonMin, lonMax } = BOUNDS;
L.rectangle(
  [[latMin - BUFFER, lonMin - BUFFER], [latMax + BUFFER, lonMax + BUFFER]],
  { color: "#ffd600", weight: 1.5, dashArray: "6 4", fill: false }
).addTo(map);

// Country labels (custom divIcon markers)
const countryLabels = [
  { name: "INDIA",     pos: [22, 82] },
  { name: "PAK",       pos: [30, 70] },
  { name: "CHINA",     pos: [35, 90] },
  { name: "BANG",      pos: [24, 91] },
  { name: "SRI LANKA", pos: [7,  81] }
];
countryLabels.forEach(({ name, pos }) => {
  L.marker(pos, {
    icon: L.divIcon({
      className: "",
      html: `<span style="color:#4a6a8a;font-family:'Courier New',monospace;font-size:10px;font-weight:bold;white-space:nowrap;">${name}</span>`,
      iconAnchor: [20, 8]
    }),
    interactive: false
  }).addTo(map);
});

// ── UI elements ──────────────────────────────────────────────────
const routeSelect = document.getElementById("routeSelect");
const startBtn    = document.getElementById("startBtn");
const statusText  = document.getElementById("statusText");
const eventLog    = document.getElementById("eventLog");
const coordBar    = document.getElementById("coordBar");
const speedSlider = document.getElementById("speedSlider");
const speedVal    = document.getElementById("speedVal");

// Populate route dropdown
Object.keys(ROUTES).forEach(name => {
  const opt = document.createElement("option");
  opt.value = opt.textContent = name;
  routeSelect.appendChild(opt);
});

// Speed slider display
speedSlider.addEventListener("input", () => {
  speedVal.textContent = (speedSlider.value / 1000).toFixed(1) + " s";
});

// Coordinate display on map hover
map.on("mousemove", e => {
  coordBar.textContent =
    `Lat: ${e.latlng.lat.toFixed(4)}°N   Lon: ${e.latlng.lng.toFixed(4)}°E`;
});

// ── Tracking state ───────────────────────────────────────────────
let trailLayers = [];   // polyline segments
let dotMarker   = null; // current position marker
let stepTimer   = null; // setTimeout handle

function clearTrail() {
  trailLayers.forEach(l => map.removeLayer(l));
  trailLayers = [];
  if (dotMarker) { map.removeLayer(dotMarker); dotMarker = null; }
}

function appendLog(msg, cssClass) {
  const line = document.createElement("div");
  line.className = cssClass || "";
  line.textContent = msg;
  eventLog.appendChild(line);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function clearLog() { eventLog.innerHTML = ""; }

// ── Animated dot marker ──────────────────────────────────────────
function makeDotIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 0 8px ${color};
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

// ── Main step function ───────────────────────────────────────────
function step(pts, i, prevZone) {
  if (i >= pts.length) {
    startBtn.disabled = false;
    startBtn.textContent = "▶  START TRACKING";
    statusText.textContent = "✔ Tracking complete.";
    statusText.style.color = "#e6edf3";
    return;
  }

  const [lat, lon] = pts[i];
  const zone  = getZone(lat, lon);
  const color = COLORS[zone];

  // Draw trail segment
  if (i > 0) {
    const seg = L.polyline([pts[i - 1], [lat, lon]], {
      color, weight: 3, opacity: 0.85
    }).addTo(map);
    trailLayers.push(seg);
  }

  // Move dot
  if (dotMarker) map.removeLayer(dotMarker);
  dotMarker = L.marker([lat, lon], { icon: makeDotIcon(color), zIndexOffset: 1000 }).addTo(map);

  // Border crossing alert
  if (prevZone && prevZone !== zone) {
    const alertCircle = L.circle([lat, lon], {
      radius: 40000, color, weight: 2, fill: false
    }).addTo(map);
    trailLayers.push(alertCircle);
    appendLog(`🚨 BORDER CROSSED! Step ${i + 1}`, "log-alert");
  }

  // Log entry
  const logClass = `log-${zone.toLowerCase()}`;
  appendLog(`Step ${i + 1}  ${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`, logClass);
  appendLog(`  → ${LABELS[zone]}`, logClass);

  // Status panel
  statusText.textContent = `Step ${i + 1}/${pts.length}\n${LABELS[zone]}`;
  statusText.style.color = color;

  // Coord bar
  coordBar.textContent =
    `Lat: ${lat.toFixed(4)}°N   Lon: ${lon.toFixed(4)}°E   |   ${zone}`;

  // Pan map to current point
  map.panTo([lat, lon], { animate: true, duration: 0.5 });

  // Schedule next step
  const delay = parseInt(speedSlider.value, 10);
  stepTimer = setTimeout(() => step(pts, i + 1, zone), delay);
}

// ── Start button ─────────────────────────────────────────────────
startBtn.addEventListener("click", () => {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  clearTrail();
  clearLog();

  const name = routeSelect.value;
  const pts  = ROUTES[name];

  startBtn.disabled = true;
  startBtn.textContent = "Tracking…";
  statusText.textContent = "Starting…";
  statusText.style.color = "#e6edf3";

  // Fit map to route bounds
  map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: true });

  // Small delay so fitBounds animation settles
  setTimeout(() => step(pts, 0, null), 600);
});
