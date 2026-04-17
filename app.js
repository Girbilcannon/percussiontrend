const LAYOUT_KEY = "percussion_viewer_layout_v3";
const AUTO_INDEX_URL = "data/compiled/index.json";

const DEFAULT_SUBS = {
  effectMusic: false,
  effectVisual: false,
  effect: false,
  music: false,
  visual: false
};

const DEFAULT_TAB = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
  title: "New Tab",
  graphMode: "groups",
  circuit: "",
  season: "",
  division: "",
  primaryGroup: "",
  compareGroups: [],
  compareSeasons: [],
  subs: { ...DEFAULT_SUBS }
});

const state = {
  index: null,
  sourceName: "",
  tabs: [],
  activeTabId: null
};

function parseEventDateToTime(text) {
  const t = Date.parse(text || "");
  return Number.isNaN(t) ? 0 : t;
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function eventKey(row) {
  return [
    row?.season || "",
    row?.eventDate || "",
    row?.eventName || "",
    row?.division || "",
    row?.circuit || "",
    row?.group || ""
  ].join("|");
}

function loadDemoIfNeeded() {
  if (state.tabs.length === 0) {
    const tab = DEFAULT_TAB();
    tab.title = "Tab 1";
    state.tabs.push(tab);
    state.activeTabId = tab.id;
  }
}

function setCounts() {
  $("eventCount").textContent = String(state.index?.meta?.eventCount || 0);
  $("groupCount").textContent = String(state.index?.meta?.groupCount || 0);
  $("tabCount").textContent = String(state.tabs.length);
}

function getLists() {
  const lists = state.index?.lists || {};
  return {
    groups: lists.groups || [],
    circuits: lists.circuits || [],
    seasons: lists.seasons || [],
    divisions: lists.divisions || []
  };
}

function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function allSelectedGroups(tab) {
  const out = [];
  if (tab.primaryGroup) out.push(tab.primaryGroup);

  for (const g of tab.compareGroups || []) {
    if (g && !out.includes(g)) out.push(g);
  }

  return out;
}

function updateTabTitle(tab) {
  const parts = [];

  if (tab.graphMode === "seasons") {
    if (tab.primaryGroup) parts.push(tab.primaryGroup);
    if ((tab.compareSeasons || []).length) parts.push(`${tab.compareSeasons.length} seasons`);
    parts.push("Season Compare");
  } else {
    const selected = allSelectedGroups(tab);
    if (selected.length === 1) parts.push(selected[0]);
    else if (selected.length > 1) parts.push(`${selected.length} groups`);
  }

  if (tab.circuit) parts.push(tab.circuit);
  if (tab.division) parts.push(tab.division.replace(/^Percussion\s+/i, ""));
  if (tab.graphMode === "groups" && tab.season) parts.push(tab.season);

  tab.title = parts.join(" • ") || "New Tab";
}

function addTab() {
  const tab = DEFAULT_TAB();
  tab.title = `Tab ${state.tabs.length + 1}`;
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  render();
}

function removeTab(tabId) {
  state.tabs = state.tabs.filter((t) => t.id !== tabId);

  if (!state.tabs.length) {
    addTab();
    return;
  }

  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs[0].id;
  }

  render();
}

function saveLayout() {
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({
      tabs: state.tabs,
      activeTabId: state.activeTabId
    })
  );
}

function loadLayout() {
  const raw = localStorage.getItem(LAYOUT_KEY);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    state.tabs = Array.isArray(data.tabs) && data.tabs.length ? data.tabs : [DEFAULT_TAB()];
    state.activeTabId = data.activeTabId || state.tabs[0].id;
  } catch {}

  render();
}

function applyLoadedIndexData(data, sourceName = "") {
  state.index = data;
  state.sourceName = sourceName;

  if (state.tabs.length === 0) {
    addTab();
  }

  applyDefaultLatestSeasons();
  render();
}

