/**
 * k6 Cyber-Fortress — Main Application Controller
 * Supports:
 *  - Replay of completed k6 runs from InfluxDB 1.8 / Grafana or built-in scenarios
 *  - Real-time LIVE VIEW monitoring & on-the-fly movie rendering
 *  - Dynamic 3D Load Agent (Runner) count based on actual runners used
 */

import { SCENARIO_PRESETS, computeThermalState } from './demo-data.js';
import { InfluxK6Client, normalizeInfluxResponse } from './influx-client.js';
import { CyberFortressDirector } from './fortress-scene.js';
import { FortressVideoExporter } from './video-exporter.js';

const canvas = document.getElementById('cinema-canvas');
const scenarioSelect = document.getElementById('scenario-select');
const runnerCountSelect = document.getElementById('runner-count-select');
const liveViewBtn = document.getElementById('live-view-btn');
const toggleSummaryBtn = document.getElementById('toggle-summary-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const restartBtn = document.getElementById('restart-btn');
const timelineSlider = document.getElementById('timeline-slider');
const timeReadout = document.getElementById('time-readout');
const speedSelect = document.getElementById('speed-select');
const generateMovieBtn = document.getElementById('generate-movie-btn');
const recordClipBtn = document.getElementById('record-clip-btn');
const connectionStatusText = document.getElementById('connection-status-text');

// Dialog Elements
const influxDialog = document.getElementById('influx-dialog');
const openInfluxBtn = document.getElementById('open-influx-btn');
const closeInfluxBtn = document.getElementById('close-influx-btn');
const testConnectionBtn = document.getElementById('test-connection-btn');
const loadInfluxRunBtn = document.getElementById('load-influx-run-btn');
const startLiveInfluxBtn = document.getElementById('start-live-influx-btn');
const applySlaOnlyBtn = document.getElementById('apply-sla-only-btn');
const influxStatusBanner = document.getElementById('influx-status-banner');
const influxTimeMode = document.getElementById('influx-time-mode');
const relativeWindowGroup = document.getElementById('relative-window-group');
const customTimeGroup = document.getElementById('custom-time-group');
const jsonFileImport = document.getElementById('json-file-import');

// Initialize 3D Cyber-Fortress Director
const director = new CyberFortressDirector(canvas, { numLoadAgents: 6 });

// Playback & Live Stream state
let frames = [];
let playheadFloat = 0;
let isPlaying = true;
let playbackSpeed = 4;
let isGeneratingFullMovie = false;
let movieEndHoldTimer = null;

// Live View Polling Timer
let isLiveMode = false;
let livePollInterval = null;
let liveSimTick = 0;

function syncSummaryButtonUI() {
  if (director.showSummaryOverlay) {
    toggleSummaryBtn.classList.add('btn-primary');
    toggleSummaryBtn.textContent = '📊 Hide Summary';
  } else {
    toggleSummaryBtn.classList.remove('btn-primary');
    toggleSummaryBtn.textContent = '📊 Test Summary';
  }
}

function syncLiveButtonUI() {
  director.isLiveMode = isLiveMode;
  if (isLiveMode) {
    liveViewBtn.classList.add('btn-movie', 'recording');
    liveViewBtn.textContent = '⏹ Stop Live Run';
    timelineSlider.disabled = true;
    playPauseBtn.disabled = true;
    restartBtn.disabled = true;
  } else {
    liveViewBtn.classList.remove('btn-movie', 'recording');
    liveViewBtn.textContent = '🔴 Live View';
    timelineSlider.disabled = false;
    playPauseBtn.disabled = false;
    restartBtn.disabled = false;
  }
}

// Video Exporter
const exporter = new FortressVideoExporter(canvas, ({ isRecording }) => {
  if (isRecording) {
    recordClipBtn.textContent = '⏹ Stop Recording';
    recordClipBtn.classList.add('btn-movie', 'recording');
    if (isGeneratingFullMovie) {
      generateMovieBtn.textContent = '🔴 Recording Movie... (Click to Stop & Save)';
      generateMovieBtn.classList.add('recording');
    }
  } else {
    isGeneratingFullMovie = false;
    if (movieEndHoldTimer) {
      clearTimeout(movieEndHoldTimer);
      movieEndHoldTimer = null;
    }
    recordClipBtn.textContent = '⏺ Record Clip';
    recordClipBtn.classList.remove('btn-movie', 'recording');
    generateMovieBtn.textContent = '🎬 Generate Full Movie (.webm)';
    generateMovieBtn.classList.remove('recording');
  }
});

// Range Slider synchronization (following modern-web-guidance `slider` pattern)
function syncSliderValue() {
  timelineSlider.style.setProperty('--attr-min', timelineSlider.min || 0);
  timelineSlider.style.setProperty('--attr-max', timelineSlider.max || 100);
  timelineSlider.style.setProperty('--control-value', timelineSlider.value);

  const idx = Math.min(frames.length - 1, Math.max(0, Math.round(Number(timelineSlider.value))));
  const f = frames[idx];
  const totalSec = frames.length ? frames[frames.length - 1].elapsedSec : 0;
  const curSec = f ? f.elapsedSec : 0;
  const formatted = isLiveMode
    ? `LIVE T+${formatMMSS(curSec)}`
    : `${formatMMSS(curSec)} / ${formatMMSS(totalSec)}`;
  timeReadout.textContent = formatted;
  timelineSlider.setAttribute('aria-valuetext', `${formatted}, P95 latency ${f ? f.p95 : 0} milliseconds`);

  const thermal = computeThermalState(f, director.thresholds);
  timelineSlider.style.setProperty('--slider-fill-color', thermal.colorHex);
}

function formatMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function resolveRunnerCount(detectedAgents = []) {
  const sel = runnerCountSelect.value;
  if (sel === 'auto') {
    return detectedAgents && detectedAgents.length > 0 ? detectedAgents.length : 6;
  }
  return Math.max(1, Math.min(16, Number(sel) || 6));
}

function loadScenarioPreset(presetId) {
  stopLiveView(false);
  const preset = SCENARIO_PRESETS[presetId] || SCENARIO_PRESETS.citadel_siege;
  frames = preset.generate();
  playheadFloat = 0;

  timelineSlider.min = '0';
  timelineSlider.max = String(Math.max(1, frames.length - 1));
  timelineSlider.value = '0';

  const numLoadAgents = resolveRunnerCount(preset.endpoints);
  director.setDataset(frames, {
    title: preset.name,
    sourceLabel: `K6 PRESET // ${preset.subtitle}`,
    endpoints: preset.endpoints,
    numLoadAgents
  });
  syncSummaryButtonUI();
  syncSliderValue();
}

function getInterpolatedFrame(floatIndex) {
  if (!frames.length) return null;
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(floatIndex)));
  const i1 = Math.max(0, Math.min(frames.length - 1, i0 + 1));
  const alpha = floatIndex - i0;
  const f0 = frames[i0];
  const f1 = frames[i1];

  return {
    index: floatIndex,
    timestamp: Math.round(f0.timestamp + (f1.timestamp - f0.timestamp) * alpha),
    elapsedSec: f0.elapsedSec + (f1.elapsedSec - f0.elapsedSec) * alpha,
    vus: Math.round(f0.vus + (f1.vus - f0.vus) * alpha),
    rps: Math.round(f0.rps + (f1.rps - f0.rps) * alpha),
    p50: Math.round(f0.p50 + (f1.p50 - f0.p50) * alpha),
    p95: Math.round(f0.p95 + (f1.p95 - f0.p95) * alpha),
    p99: Math.round(f0.p99 + (f1.p99 - f0.p99) * alpha),
    errorRate: Number((f0.errorRate + (f1.errorRate - f0.errorRate) * alpha).toFixed(2)),
    failedReqs: Math.round(f0.failedReqs + (f1.failedReqs - f0.failedReqs) * alpha),
    checksPassRate: Number((f0.checksPassRate + (f1.checksPassRate - f0.checksPassRate) * alpha).toFixed(1))
  };
}