async function autoLoadIndex() {
  try {
    const response = await fetch(AUTO_INDEX_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    applyLoadedIndexData(data, AUTO_INDEX_URL);
  } catch (err) {
    console.error("Failed to auto-load index.json:", err);
  }
}

function rowMatchesBaseFilters(row, tab) {
  if (tab.circuit && row.circuit !== tab.circuit) return false;
  if (tab.division && row.division !== tab.division) return false;
  return true;
}

function rowMatchesGroupModeFilters(row, tab) {
  if (!rowMatchesBaseFilters(row, tab)) return false;
  if (tab.season && row.season !== tab.season) return false;
  return true;
}

function rowMatchesSeasonModeFilters(row, tab) {
  if (!rowMatchesBaseFilters(row, tab)) return false;
  if (!tab.primaryGroup) return false;
  if (row.group !== tab.primaryGroup) return false;
  if ((tab.compareSeasons || []).length && !tab.compareSeasons.includes(row.season)) return false;
  return true;
}

function getAvailableGroupsForTab(tab) {
  if (!state.index) return [];
  const groups = state.index.groups || {};
  const available = [];

  for (const [groupName, rows] of Object.entries(groups)) {
    const match = (rows || []).some((r) => {
      if (tab.graphMode === "seasons") return rowMatchesBaseFilters(r, tab);
      return rowMatchesGroupModeFilters(r, tab);
    });

    if (match) available.push(groupName);
  }

  available.sort((a, b) => a.localeCompare(b));
  return available;
}

function getAvailableSeasonsForSeasonMode(tab) {
  if (!state.index || !tab.primaryGroup) return [];

  const groups = state.index.groups || {};
  const rows = groups[tab.primaryGroup] || [];

  const seasons = [
    ...new Set(
      rows
        .filter((r) => rowMatchesBaseFilters(r, tab))
        .map((r) => r.season)
        .filter(Boolean)
    )
  ];

  seasons.sort((a, b) => a.localeCompare(b));
  return seasons;
}

function getLatestAvailableSeasonForTab() {
  const lists = getLists();
  const seasons = lists.seasons || [];
  if (!seasons.length) return "";
  return seasons.slice().sort((a, b) => a.localeCompare(b)).at(-1) || "";
}

function applyDefaultLatestSeasons() {
  for (const tab of state.tabs) {
    if (tab.graphMode === "groups") {
      if (!tab.season) {
        tab.season = getLatestAvailableSeasonForTab(tab);
      }
    } else {
      if (!tab.compareSeasons || !tab.compareSeasons.length) {
        const latest = getLatestAvailableSeasonForTab(tab);
        tab.compareSeasons = latest ? [latest] : [];
      }
    }

    sanitizeTabSelections(tab);
    updateTabTitle(tab);
  }
}

function sanitizeTabSelections(tab) {
  const availableGroups = getAvailableGroupsForTab(tab);
  const allowedGroups = new Set(availableGroups);

  if (tab.primaryGroup && !allowedGroups.has(tab.primaryGroup)) {
    tab.primaryGroup = "";
  }

  tab.compareGroups = (tab.compareGroups || []).filter(
    (g) => allowedGroups.has(g) && g !== tab.primaryGroup
  );
  tab.compareGroups = [...new Set(tab.compareGroups)];

  const availableSeasons = getAvailableSeasonsForSeasonMode(tab);
  const allowedSeasons = new Set(availableSeasons);

  tab.compareSeasons = (tab.compareSeasons || []).filter((s) => allowedSeasons.has(s));
  tab.compareSeasons = [...new Set(tab.compareSeasons)];

  if (tab.graphMode === "groups" && !tab.season) {
    tab.season = getLatestAvailableSeasonForTab(tab);
  }

  if (tab.graphMode === "seasons" && (!tab.compareSeasons || !tab.compareSeasons.length)) {
    const latest = getLatestAvailableSeasonForTab(tab);
    tab.compareSeasons = latest ? [latest] : [];
  }
}

function getFilteredSeries(tab) {
  if (!state.index) return [];

  const groups = state.index.groups || {};
  let rows = [];

  if (tab.graphMode === "seasons") {
    if (!tab.primaryGroup) return [];
    rows.push(...(groups[tab.primaryGroup] || []));
    rows = rows.filter((r) => rowMatchesSeasonModeFilters(r, tab));
  } else {
    for (const groupName of allSelectedGroups(tab)) {
      rows.push(...(groups[groupName] || []));
    }
    rows = rows.filter((r) => rowMatchesGroupModeFilters(r, tab));
  }

  rows.sort((a, b) => {
    const ta = parseEventDateToTime(a.eventDate);
    const tb = parseEventDateToTime(b.eventDate);
    if (ta !== tb) return ta - tb;

    const ea = (a.eventName || "").localeCompare(b.eventName || "");
    if (ea !== 0) return ea;

    const da = (a.division || "").localeCompare(b.division || "");
    if (da !== 0) return da;

    return (a.group || "").localeCompare(b.group || "");
  });

  return rows;
}

function groupSeriesByGroup(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.group)) map.set(row.group, []);
    map.get(row.group).push(row);
  }

  const grouped = Array.from(map.entries()).map(([group, entries]) => ({
    group,
    entries: entries.slice().sort((a, b) => {
      const ta = parseEventDateToTime(a.eventDate);
      const tb = parseEventDateToTime(b.eventDate);
      if (ta !== tb) return ta - tb;

      const ea = (a.eventName || "").localeCompare(b.eventName || "");
      if (ea !== 0) return ea;

      return (a.division || "").localeCompare(b.division || "");
    })
  }));

  grouped.sort((a, b) => a.group.localeCompare(b.group));
  return grouped;
}

function groupSeriesBySeason(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.season)) map.set(row.season, []);
    map.get(row.season).push(row);
  }

  const grouped = Array.from(map.entries()).map(([season, entries]) => ({
    season,
    entries: entries.slice().sort((a, b) => {
      const ta = parseEventDateToTime(a.eventDate);
      const tb = parseEventDateToTime(b.eventDate);
      if (ta !== tb) return ta - tb;

      const ea = (a.eventName || "").localeCompare(b.eventName || "");
      if (ea !== 0) return ea;

      return (a.division || "").localeCompare(b.division || "");
    })
  }));

  grouped.sort((a, b) => a.season.localeCompare(b.season));
  return grouped;
}

function buildTimeline(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = [
      row?.season || "",
      row?.eventDate || "",
      row?.eventName || "",
      row?.division || "",
      row?.circuit || ""
    ].join("|");

    if (!map.has(key)) map.set(key, row);
  }

  return Array.from(map.values()).sort((a, b) => {
    const ta = parseEventDateToTime(a.eventDate);
    const tb = parseEventDateToTime(b.eventDate);
    if (ta !== tb) return ta - tb;

    const ea = (a.eventName || "").localeCompare(b.eventName || "");
    if (ea !== 0) return ea;

    return (a.division || "").localeCompare(b.division || "");
  });
}

function scoreValue(row, key) {
  return row?.scores?.[key];
}

function selectedMetrics(tab) {
  const metrics = ["finalScore"];

  for (const [key, on] of Object.entries(tab.subs || {})) {
    if (on) metrics.push(key);
  }

  return metrics;
}