// Live View Engine (Polls InfluxDB 1.8 in real time or streams on-the-fly telemetry)
async function startLiveView(preferInflux = false) {
  if (isLiveMode) stopLiveView(false);

  isLiveMode = true;
  director.showSummaryOverlay = false;
  syncSummaryButtonUI();
  syncLiveButtonUI();

  const client = buildInfluxClientFromForm();
  let usingRealInflux = false;

  // Try polling real InfluxDB first
  try {
    const liveData = await client.fetchLiveTelemetry({
      liveWindow: '3m',
      bucketInterval: document.getElementById('influx-bucket').value || '1s',
      tagFilter: document.getElementById('influx-tag-filter').value
    });
    usingRealInflux = true;
    applyLivePollResult(liveData, client);
  } catch (err) {
    if (preferInflux) {
      influxStatusBanner.classList.add('error');
      influxStatusBanner.textContent = `⚠️ Live InfluxDB not reachable (${err.message}). Starting On-The-Fly Live Stream Simulator instead!`;
    }
    // Initialize Live On-The-Fly Stream from t=0
    liveSimTick = 0;
    const baseFrames = SCENARIO_PRESETS[scenarioSelect.value]?.generate() || SCENARIO_PRESETS.citadel_siege.generate();
    frames = baseFrames.slice(0, 3);
    playheadFloat = frames.length - 1;
    const numLoadAgents = resolveRunnerCount(director.endpoints);
    director.setDataset(frames, {
      title: 'LIVE K6 EXECUTION STREAM',
      sourceLabel: 'ON-THE-FLY TELEMETRY RENDERER',
      numLoadAgents
    });
    connectionStatusText.textContent = `🔴 LIVE VIEW: ON-THE-FLY STREAMING (${director.numLoadAgents} LOAD AGENTS ACTIVE)`;
  }

  livePollInterval = setInterval(async () => {
    if (!isLiveMode) return;

    if (usingRealInflux) {
      try {
        const liveData = await client.fetchLiveTelemetry({
          liveWindow: '3m',
          bucketInterval: document.getElementById('influx-bucket').value || '1s',
          tagFilter: document.getElementById('influx-tag-filter').value
        });
        applyLivePollResult(liveData, client);
      } catch (_) {}
    } else {
      // Append next live second on the fly
      liveSimTick++;
      const template = SCENARIO_PRESETS[scenarioSelect.value]?.generate() || SCENARIO_PRESETS.citadel_siege.generate();
      const srcFrame = template[(liveSimTick + 2) % template.length];
      const nextIdx = frames.length;
      const liveFrame = {
        ...srcFrame,
        index: nextIdx,
        timestamp: Date.now(),
        elapsedSec: nextIdx
      };
      frames.push(liveFrame);
      if (frames.length > 180) {
        frames.shift();
        frames.forEach((f, idx) => { f.index = idx; });
      }
      playheadFloat = frames.length - 1;
      timelineSlider.max = String(Math.max(1, frames.length - 1));
      timelineSlider.value = String(playheadFloat);
      director.updateLiveFrames(frames);
      syncSliderValue();
    }
  }, 1000);
}