function buildSvgChartGroupCompare(tab, rows) {
  const grouped = groupSeriesByGroup(rows);
  if (!grouped.length) {
    return `<div class="empty-state">Load index.json and choose a primary group or comparison group.</div>`;
  }

  const timeline = buildTimeline(rows);
  if (!timeline.length) {
    return `<div class="empty-state">No event timeline could be built for the current selection.</div>`;
  }

  const metrics = selectedMetrics(tab);
  const allValues = [];

  for (const g of grouped) {
    for (const row of g.entries) {
      for (const m of metrics) {
        const val = scoreValue(row, m);
        if (typeof val === "number" && !Number.isNaN(val)) {
          allValues.push(val);
        }
      }
    }
  }

  if (!allValues.length) {
    return `<div class="empty-state">No numeric score data matched the current filters.</div>`;
  }

  const width = Math.max(900, timeline.length * 140);
  const height = 440;
  const padL = 56;
  const padR = 20;
  const padT = 20;
  const padB = 90;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const minY = Math.floor(Math.min(...allValues) - 1);
  const maxY = Math.ceil(Math.max(...allValues) + 1);
  const span = Math.max(1, maxY - minY);
  const xCount = Math.max(1, timeline.length - 1);

  const timelineIndex = new Map();
  timeline.forEach((row, idx) => {
    const key = [
      row?.season || "",
      row?.eventDate || "",
      row?.eventName || "",
      row?.division || "",
      row?.circuit || ""
    ].join("|");
    timelineIndex.set(key, idx);
  });

  const colorPool = [
    "#7dd3fc",
    "#fca5a5",
    "#86efac",
    "#c4b5fd",
    "#fcd34d",
    "#67e8f9",
    "#f9a8d4",
    "#bef264",
    "#93c5fd",
    "#fdba74"
  ];

  const metricStyle = {
    finalScore: { dash: "", width: 3 },
    effectMusic: { dash: "5 4", width: 1.8 },
    effectVisual: { dash: "3 5", width: 1.8 },
    music: { dash: "7 4", width: 1.8 },
    visual: { dash: "2 4", width: 1.8 },
    effect: { dash: "6 3", width: 1.8 }
  };

  function xAt(i) {
    return padL + (innerW * (xCount === 0 ? 0 : i / xCount));
  }

  function yAt(v) {
    return padT + innerH - ((v - minY) / span) * innerH;
  }

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><rect x="0" y="0" width="${width}" height="${height}" fill="#0b111b"/>`;

  for (let i = 0; i <= 5; i++) {
    const value = minY + (span * i / 5);
    const y = yAt(value);
    svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#223246" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8aa0b8">${value.toFixed(1)}</text>`;
  }

  timeline.forEach((row, idx) => {
    const x = xAt(idx);
    const labelY = height - padB + 16;
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${height - padB}" stroke="#182233" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${labelY}" text-anchor="end" transform="rotate(-35 ${x} ${labelY})" font-size="11" fill="#8aa0b8">${escapeXml(row.eventDate)}</text>`;
  });

  const legendItems = [];

  grouped.forEach((groupSeries, gi) => {
    const baseColor = colorPool[gi % colorPool.length];

    metrics.forEach((metric) => {
      const pts = groupSeries.entries
        .map((row) => {
          const key = [
            row?.season || "",
            row?.eventDate || "",
            row?.eventName || "",
            row?.division || "",
            row?.circuit || ""
          ].join("|");

          const idx = timelineIndex.get(key);
          const val = scoreValue(row, metric);

          if (typeof val !== "number" || Number.isNaN(val) || idx == null) return null;
          return `${xAt(idx)},${yAt(val)}`;
        })
        .filter(Boolean);

      if (pts.length) {
        const style = metricStyle[metric] || { dash: "", width: 2 };
        svg += `<polyline fill="none" stroke="${baseColor}" stroke-width="${style.width}" ${
          style.dash ? `stroke-dasharray="${style.dash}"` : ""
        } points="${pts.join(" ")}"/>`;

        groupSeries.entries.forEach((row) => {
          const key = [
            row?.season || "",
            row?.eventDate || "",
            row?.eventName || "",
            row?.division || "",
            row?.circuit || ""
          ].join("|");

          const idx = timelineIndex.get(key);
          const val = scoreValue(row, metric);

          if (typeof val !== "number" || Number.isNaN(val) || idx == null) return;

          const x = xAt(idx);
          const y = yAt(val);

          svg += `<circle cx="${x}" cy="${y}" r="${metric === "finalScore" ? 4 : 2.5}" fill="${baseColor}"><title>${escapeXml(
            `${row.group} | ${metric} | ${val} | ${row.eventName} | ${row.eventDate}`
          )}</title></circle>`;
        });

        legendItems.push({
          label: `${groupSeries.group} — ${metric}`,
          color: baseColor,
          dash: style.dash
        });
      }
    });
  });

  svg += `</svg>`;

  const legend = `<div class="legend">${legendItems
    .map(
      (item) =>
        `<div class="legend-item"><span class="legend-line" style="${
          item.dash
            ? `background:none;border-top:2px dashed ${item.color};height:0;`
            : `background:${item.color};`
        }"></span>${escapeHtml(item.label)}</div>`
    )
    .join("")}</div>`;

  return `<div class="chart-wrap">${svg}</div>${legend}`;
}

function buildSvgChartSeasonCompare(tab, rows) {
  const grouped = groupSeriesBySeason(rows);
  if (!grouped.length) {
    return `<div class="empty-state">Choose one group and one or more seasons to compare.</div>`;
  }

  const metrics = selectedMetrics(tab);
  const allValues = [];

  for (const seasonSeries of grouped) {
    for (const row of seasonSeries.entries) {
      for (const m of metrics) {
        const val = scoreValue(row, m);
        if (typeof val === "number" && !Number.isNaN(val)) {
          allValues.push(val);
        }
      }
    }
  }

  if (!allValues.length) {
    return `<div class="empty-state">No numeric score data matched the current filters.</div>`;
  }

  const width = 1100;
  const height = 440;
  const padL = 56;
  const padR = 20;
  const padT = 20;
  const padB = 70;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const minY = Math.floor(Math.min(...allValues) - 1);
  const maxY = Math.ceil(Math.max(...allValues) + 1);
  const span = Math.max(1, maxY - minY);

  const colorPool = [
    "#7dd3fc",
    "#fca5a5",
    "#86efac",
    "#c4b5fd",
    "#fcd34d",
    "#67e8f9",
    "#f9a8d4",
    "#bef264",
    "#93c5fd",
    "#fdba74"
  ];

  const metricStyle = {
    finalScore: { dash: "", width: 3 },
    effectMusic: { dash: "5 4", width: 1.8 },
    effectVisual: { dash: "3 5", width: 1.8 },
    music: { dash: "7 4", width: 1.8 },
    visual: { dash: "2 4", width: 1.8 },
    effect: { dash: "6 3", width: 1.8 }
  };

  function xAtPercent(p) {
    return padL + innerW * p;
  }

  function yAt(v) {
    return padT + innerH - ((v - minY) / span) * innerH;
  }

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><rect x="0" y="0" width="${width}" height="${height}" fill="#0b111b"/>`;

  for (let i = 0; i <= 5; i++) {
    const value = minY + (span * i / 5);
    const y = yAt(value);
    svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#223246" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8aa0b8">${value.toFixed(1)}</text>`;
  }

  svg += `<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="#223246" stroke-width="1"/>`;
  svg += `<text x="${padL}" y="${height - 20}" text-anchor="start" font-size="12" fill="#8aa0b8">Season Start</text>`;
  svg += `<text x="${width - padR}" y="${height - 20}" text-anchor="end" font-size="12" fill="#8aa0b8">Season End</text>`;

  const legendItems = [];

  grouped.forEach((seasonSeries, gi) => {
    const baseColor = colorPool[gi % colorPool.length];
    const times = seasonSeries.entries.map((r) => parseEventDateToTime(r.eventDate)).filter((t) => t > 0);
    const minT = times.length ? Math.min(...times) : 0;
    const maxT = times.length ? Math.max(...times) : 0;
    const rangeT = Math.max(1, maxT - minT);

    metrics.forEach((metric) => {
      const pts = seasonSeries.entries
        .map((row) => {
          const val = scoreValue(row, metric);
          if (typeof val !== "number" || Number.isNaN(val)) return null;

          const t = parseEventDateToTime(row.eventDate);
          let p = 0;

          if (seasonSeries.entries.length === 1) {
            p = 0;
          } else if (t > 0 && maxT > minT) {
            p = (t - minT) / rangeT;
          } else {
            const idx = seasonSeries.entries.indexOf(row);
            p = idx / Math.max(1, seasonSeries.entries.length - 1);
          }

          return `${xAtPercent(p)},${yAt(val)}`;
        })
        .filter(Boolean);

      if (pts.length) {
        const style = metricStyle[metric] || { dash: "", width: 2 };
        svg += `<polyline fill="none" stroke="${baseColor}" stroke-width="${style.width}" ${
          style.dash ? `stroke-dasharray="${style.dash}"` : ""
        } points="${pts.join(" ")}"/>`;

        seasonSeries.entries.forEach((row, idx) => {
          const val = scoreValue(row, metric);
          if (typeof val !== "number" || Number.isNaN(val)) return;

          const t = parseEventDateToTime(row.eventDate);
          let p = 0;

          if (seasonSeries.entries.length === 1) {
            p = 0;
          } else if (t > 0 && maxT > minT) {
            p = (t - minT) / rangeT;
          } else {
            p = idx / Math.max(1, seasonSeries.entries.length - 1);
          }

          const x = xAtPercent(p);
          const y = yAt(val);

          svg += `<circle cx="${x}" cy="${y}" r="${metric === "finalScore" ? 4 : 2.5}" fill="${baseColor}"><title>${escapeXml(
            `${row.group} | Season ${row.season} | ${metric} | ${val} | ${row.eventName} | ${row.eventDate} | ${row.division}`
          )}</title></circle>`;
        });

        legendItems.push({
          label: `${seasonSeries.season} — ${metric}`,
          color: baseColor,
          dash: style.dash
        });
      }
    });
  });

  svg += `</svg>`;

  const legend = `<div class="legend">${legendItems
    .map(
      (item) =>
        `<div class="legend-item"><span class="legend-line" style="${
          item.dash
            ? `background:none;border-top:2px dashed ${item.color};height:0;`
            : `background:${item.color};`
        }"></span>${escapeHtml(item.label)}</div>`
    )
    .join("")}</div>`;

  return `<div class="chart-wrap">${svg}</div>${legend}`;
}

function buildSvgChart(tab, rows) {
  if (tab.graphMode === "seasons") return buildSvgChartSeasonCompare(tab, rows);
  return buildSvgChartGroupCompare(tab, rows);
}

function buildSeriesRows(tab, rows) {
  if (tab.graphMode === "seasons") {
    const grouped = groupSeriesBySeason(rows);
    if (!grouped.length) return `<div class="empty-state">No season rows matched this tab yet.</div>`;

    return `<div class="series-list">${grouped
      .map((g) => {
        const latest = g.entries[g.entries.length - 1];
        return `<div class="series-row"><div><strong>${escapeHtml(g.season)}</strong><div class="series-meta"><span class="chip">${escapeHtml(
          latest.circuit || "No circuit"
        )}</span><span class="chip">${escapeHtml(
          latest.division || "Mixed / No division"
        )}</span><span class="chip">${g.entries.length} events</span></div></div><div class="chip">Latest ${escapeHtml(
          String(latest.scores?.finalScore ?? "—")
        )}</div></div>`;
      })
      .join("")}</div>`;
  }

  const grouped = groupSeriesByGroup(rows);
  if (!grouped.length) return `<div class="empty-state">No rows matched this tab yet.</div>`;

  return `<div class="series-list">${grouped
    .map((g) => {
      const latest = g.entries[g.entries.length - 1];
      return `<div class="series-row"><div><strong>${escapeHtml(g.group)}</strong><div class="series-meta"><span class="chip">${escapeHtml(
        latest.circuit || "No circuit"
      )}</span><span class="chip">${escapeHtml(
        latest.season || "No season"
      )}</span><span class="chip">${escapeHtml(
        latest.division || "No division"
      )}</span><span class="chip">${g.entries.length} events</span></div></div><div class="chip">Latest ${escapeHtml(
        String(latest.scores?.finalScore ?? "—")
      )}</div></div>`;
    })
    .join("")}</div>`;
}

function buildDataTable(rows) {
  if (!rows.length) return `<div class="empty-state">No progression rows to show.</div>`;

  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Group</th><th>Date</th><th>Event</th><th>Circuit</th><th>Season</th><th>Division</th><th>Final</th><th>Rank</th><th>Penalty</th><th>Effect-Music</th><th>Effect-Visual</th><th>Effect/Artistry</th><th>Music</th><th>Visual</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.group)}</td><td title="${escapeHtml(r.eventName)}">${escapeHtml(
          r.eventDate
        )}</td><td>${escapeHtml(r.eventName)}</td><td>${escapeHtml(
          r.circuit
        )}</td><td>${escapeHtml(r.season)}</td><td>${escapeHtml(
          r.division
        )}</td><td>${escapeHtml(r.scores?.finalScore)}</td><td>${escapeHtml(
          r.scores?.finalRank
        )}</td><td>${escapeHtml(r.scores?.penalty)}</td><td>${escapeHtml(
          r.scores?.effectMusic
        )}</td><td>${escapeHtml(r.scores?.effectVisual)}</td><td>${escapeHtml(
          r.scores?.effect
        )}</td><td>${escapeHtml(r.scores?.music)}</td><td>${escapeHtml(
          r.scores?.visual
        )}</td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

function optionHtml(value, selected, label = null) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(
    label ?? (value || "All")
  )}</option>`;
}