function applyLivePollResult(liveData, client) {
  frames = liveData.frames;
  playheadFloat = Math.max(0, frames.length - 1);
  timelineSlider.min = '0';
  timelineSlider.max = String(Math.max(1, frames.length - 1));
  timelineSlider.value = String(playheadFloat);

  const numLoadAgents = resolveRunnerCount(liveData.detectedAgents);
  director.updateLiveFrames(frames, {
    title: `LIVE // ${client.database.toUpperCase()}`,
    sourceLabel: `${client.url} · RUNNER TAG: ${liveData.runnerTagKey}`,
    endpoints: liveData.endpoints,
    numLoadAgents,
    loadAgentNames: liveData.detectedAgents
  });
  connectionStatusText.textContent = `🔴 LIVE INFLUXDB: ${client.url}/${client.database} (${numLoadAgents} LOAD AGENTS)`;
  syncSliderValue();
}

function stopLiveView(showSummary = true) {
  if (!isLiveMode) return;
  isLiveMode = false;
  if (livePollInterval) {
    clearInterval(livePollInterval);
    livePollInterval = null;
  }
  syncLiveButtonUI();

  if (showSummary && frames.length > 1) {
    isPlaying = false;
    playPauseBtn.textContent = '▶ REPLAY';
    director.showSummaryOverlay = true;
    syncSummaryButtonUI();

    if (exporter.isRecording && !movieEndHoldTimer) {
      // Hold on the End-of-Test Summary for 3.5s so live recording ends with the summary
      movieEndHoldTimer = setTimeout(() => {
        movieEndHoldTimer = null;
        if (exporter.isRecording) exporter.stopRecording();
      }, 3500);
    }
  }
}

// UI Event Listeners
scenarioSelect.addEventListener('change', (e) => {
  loadScenarioPreset(e.target.value);
  isPlaying = true;
  playPauseBtn.textContent = '⏸ PAUSE';
  connectionStatusText.textContent = `SOURCE: ${SCENARIO_PRESETS[e.target.value]?.name.toUpperCase() || 'K6 SCENARIO'}`;
});

runnerCountSelect.addEventListener('change', () => {
  const numLoadAgents = resolveRunnerCount(director.loadAgentNames);
  director.setLoadAgentCount(numLoadAgents, director.loadAgentNames);
});

liveViewBtn.addEventListener('click', () => {
  if (isLiveMode) {
    stopLiveView(true);
  } else {
    startLiveView(false);
  }
});

toggleSummaryBtn.addEventListener('click', () => {
  director.showSummaryOverlay = !director.showSummaryOverlay;
  syncSummaryButtonUI();
});

playPauseBtn.addEventListener('click', () => {
  if (!isPlaying && playheadFloat >= frames.length - 1) {
    playheadFloat = 0;
    timelineSlider.value = '0';
    director.showSummaryOverlay = false;
    syncSummaryButtonUI();
  } else if (!isPlaying) {
    director.showSummaryOverlay = false;
    syncSummaryButtonUI();
  }
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? '⏸ PAUSE' : '▶ PLAY';
});

restartBtn.addEventListener('click', () => {
  playheadFloat = 0;
  timelineSlider.value = '0';
  director.showSummaryOverlay = false;
  syncSummaryButtonUI();
  syncSliderValue();
  isPlaying = true;
  playPauseBtn.textContent = '⏸ PAUSE';
});

timelineSlider.addEventListener('input', () => {
  playheadFloat = Number(timelineSlider.value);
  if (playheadFloat < frames.length - 1 && director.showSummaryOverlay) {
    director.showSummaryOverlay = false;
    syncSummaryButtonUI();
  }
  director.setFrameData(getInterpolatedFrame(playheadFloat));
  syncSliderValue();
});

speedSelect.addEventListener('change', (e) => {
  playbackSpeed = Number(e.target.value) || 4;
});

document.querySelectorAll('.cam-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cam-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    director.cameraMode = btn.dataset.cam;
    director.userAzimuthOffset = 0;
    director.userElevationOffset = 0;
  });
});

generateMovieBtn.addEventListener('click', () => {
  if (exporter.isRecording) {
    exporter.stopRecording();
    return;
  }
  isGeneratingFullMovie = true;
  director.showSummaryOverlay = false;
  syncSummaryButtonUI();
  if (!isLiveMode) {
    playheadFloat = 0;
    timelineSlider.value = '0';
    syncSliderValue();
    isPlaying = true;
    playPauseBtn.textContent = '⏸ PAUSE';
  }
  exporter.startRecording('k6-cyber-fortress-full-movie');
});

recordClipBtn.addEventListener('click', () => {
  if (exporter.isRecording) {
    exporter.stopRecording();
  } else {
    isGeneratingFullMovie = false;
    exporter.startRecording('k6-cyber-fortress-clip');
  }
});

// Modal Dialog Light-Dismiss Fallback (following modern-web-guidance `light-dismiss-a-dialog`)
if (!('closedBy' in HTMLDialogElement.prototype)) {
  influxDialog.addEventListener('click', (event) => {
    if (event.target !== influxDialog) return;
    const rect = influxDialog.getBoundingClientRect();
    const isDialogContent = (
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width
    );
    if (isDialogContent) return;
    influxDialog.close();
  });
}

openInfluxBtn.addEventListener('click', () => {
  influxDialog.showModal();
});

closeInfluxBtn.addEventListener('click', () => {
  influxDialog.close();
});