function renderCompareChips(tab) {
  if (!(tab.compareGroups || []).length) {
    return `<div class="small-note">No comparison groups added.</div>`;
  }

  return `<div class="group-list">${tab.compareGroups
    .map(
      (g) =>
        `<span class="chip remove-chip" data-action="remove-compare-group" data-group="${escapeHtml(g)}">${escapeHtml(
          g
        )} ×</span>`
    )
    .join("")}</div>`;
}

function renderSeasonChips(tab) {
  if (!(tab.compareSeasons || []).length) {
    return `<div class="small-note">No seasons added.</div>`;
  }

  return `<div class="group-list">${tab.compareSeasons
    .map(
      (s) =>
        `<span class="chip remove-chip" data-action="remove-compare-season" data-season="${escapeHtml(s)}">${escapeHtml(
          s
        )} ×</span>`
    )
    .join("")}</div>`;
}

function renderTabControls(tab) {
  const lists = getLists();
  const rows = getFilteredSeries(tab);
  const availableGroups = getAvailableGroupsForTab(tab);
  const availableCompare = availableGroups.filter(
    (g) => g !== tab.primaryGroup && !(tab.compareGroups || []).includes(g)
  );
  const availableSeasons = getAvailableSeasonsForSeasonMode(tab);
  const availableSeasonCompare = availableSeasons.filter(
    (s) => !(tab.compareSeasons || []).includes(s)
  );

  const groupModeFilters = `
    <div class="field">
      <label>Season</label>
      <select data-action="set-season">
        ${optionHtml("", tab.season, "All")}
        ${lists.seasons.map((v) => optionHtml(v, tab.season)).join("")}
      </select>
    </div>

    <div class="field span-2">
      <label>Division</label>
      <select data-action="set-division">
        ${optionHtml("", tab.division)}
        ${lists.divisions.map((v) => optionHtml(v, tab.division)).join("")}
      </select>
    </div>

    <div class="field span-2">
      <label>Primary Group</label>
      <select data-action="set-primary-group">
        ${optionHtml("", tab.primaryGroup, "Select group")}
        ${availableGroups.map((v) => optionHtml(v, tab.primaryGroup)).join("")}
      </select>
    </div>

    <div class="field span-2">
      <label>Compare Group</label>
      <select data-action="add-compare-group">
        ${optionHtml("", "", "Add group")}
        ${availableCompare.map((v) => optionHtml(v, "")).join("")}
      </select>
      ${renderCompareChips(tab)}
    </div>
  `;

  const seasonModeFilters = `
    <div class="field">
      <label>Circuit</label>
      <select data-action="set-circuit">
        ${optionHtml("", tab.circuit)}
        ${lists.circuits.map((v) => optionHtml(v, tab.circuit)).join("")}
      </select>
    </div>

    <div class="field">
      <label>Division (Optional)</label>
      <select data-action="set-division">
        ${optionHtml("", tab.division)}
        ${lists.divisions.map((v) => optionHtml(v, tab.division)).join("")}
      </select>
    </div>

    <div class="field span-2">
      <label>Group</label>
      <select data-action="set-primary-group">
        ${optionHtml("", tab.primaryGroup, "Select group")}
        ${availableGroups.map((v) => optionHtml(v, tab.primaryGroup)).join("")}
      </select>
    </div>

    <div class="field span-2">
      <label>Compare Seasons</label>
      <select data-action="add-compare-season">
        ${optionHtml("", "", "Add season")}
        ${availableSeasonCompare.map((v) => optionHtml(v, "")).join("")}
      </select>
      ${renderSeasonChips(tab)}
    </div>
  `;

  return `
    <div class="tab-layout">
      <div class="tab-controls">
        <div class="control-card">
          <h3>Tab Filters</h3>
          <div class="control-grid">
            <div class="field span-2">
              <label>Graph Mode</label>
              <select data-action="set-graph-mode">
                ${optionHtml("groups", tab.graphMode, "Compare Groups")}
                ${optionHtml("seasons", tab.graphMode, "Compare Seasons")}
              </select>
            </div>

            ${
              tab.graphMode === "seasons"
                ? seasonModeFilters
                : `
              <div class="field">
                <label>Circuit</label>
                <select data-action="set-circuit">
                  ${optionHtml("", tab.circuit)}
                  ${lists.circuits.map((v) => optionHtml(v, tab.circuit)).join("")}
                </select>
              </div>
              ${groupModeFilters}
            `
            }
          </div>
        </div>

        <div class="control-card">
          <h3>Display</h3>
          <div class="toggle-row">
            <label class="toggle-pill"><input type="checkbox" data-action="toggle-sub" data-metric="effectMusic" ${
              tab.subs.effectMusic ? "checked" : ""
            }/> Effect-Music</label>
            <label class="toggle-pill"><input type="checkbox" data-action="toggle-sub" data-metric="effectVisual" ${
              tab.subs.effectVisual ? "checked" : ""
            }/> Effect-Visual</label>
            <label class="toggle-pill"><input type="checkbox" data-action="toggle-sub" data-metric="effect" ${
              tab.subs.effect ? "checked" : ""
            }/> Effect/Artistry</label>
            <label class="toggle-pill"><input type="checkbox" data-action="toggle-sub" data-metric="music" ${
              tab.subs.music ? "checked" : ""
            }/> Music</label>
            <label class="toggle-pill"><input type="checkbox" data-action="toggle-sub" data-metric="visual" ${
              tab.subs.visual ? "checked" : ""
            }/> Visual</label>
          </div>
          <div class="small-note" style="margin-top:8px">Final score is always shown. Turn individual subscore lines on only when you need them.</div>
        </div>

        <div class="control-card">
          <h3>Selection Summary</h3>
          ${buildSeriesRows(tab, rows)}
        </div>
      </div>

      <div>
        <div class="chart-card">
          <div class="chart-head">
            <div>
              <h3>${escapeHtml(tab.title)}</h3>
              <div class="small-note">${
                tab.graphMode === "seasons"
                  ? "Season Compare uses real date spacing within each season so missed weeks and later championship rounds naturally extend farther right."
                  : "Primary and comparison groups layer on the same graph. Hover points for event info."
              }</div>
            </div>
          </div>
          ${buildSvgChart(tab, rows)}
        </div>

        <div class="table-card">
          <h3 style="margin-bottom:8px">Progression Data</h3>
          ${buildDataTable(rows)}
        </div>
      </div>
    </div>
  `;
}

function renderTabs() {
  const bar = $("tabBar");
  const content = $("tabContent");
  bar.innerHTML = "";

  const template = $("tabButtonTemplate");

  state.tabs.forEach((tab) => {
    sanitizeTabSelections(tab);
    updateTabTitle(tab);

    const node = template.content.cloneNode(true);
    const btn = node.querySelector(".tab-button");
    btn.dataset.tabId = tab.id;

    if (tab.id === state.activeTabId) {
      btn.classList.add("active");
    }

    node.querySelector(".tab-title").textContent = tab.title;
    node.querySelector(".tab-close").dataset.closeTabId = tab.id;
    bar.appendChild(node);
  });

  const active = getActiveTab();
  if (!active) {
    content.innerHTML = `<div class="empty-state">Add a tab to begin.</div>`;
    return;
  }

  sanitizeTabSelections(active);
  content.innerHTML = renderTabControls(active);
}

function render() {
  loadDemoIfNeeded();
  setCounts();
  renderTabs();
}

function onTabBarClick(e) {
  const close = e.target.closest("[data-close-tab-id]");
  if (close) {
    e.stopPropagation();
    removeTab(close.dataset.closeTabId);
    return;
  }

  const btn = e.target.closest("[data-tab-id]");
  if (btn) {
    state.activeTabId = btn.dataset.tabId;
    render();
  }
}