influxTimeMode.addEventListener('change', () => {
  const mode = influxTimeMode.value;
  relativeWindowGroup.style.display = mode === 'relative' ? 'flex' : 'none';
  customTimeGroup.style.display = mode === 'custom' ? 'flex' : 'none';
});

function readSlaThresholdsFromForm() {
  const nominalMs = Math.max(10, Number(document.getElementById('sla-nominal').value) || 180);
  const criticalMs = Math.max(nominalMs + 50, Number(document.getElementById('sla-critical').value) || 1100);
  const warningMs = Math.round(nominalMs + (criticalMs - nominalMs) * 0.35);
  const sutNameVal = document.getElementById('sut-name-input')?.value?.trim();
  if (sutNameVal) director.sutName = sutNameVal.toUpperCase();
  director.setThresholds({ nominalMs, warningMs, criticalMs });
  syncSliderValue();
}

applySlaOnlyBtn.addEventListener('click', () => {
  readSlaThresholdsFromForm();
  influxStatusBanner.classList.remove('error');
  influxStatusBanner.textContent = `✅ Updated SUT ("${director.sutName}") & Thermal SLA Thresholds (Nominal <= ${director.thresholds.nominalMs}ms, Meltdown >= ${director.thresholds.criticalMs}ms).`;
});

function buildInfluxClientFromForm() {
  return new InfluxK6Client({
    url: document.getElementById('influx-url').value.trim(),
    database: document.getElementById('influx-db').value.trim(),
    username: document.getElementById('influx-user').value.trim(),
    password: document.getElementById('influx-pass').value.trim(),
    runnerTagKey: document.getElementById('influx-runner-tag')?.value || 'auto'
  });
}