function onTabContentChange(e) {
  const tab = getActiveTab();
  if (!tab) return;

  const action = e.target.dataset.action;
  if (!action) return;

  if (action === "set-graph-mode") {
    tab.graphMode = e.target.value;

    if (tab.graphMode === "seasons") {
      tab.season = "";
      tab.compareGroups = [];

      if (!tab.compareSeasons.length) {
        const latest = getLatestAvailableSeasonForTab(tab);
        tab.compareSeasons = latest ? [latest] : [];
      }
    } else {
      tab.compareSeasons = [];

      if (!tab.season) {
        tab.season = getLatestAvailableSeasonForTab(tab);
      }
    }

    sanitizeTabSelections(tab);
  } else if (action === "set-circuit") {
    tab.circuit = e.target.value;
    sanitizeTabSelections(tab);
  } else if (action === "set-season") {
    tab.season = e.target.value;
    sanitizeTabSelections(tab);
  } else if (action === "set-division") {
    tab.division = e.target.value;
    sanitizeTabSelections(tab);
  } else if (action === "set-primary-group") {
    tab.primaryGroup = e.target.value;
    tab.compareGroups = (tab.compareGroups || []).filter((g) => g !== tab.primaryGroup);
    sanitizeTabSelections(tab);
  } else if (action === "add-compare-group") {
    const value = e.target.value;

    if (value && value !== tab.primaryGroup && !(tab.compareGroups || []).includes(value)) {
      tab.compareGroups.push(value);
    }

    sanitizeTabSelections(tab);
    e.target.value = "";
  } else if (action === "add-compare-season") {
    const value = e.target.value;

    if (value && !(tab.compareSeasons || []).includes(value)) {
      tab.compareSeasons.push(value);
    }

    sanitizeTabSelections(tab);
    e.target.value = "";
  } else if (action === "toggle-sub") {
    const metric = e.target.dataset.metric;
    tab.subs[metric] = e.target.checked;
  }

  updateTabTitle(tab);
  render();
}

function onTabContentClick(e) {
  const groupChip = e.target.closest('[data-action="remove-compare-group"]');
  if (groupChip) {
    const tab = getActiveTab();
    if (!tab) return;

    const group = groupChip.dataset.group;
    tab.compareGroups = (tab.compareGroups || []).filter((g) => g !== group);
    updateTabTitle(tab);
    render();
    return;
  }

  const seasonChip = e.target.closest('[data-action="remove-compare-season"]');
  if (seasonChip) {
    const tab = getActiveTab();
    if (!tab) return;

    const season = seasonChip.dataset.season;
    tab.compareSeasons = (tab.compareSeasons || []).filter((s) => s !== season);
    updateTabTitle(tab);
    render();
  }
}

function wire() {
  $("addTabBtn").addEventListener("click", addTab);

  $("saveLayoutBtn").addEventListener("click", () => {
    saveLayout();
    alert("Layout saved.");
  });

  $("loadLayoutBtn").addEventListener("click", () => {
    loadLayout();
    alert("Layout loaded.");
  });

  $("tabBar").addEventListener("click", onTabBarClick);
  $("tabContent").addEventListener("change", onTabContentChange);
  $("tabContent").addEventListener("click", onTabContentClick);
}

wire();
loadDemoIfNeeded();
applyDefaultLatestSeasons();
render();
autoLoadIndex();