testConnectionBtn.addEventListener('click', async () => {
  influxStatusBanner.classList.remove('error');
  influxStatusBanner.textContent = '⏳ Querying InfluxDB 1.8 metadata & detecting active Load Agent runners...';
  try {
    const client = buildInfluxClientFromForm();
    const [meta, detectedRunners] = await Promise.all([
      client.discoverMetadata(),
      client.detectLoadAgents()
    ]);
    const hasK6 = meta.measurements.includes('http_reqs') || meta.measurements.includes('http_req_duration');
    const latestStr = meta.latestTimeMs ? new Date(meta.latestTimeMs).toLocaleString() : 'N/A';
    influxStatusBanner.innerHTML = hasK6
      ? `✅ <strong>Connected to InfluxDB 1.8!</strong> Found ${meta.measurements.length} measurements.<br/>Latest k6 point: <code>${latestStr}</code> · Detected <strong>${detectedRunners.agents.length} Load Agent(s)</strong> via tag <code>${detectedRunners.tagKey}</code>`
      : `⚠️ Connected to database <code>${client.database}</code>, but standard k6 measurements (<code>http_reqs</code>) were not found.`;
  } catch (err) {
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ Connection error: ${err.message}`;
  }
});

startLiveInfluxBtn.addEventListener('click', async () => {
  readSlaThresholdsFromForm();
  influxDialog.close();
  await startLiveView(true);
});

loadInfluxRunBtn.addEventListener('click', async () => {
  stopLiveView(false);
  readSlaThresholdsFromForm();
  influxStatusBanner.classList.remove('error');
  influxStatusBanner.textContent = '⏳ Extracting k6 time-series & runner count from InfluxDB 1.8...';

  try {
    const client = buildInfluxClientFromForm();
    const result = await client.fetchTestExecution({
      timeFilterMode: influxTimeMode.value,
      relativeWindow: document.getElementById('influx-relative').value,
      startTimeISO: document.getElementById('influx-start-iso').value,
      endTimeISO: document.getElementById('influx-end-iso').value,
      bucketInterval: document.getElementById('influx-bucket').value,
      tagFilter: document.getElementById('influx-tag-filter').value
    });

    if (runnerCountSelect.value === 'auto' && result.detectedAgents?.length) {
      director.setLoadAgentCount(result.detectedAgents.length, result.detectedAgents);
    }

    applyExternalDataset(
      result.frames,
      `INFLUXDB // ${client.database.toUpperCase()}`,
      `${client.url} (${result.frames.length} pts · ${director.numLoadAgents} Load Agents)`,
      result.endpoints,
      result.detectedAgents
    );

    influxStatusBanner.textContent = `✅ Loaded ${result.frames.length} time buckets and ${director.numLoadAgents} Load Agents from InfluxDB 1.8!`;
    setTimeout(() => influxDialog.close(), 500);
  } catch (err) {
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ Failed to load k6 series: ${err.message}`;
  }
});

jsonFileImport.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    stopLiveView(false);
    const text = await file.text();
    const json = JSON.parse(text);
    let loadedFrames = [];
    let endpoints = [];

    if (Array.isArray(json)) {
      loadedFrames = json;
    } else if (json.results) {
      const norm = normalizeInfluxResponse(json, 1);
      loadedFrames = norm.frames;
      endpoints = norm.endpoints;
    } else if (Array.isArray(json.frames)) {
      loadedFrames = json.frames;
      endpoints = json.endpoints || [];
    } else {
      throw new Error('Unrecognized JSON structure. Expected InfluxDB 1.8 {"results": [...]} or frame array.');
    }

    readSlaThresholdsFromForm();
    applyExternalDataset(
      loadedFrames,
      `IMPORTED // ${file.name.replace(/\.json$/i, '')}`,
      `FILE IMPORT · ${loadedFrames.length} FRAMES`,
      endpoints
    );
    influxStatusBanner.classList.remove('error');
    influxStatusBanner.textContent = `✅ Imported ${loadedFrames.length} frames from ${file.name}!`;
    setTimeout(() => influxDialog.close(), 450);
  } catch (err) {
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ JSON Import Error: ${err.message}`;
  }
});

function applyExternalDataset(newFrames, title, sourceLabel, endpoints, detectedAgents = []) {
  frames = newFrames;
  playheadFloat = 0;
  timelineSlider.min = '0';
  timelineSlider.max = String(Math.max(1, frames.length - 1));
  timelineSlider.value = '0';

  let customOpt = scenarioSelect.querySelector('option[value="custom_influx"]');
  if (!customOpt) {
    customOpt = document.createElement('option');
    customOpt.value = 'custom_influx';
    scenarioSelect.prepend(customOpt);
  }
  customOpt.textContent = `${title} (${frames.length} pts)`;
  scenarioSelect.value = 'custom_influx';

  const numLoadAgents = resolveRunnerCount(detectedAgents.length ? detectedAgents : endpoints);
  connectionStatusText.textContent = `SOURCE: ${title} · ${sourceLabel}`;
  director.setDataset(frames, {
    title,
    sourceLabel,
    endpoints,
    numLoadAgents,
    loadAgentNames: detectedAgents
  });
  syncSummaryButtonUI();
  syncSliderValue();
  isPlaying = true;
  playPauseBtn.textContent = '⏸ PAUSE';
}

// Main 60fps Animation Loop
let lastRafTime = performance.now();

function animate(now) {
  const dt = Math.min(0.1, (now - lastRafTime) / 1000);
  lastRafTime = now;

  if (!isLiveMode && isPlaying && frames.length > 1) {
    playheadFloat += dt * playbackSpeed;

    if (playheadFloat >= frames.length - 1) {
      playheadFloat = frames.length - 1;
      isPlaying = false;
      playPauseBtn.textContent = '▶ REPLAY';
      director.showSummaryOverlay = true;
      syncSummaryButtonUI();

      if (isGeneratingFullMovie && exporter.isRecording && !movieEndHoldTimer) {
        movieEndHoldTimer = setTimeout(() => {
          movieEndHoldTimer = null;
          if (exporter.isRecording) {
            exporter.stopRecording();
          }
        }, 3500);
      }
    }

    timelineSlider.value = String(Math.round(playheadFloat));
    syncSliderValue();
  }

  const interpolated = getInterpolatedFrame(playheadFloat);
  director.setFrameData(interpolated);
  director.updateAndRender(dt);

  requestAnimationFrame(animate);
}

// Boot with default Citadel Siege scenario
loadScenarioPreset('citadel_siege');
requestAnimationFrame(animate);
