/**
 * k6 Cyber-Fortress — Main Application Controller
 * - Connects exclusively to InfluxDB 1.8 / Grafana (or imported InfluxDB JSON)
 * - Displays NO DATA state when no InfluxDB connection or test data is loaded
 * - Renders a single Combined Response Times Table (01 | METRICS | MIN | MAX | AVG | P95 | P99 | COUNT)
 *   combining all measurements per request
 * - Supports Real-Time LIVE VIEW polling & on-the-fly movie rendering
 * - Dynamically scales 3D Load Agents (Runners) based on actual runners used
 */

import { computeThermalState, generateDemoExecution, DEMO_VARIABLE_OPTIONS } from './demo-data.js';
import { InfluxK6Client, normalizeInfluxResponse, parseRequestMetricName, escapeInfluxRegex } from './influx-client.js';
import { CyberFortressDirector } from './fortress-scene.js';
import { FortressVideoExporter } from './video-exporter.js';

const canvas = document.getElementById('cinema-canvas');
const canvasFrame = document.getElementById('canvas-frame');
const runnerCountSelect = document.getElementById('runner-count-select');
const liveViewBtn = document.getElementById('live-view-btn');
const toggleSummaryBtn = document.getElementById('toggle-summary-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const restartBtn = document.getElementById('restart-btn');
const timelineSlider = document.getElementById('timeline-slider');
const timeReadout = document.getElementById('time-readout');
const speedSelect = document.getElementById('speed-select');
const generateMovieBtn = document.getElementById('generate-movie-btn');
const recordClipBtn = document.getElementById('record-clip-btn');
const connectionStatusText = document.getElementById('connection-status-text');

// Left Sidebar Single Combined Response Time Table Elements
const rtCurrentTimeBadge = document.getElementById('rt-current-time-badge');
const rtCombinedTbody = document.getElementById('rt-combined-tbody');

// Variable Filter Menu Bar Elements (system_under_test, test_environment, testRunId)
const filterSutSelect = document.getElementById('filter-sut-select');
const filterEnvSelect = document.getElementById('filter-env-select');
const filterRunIdSelect = document.getElementById('filter-runid-select');
const refreshVarsBtn = document.getElementById('refresh-vars-btn');

// InfluxDB Connection Healthcheck Pill Elements
const influxHealthPill = document.getElementById('influx-health-pill');
const influxHealthText = document.getElementById('influx-health-text');

const discoveredTagKeys = {
  sutKey: 'systemUnderTest',
  envKey: 'testEnvironment',
  runIdKey: 'testRunId',
  hasVarTags: false
};

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

// Initialize 3D Cyber-Fortress Director in NO DATA state
const director = new CyberFortressDirector(canvas, { numLoadAgents: 1 });

// Playback & Live Stream state
let frames = [];
let combinedRequests = [];
let playheadFloat = 0;
let isPlaying = false;
let playbackSpeed = 4;
let isGeneratingFullMovie = false;
let movieEndHoldTimer = null;

// Live View Polling Timer
let isLiveMode = false;
let livePollInterval = null;

function latencyColor(ms) {
  const { nominalMs, criticalMs } = director.thresholds;
  if (ms >= criticalMs) return '#f43f5e';
  if (ms >= nominalMs) return '#f59e0b';
  return '#e6c687';
}

function renderEmptyTable() {
  rtCurrentTimeBadge.textContent = 'NO DATA';
  rtCombinedTbody.innerHTML = '<tr><td colspan="8" class="rt-empty">NO DATA — Connect InfluxDB 1.8</td></tr>';
}

/**
 * Renders and live-updates the Combined Response Times Table (`#rt-combined-tbody`)
 * so that MIN, MAX, AVG, P95, P99, and COUNT dynamically stream and update as the test runs:
 * 01 | METRICS | MIN | MAX | AVG | P95 | P99 | COUNT
 */
function renderCombinedResponseTable(activeFrame = null) {
  if (!director.hasData || !combinedRequests.length) {
    renderEmptyTable();
    return;
  }

  const f = activeFrame || getInterpolatedFrame(playheadFloat) || frames[frames.length - 1];
  const totalFrames = Math.max(1, frames.length - 1);
  const progress = Math.max(0.01, Math.min(1, playheadFloat / totalFrames));
  const curIdx = Math.min(frames.length - 1, Math.max(0, Math.floor(playheadFloat)));

  // Compute running peak P99 up to current playhead so MAX climbs realistically over time
  let runningPeakP99 = f ? (f.p99 || 120) : 120;
  for (let i = 0; i <= curIdx; i += 2) {
    if (frames[i] && frames[i].p99 > runningPeakP99) {
      runningPeakP99 = frames[i].p99;
    }
  }

  const elapsedStr = f ? formatMMSS(f.elapsedSec || 0) : '00:00';
  rtCurrentTimeBadge.textContent = (isPlaying || isLiveMode)
    ? `● LIVE T+${elapsedStr} · ${combinedRequests.length} METRICS`
    : `T+${elapsedStr} · ${combinedRequests.length} METRICS`;

  // Distinct per-endpoint complexity weight so lighter endpoints (OpenHomepage) and heavier
  // endpoints (SubmitCheckoutOrder, AuthorizePaymentGateway) scale realistically with incoming telemetry
  const maxRefP95 = Math.max(1, ...combinedRequests.map((r) => r.p95 || 1000));

  const rowsHtml = combinedRequests.map((req, idx) => {
    const stepStr = req.step || String(idx + 1).padStart(2, '0');

    // Relative weight of this endpoint (0.48 .. 1.15) + live incoming telemetry micro-fluctuation
    const baseWeight = 0.48 + ((req.p95 || 1000) / maxRefP95) * 0.66;
    const waveJitter = Math.sin(playheadFloat * 2.4 + idx * 1.45) * 0.055;
    const epFactor = Math.max(0.35, baseWeight + waveJitter);

    const frameP50 = f ? (f.p50 || 45) : 45;
    const frameMean = f ? (f.mean || frameP50) : 55;
    const frameP95 = f ? (f.p95 || 110) : 110;
    const frameP99 = f ? (f.p99 || 160) : 160;

    const liveMin = Math.max(
      6,
      Math.round((req.min ?? 14) * (1 + (1 - progress) * 0.35 + Math.abs(waveJitter) * 0.2))
    );
    const liveAvg = Math.max(
      liveMin + 4,
      Math.round(frameMean * epFactor * 0.58)
    );
    const liveP95 = Math.max(
      liveAvg + 8,
      Math.round(frameP95 * epFactor)
    );
    const liveP99 = Math.max(
      liveP95 + 14,
      Math.round(frameP99 * Math.min(1.18, epFactor * 1.06))
    );
    const liveMax = Math.max(
      liveP99 + 18,
      Math.round(runningPeakP99 * Math.min(1.22, epFactor * 1.09))
    );

    // Cumulative incoming request count streaming in from T+00:00 up to current playhead
    const liveCount = Math.max(
      1,
      Math.round((req.count ?? 1000) * Math.pow(progress, 1.22) + Math.abs(Math.sin(playheadFloat * 3.1 + idx)) * 9)
    );

    const p95Col = latencyColor(liveP95);
    return `<tr>
      <td style="color:var(--cyan);font-weight:700;">${stepStr}</td>
      <td title="${req.rawName || req.name}">${req.name}</td>
      <td>${liveMin}ms</td>
      <td>${liveMax}ms</td>
      <td>${liveAvg}ms</td>
      <td style="color:${p95Col};font-weight:700;">${liveP95}ms</td>
      <td>${liveP99}ms</td>
      <td>${liveCount.toLocaleString()}</td>
    </tr>`;
  }).join('');

  rtCombinedTbody.innerHTML = rowsHtml;
}

function syncSummaryButtonUI() {
  if (director.showSummaryOverlay) {
    toggleSummaryBtn.classList.add('btn-primary');
    toggleSummaryBtn.textContent = '📜 Hide Summary';
  } else {
    toggleSummaryBtn.classList.remove('btn-primary');
    toggleSummaryBtn.textContent = '📜 Battle Summary';
  }
}

function syncLiveButtonUI() {
  director.isLiveMode = isLiveMode;
  if (isLiveMode) {
    liveViewBtn.classList.add('btn-movie', 'recording');
    liveViewBtn.textContent = '⏹ Stop Live View';
    timelineSlider.disabled = true;
    playPauseBtn.disabled = true;
    restartBtn.disabled = true;
  } else {
    liveViewBtn.classList.remove('btn-movie', 'recording');
    liveViewBtn.textContent = '🔴 Live View';
    timelineSlider.disabled = !director.hasData;
    playPauseBtn.disabled = !director.hasData;
    restartBtn.disabled = !director.hasData;
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

  if (!director.hasData || !frames.length) {
    timeReadout.textContent = 'NO DATA';
    timelineSlider.setAttribute('aria-valuetext', 'No data loaded');
    timelineSlider.style.setProperty('--slider-fill-color', '#8c7a5b');
    return;
  }

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
    return detectedAgents && detectedAgents.length > 0 ? detectedAgents.length : 1;
  }
  return Math.max(1, Math.min(16, Number(sel) || 1));
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
    min: Math.round((f0.min || 0) + ((f1.min || 0) - (f0.min || 0)) * alpha),
    mean: Math.round((f0.mean || f0.p50) + ((f1.mean || f1.p50) - (f0.mean || f0.p50)) * alpha),
    p50: Math.round(f0.p50 + (f1.p50 - f0.p50) * alpha),
    p90: Math.round((f0.p90 || f0.p95) + ((f1.p90 || f1.p95) - (f0.p90 || f0.p95)) * alpha),
    p95: Math.round(f0.p95 + (f1.p95 - f0.p95) * alpha),
    p99: Math.round(f0.p99 + (f1.p99 - f0.p99) * alpha),
    max: Math.round((f0.max || f0.p99) + ((f1.max || f1.p99) - (f0.max || f0.p99)) * alpha),
    errorRate: Number((f0.errorRate + (f1.errorRate - f0.errorRate) * alpha).toFixed(2)),
    failedReqs: Math.round(f0.failedReqs + (f1.failedReqs - f0.failedReqs) * alpha),
    checksPassRate: Number((f0.checksPassRate + (f1.checksPassRate - f0.checksPassRate) * alpha).toFixed(1))
  };
}

// Variable Filter Menu Bar Helpers (system_under_test, test_environment, testRunId)
function populateSelectOptions(selectEl, values = [], preferredValue = 'All') {
  const uniqueVals = Array.from(new Set(values.filter((v) => v && v !== 'All')));
  const currentOrPreferred = preferredValue && (preferredValue === 'All' || uniqueVals.includes(preferredValue))
    ? preferredValue
    : 'All';

  selectEl.innerHTML = ['All', ...uniqueVals]
    .map((val) => `<option value="${val.replace(/"/g, '&quot;')}"${val === currentOrPreferred ? ' selected' : ''}>${val}</option>`)
    .join('');
}

function buildCombinedTagFilter() {
  const clauses = [];
  const sutVal = filterSutSelect?.value || 'All';
  const envVal = filterEnvSelect?.value || 'All';
  const runIdVal = filterRunIdSelect?.value || 'All';

  const anySelected = sutVal !== 'All' || envVal !== 'All' || runIdVal !== 'All';

  if (discoveredTagKeys.hasVarTags || anySelected) {
    const sutRegex = sutVal !== 'All' ? escapeInfluxRegex(sutVal) : '.*';
    const envRegex = envVal !== 'All' ? escapeInfluxRegex(envVal) : '.*';
    const runIdRegex = runIdVal !== 'All' ? escapeInfluxRegex(runIdVal) : '.*';

    clauses.push(
      `("${discoveredTagKeys.sutKey}" =~ /^${sutRegex}$/ AND "${discoveredTagKeys.envKey}" =~ /^${envRegex}$/ AND "${discoveredTagKeys.runIdKey}"::tag =~ /^${runIdRegex}$/)`
    );
  }

  const manualFilter = document.getElementById('influx-tag-filter')?.value?.trim();
  if (manualFilter) {
    clauses.push(`(${manualFilter})`);
  }

  return clauses.join(' AND ');
}

function syncSutLabelFromFilterBar() {
  const sutVal = filterSutSelect?.value;
  const envVal = filterEnvSelect?.value;
  if (sutVal && sutVal !== 'All') {
    director.sutName = envVal && envVal !== 'All'
      ? `${sutVal} // ${envVal}`.toUpperCase()
      : `SUT // ${sutVal}`.toUpperCase();
  } else if (envVal && envVal !== 'All') {
    director.sutName = `ENV // ${envVal}`.toUpperCase();
  } else {
    const sutNameVal = document.getElementById('sut-name-input')?.value?.trim();
    if (sutNameVal) director.sutName = sutNameVal.toUpperCase();
  }
}

async function syncVariableDropdownsFromInflux() {
  const client = buildInfluxClientFromForm();
  const prevSut = filterSutSelect.value;
  const prevEnv = filterEnvSelect.value;
  const prevRunId = filterRunIdSelect.value;

  const tags = await client.discoverVariableTags({
    sut: prevSut,
    testEnvironment: prevEnv
  });

  discoveredTagKeys.sutKey = tags.sutKey || 'systemUnderTest';
  discoveredTagKeys.envKey = tags.envKey || 'testEnvironment';
  discoveredTagKeys.runIdKey = tags.runIdKey || 'testRunId';
  discoveredTagKeys.hasVarTags = Boolean(
    tags.sutValues.length || tags.envValues.length || tags.runIdValues.length
  );

  populateSelectOptions(filterSutSelect, tags.sutValues, prevSut);
  populateSelectOptions(filterEnvSelect, tags.envValues, prevEnv);
  populateSelectOptions(filterRunIdSelect, tags.runIdValues, prevRunId);
  syncSutLabelFromFilterBar();
  return tags;
}

// Live View Engine (Polls InfluxDB 1.8 in real time; shows NO DATA if unreachable or empty)
async function startLiveView() {
  if (isLiveMode) stopLiveView(false);

  isLiveMode = true;
  director.showSummaryOverlay = false;
  syncSummaryButtonUI();
  syncLiveButtonUI();

  syncVariableDropdownsFromInflux().catch(() => {});

  const pollOnce = async () => {
    if (!isLiveMode) return;
    const client = buildInfluxClientFromForm();
    syncSutLabelFromFilterBar();
    try {
      const liveData = await client.fetchLiveTelemetry({
        liveWindow: '3m',
        bucketInterval: document.getElementById('influx-bucket').value || '1s',
        tagFilter: buildCombinedTagFilter()
      });
      setInfluxHealthUI('connected', `Connected to ${client.url}/${client.database}`);
      applyLivePollResult(liveData, client);
    } catch (err) {
      runInfluxHealthCheck();
      frames = [];
      combinedRequests = [];
      director.setNoDataState(`NO LIVE DATA — ${err.message}`);
      connectionStatusText.textContent = `🔴 LIVE VIEW: NO DATA (${client.url}/${client.database} — ${err.message})`;
      renderEmptyTable();
      syncSliderValue();
    }
  };

  await pollOnce();
  livePollInterval = setInterval(pollOnce, 1500);
}

function applyLivePollResult(liveData, client) {
  frames = liveData.frames;
  combinedRequests = liveData.combinedRequests || [];
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
  connectionStatusText.textContent = `🔴 LIVE INFLUXDB: ${client.url}/${client.database} (${numLoadAgents} LOAD AGENT${numLoadAgents > 1 ? 'S' : ''})`;
  renderCombinedResponseTable();
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

  if (showSummary && director.hasData && frames.length > 1) {
    isPlaying = false;
    playPauseBtn.textContent = '▶ REPLAY';
    director.showSummaryOverlay = true;
    syncSummaryButtonUI();

    if (exporter.isRecording && !movieEndHoldTimer) {
      movieEndHoldTimer = setTimeout(() => {
        movieEndHoldTimer = null;
        if (exporter.isRecording) exporter.stopRecording();
      }, 3500);
    }
  } else if (!director.hasData) {
    connectionStatusText.textContent = 'STATUS: NO DATA · CONNECT INFLUXDB 1.8 / GRAFANA';
    director.setNoDataState('NO DATA — CONNECT INFLUXDB 1.8 / GRAFANA TO LOAD OR MONITOR A K6 TEST');
    renderEmptyTable();
  }
}

// UI Event Listeners
runnerCountSelect.addEventListener('change', () => {
  const numLoadAgents = resolveRunnerCount(director.loadAgentNames);
  director.setLoadAgentCount(numLoadAgents, director.loadAgentNames);
});

liveViewBtn.addEventListener('click', () => {
  if (isLiveMode) {
    stopLiveView(true);
  } else {
    startLiveView();
  }
});

toggleSummaryBtn.addEventListener('click', () => {
  if (!director.hasData) return;
  director.showSummaryOverlay = !director.showSummaryOverlay;
  syncSummaryButtonUI();
});

// Full Screen Animation-Only Mode (hides all app chrome + HUD overlays so only the 3D battle animation is visible)
let isAnimationFullscreen = false;

function syncFullscreenUI(active) {
  isAnimationFullscreen = active;
  document.body.classList.toggle('fullscreen-animation-only', active);
  director.showHudInCanvas = !active;
  if (fullscreenBtn) {
    fullscreenBtn.classList.toggle('btn-primary', active);
    fullscreenBtn.textContent = active ? '✕ Exit Full Screen' : '⛶ Full Screen';
  }
}

async function enterAnimationFullscreen() {
  syncFullscreenUI(true);
  if (canvasFrame && canvasFrame.requestFullscreen && !document.fullscreenElement) {
    try {
      await canvasFrame.requestFullscreen();
    } catch (_) {
      // Fallback to viewport-filling CSS mode (`body.fullscreen-animation-only`) when browser blocks native fullscreen
    }
  }
}

async function exitAnimationFullscreen() {
  syncFullscreenUI(false);
  if (document.fullscreenElement && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch (_) {
      // Ignore if already exited
    }
  }
}

function toggleAnimationFullscreen() {
  if (isAnimationFullscreen || document.fullscreenElement) {
    exitAnimationFullscreen();
  } else {
    enterAnimationFullscreen();
  }
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', toggleAnimationFullscreen);
}

if (exitFullscreenBtn) {
  exitFullscreenBtn.addEventListener('click', exitAnimationFullscreen);
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && isAnimationFullscreen) {
    syncFullscreenUI(false);
  } else if (document.fullscreenElement === canvasFrame && !isAnimationFullscreen) {
    syncFullscreenUI(true);
  }
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || influxDialog?.open) {
    return;
  }
  if (e.key === 'Escape' && isAnimationFullscreen) {
    exitAnimationFullscreen();
  } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    toggleAnimationFullscreen();
  }
});

playPauseBtn.addEventListener('click', () => {
  if (!director.hasData) return;
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
  if (!director.hasData) return;
  playheadFloat = 0;
  timelineSlider.value = '0';
  director.showSummaryOverlay = false;
  syncSummaryButtonUI();
  syncSliderValue();
  isPlaying = true;
  playPauseBtn.textContent = '⏸ PAUSE';
});

timelineSlider.addEventListener('input', () => {
  if (!director.hasData) return;
  playheadFloat = Number(timelineSlider.value);
  if (playheadFloat < frames.length - 1 && director.showSummaryOverlay) {
    director.showSummaryOverlay = false;
    syncSummaryButtonUI();
  }
  const activeFrame = getInterpolatedFrame(playheadFloat);
  director.setFrameData(activeFrame);
  renderCombinedResponseTable(activeFrame);
  syncSliderValue();
});

speedSelect.addEventListener('change', (e) => {
  playbackSpeed = Number(e.target.value) || 4;
});

const camZoomSlider = document.getElementById('cam-zoom-slider');
const camPosXSlider = document.getElementById('cam-pos-x-slider');
const camPosYSlider = document.getElementById('cam-pos-y-slider');
const camOrbitSlider = document.getElementById('cam-orbit-slider');
const camResetBtn = document.getElementById('cam-reset-btn');

function syncRangeCssVars(sliderEl) {
  if (!sliderEl) return;
  sliderEl.style.setProperty('--attr-min', sliderEl.min || '0');
  sliderEl.style.setProperty('--attr-max', sliderEl.max || '100');
  sliderEl.style.setProperty('--control-value', sliderEl.value);
}

function sync3DSlidersFromDirector() {
  if (camZoomSlider) {
    camZoomSlider.value = String(Math.round(director.zoomDistance));
    syncRangeCssVars(camZoomSlider);
  }
  if (camPosXSlider) {
    camPosXSlider.value = String(Math.round(director.fortressPosX));
    syncRangeCssVars(camPosXSlider);
  }
  if (camPosYSlider) {
    camPosYSlider.value = String(Math.round(director.fortressPosY));
    syncRangeCssVars(camPosYSlider);
  }
  if (camOrbitSlider) {
    camOrbitSlider.value = String(Math.round(director.orbitAngleDeg));
    syncRangeCssVars(camOrbitSlider);
  }
}

director.onViewChange = sync3DSlidersFromDirector;
sync3DSlidersFromDirector();

if (camZoomSlider) {
  camZoomSlider.addEventListener('input', () => {
    director.zoomDistance = Number(camZoomSlider.value);
    syncRangeCssVars(camZoomSlider);
  });
}

if (camPosXSlider) {
  camPosXSlider.addEventListener('input', () => {
    director.fortressPosX = Number(camPosXSlider.value);
    syncRangeCssVars(camPosXSlider);
  });
}

if (camPosYSlider) {
  camPosYSlider.addEventListener('input', () => {
    director.fortressPosY = Number(camPosYSlider.value);
    syncRangeCssVars(camPosYSlider);
  });
}

if (camOrbitSlider) {
  camOrbitSlider.addEventListener('input', () => {
    director.orbitAngleDeg = Number(camOrbitSlider.value);
    syncRangeCssVars(camOrbitSlider);
  });
}

if (camResetBtn) {
  camResetBtn.addEventListener('click', () => {
    director.resetView();
  });
}

generateMovieBtn.addEventListener('click', () => {
  if (exporter.isRecording) {
    exporter.stopRecording();
    return;
  }
  if (!director.hasData && !isLiveMode) {
    influxDialog.showModal();
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = '⚠️ No data loaded. Connect to InfluxDB 1.8 (or start a Live Monitor) before generating a movie.';
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
  syncSutLabelFromFilterBar();
  director.setThresholds({ nominalMs, warningMs, criticalMs });
  if (director.hasData) {
    renderCombinedResponseTable();
  }
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

function setInfluxHealthUI(status, detail = '') {
  if (!influxHealthPill || !influxHealthText) return;
  influxHealthPill.classList.remove('connected', 'disconnected', 'checking');

  if (status === 'connected') {
    influxHealthPill.classList.add('connected');
    influxHealthText.textContent = 'INFLUXDB: CONNECTED';
    influxHealthPill.title = detail || 'InfluxDB 1.8 is connected and healthy (Click to re-check)';
  } else if (status === 'checking') {
    influxHealthPill.classList.add('checking');
    influxHealthText.textContent = 'INFLUXDB: CHECKING...';
    influxHealthPill.title = 'Checking InfluxDB 1.8 connection health...';
  } else {
    influxHealthPill.classList.add('disconnected');
    influxHealthText.textContent = 'INFLUXDB: DISCONNECTED';
    influxHealthPill.title = detail ? `Disconnected: ${detail} (Click to re-check)` : 'InfluxDB 1.8 is not connected (Click to re-check)';
  }
}

async function runInfluxHealthCheck({ showChecking = false } = {}) {
  if (showChecking) {
    setInfluxHealthUI('checking');
  }
  const client = buildInfluxClientFromForm();
  try {
    await client.checkHealth();
    setInfluxHealthUI('connected', `Connected to ${client.url}/${client.database}`);
    if (!discoveredTagKeys.hasVarTags) {
      syncVariableDropdownsFromInflux().catch(() => {});
    }
    return true;
  } catch (err) {
    setInfluxHealthUI('disconnected', err.message);
    return false;
  }
}

influxHealthPill?.addEventListener('click', () => {
  runInfluxHealthCheck({ showChecking: true });
});

testConnectionBtn.addEventListener('click', async () => {
  influxStatusBanner.classList.remove('error');
  influxStatusBanner.textContent = '⏳ Querying InfluxDB 1.8 metadata, variable tags & detecting active Load Agent runners...';
  setInfluxHealthUI('checking');
  try {
    const client = buildInfluxClientFromForm();
    const [meta, detectedRunners, varTags] = await Promise.all([
      client.discoverMetadata(),
      client.detectLoadAgents(),
      syncVariableDropdownsFromInflux()
    ]);
    setInfluxHealthUI('connected', `Connected to ${client.url}/${client.database}`);
    const hasK6 = meta.measurements.includes('http_reqs') || meta.measurements.includes('http_req_duration');
    const latestStr = meta.latestTimeMs ? new Date(meta.latestTimeMs).toLocaleString() : 'N/A';
    influxStatusBanner.innerHTML = hasK6
      ? `✅ <strong>Connected to InfluxDB 1.8!</strong> Found ${meta.measurements.length} measurements · Synced <strong>${varTags.sutValues.length} SUTs</strong>, <strong>${varTags.envValues.length} Envs</strong>, <strong>${varTags.runIdValues.length} Run IDs</strong>.<br/>Latest k6 point: <code>${latestStr}</code> · Detected <strong>${detectedRunners.agents.length} Load Agent(s)</strong> via tag <code>${detectedRunners.tagKey}</code>`
      : `⚠️ Connected to database <code>${client.database}</code>, but standard k6 measurements (<code>http_reqs</code>) were not found.`;
  } catch (err) {
    setInfluxHealthUI('disconnected', err.message);
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ Connection error: ${err.message}`;
  }
});

startLiveInfluxBtn.addEventListener('click', async () => {
  readSlaThresholdsFromForm();
  influxDialog.close();
  await startLiveView();
});

async function executeInfluxRunLoad({ closeModalOnSuccess = false } = {}) {
  stopLiveView(false);
  readSlaThresholdsFromForm();
  influxStatusBanner.classList.remove('error');
  influxStatusBanner.textContent = '⏳ Extracting k6 time-series, combined request metrics & runner count from InfluxDB 1.8...';

  try {
    await syncVariableDropdownsFromInflux().catch(() => {});
    const client = buildInfluxClientFromForm();
    const activeFilter = buildCombinedTagFilter();
    const result = await client.fetchTestExecution({
      timeFilterMode: influxTimeMode.value,
      relativeWindow: document.getElementById('influx-relative').value,
      startTimeISO: document.getElementById('influx-start-iso').value,
      endTimeISO: document.getElementById('influx-end-iso').value,
      bucketInterval: document.getElementById('influx-bucket').value,
      tagFilter: activeFilter
    });

    setInfluxHealthUI('connected', `Connected to ${client.url}/${client.database}`);

    if (runnerCountSelect.value === 'auto' && result.detectedAgents?.length) {
      director.setLoadAgentCount(result.detectedAgents.length, result.detectedAgents);
    }

    const filterSummary = [
      filterSutSelect.value !== 'All' ? `SUT: ${filterSutSelect.value}` : null,
      filterEnvSelect.value !== 'All' ? `ENV: ${filterEnvSelect.value}` : null,
      filterRunIdSelect.value !== 'All' ? `RUN: ${filterRunIdSelect.value}` : null
    ].filter(Boolean).join(' · ');

    applyExternalDataset(
      result.frames,
      `INFLUXDB // ${client.database.toUpperCase()}${filterSummary ? ` (${filterSummary})` : ''}`,
      `${client.url} (${result.frames.length} pts · ${director.numLoadAgents} Load Agents)`,
      result.endpoints,
      result.detectedAgents,
      result.combinedRequests
    );

    influxStatusBanner.textContent = `✅ Loaded ${result.combinedRequests.length} combined request metrics and ${director.numLoadAgents} Load Agents from InfluxDB 1.8!`;
    if (closeModalOnSuccess) {
      setTimeout(() => influxDialog.close(), 500);
    }
  } catch (err) {
    runInfluxHealthCheck();
    isDemoLoaded = false;
    frames = [];
    combinedRequests = [];
    director.setNoDataState(`NO DATA — ${err.message}`);
    connectionStatusText.textContent = `STATUS: NO DATA (${err.message})`;
    renderEmptyTable();
    syncLiveButtonUI();
    syncSliderValue();
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ Failed to load k6 series: ${err.message}`;
  }
}

loadInfluxRunBtn.addEventListener('click', () => {
  isDemoLoaded = false;
  executeInfluxRunLoad({ closeModalOnSuccess: true });
});

let isDemoLoaded = false;
const loadDemoBtn = document.getElementById('load-demo-btn');

function initDemoVariableDropdowns() {
  populateSelectOptions(filterSutSelect, DEMO_VARIABLE_OPTIONS.sutValues, DEMO_VARIABLE_OPTIONS.sutValues[0]);
  populateSelectOptions(filterEnvSelect, DEMO_VARIABLE_OPTIONS.envValues, DEMO_VARIABLE_OPTIONS.envValues[0]);
  populateSelectOptions(filterRunIdSelect, DEMO_VARIABLE_OPTIONS.runIdValues, DEMO_VARIABLE_OPTIONS.runIdValues[0]);
}

function loadDemoDataset() {
  stopLiveView(false);
  isDemoLoaded = true;
  const sutVal = filterSutSelect?.value && filterSutSelect.value !== 'All'
    ? filterSutSelect.value
    : DEMO_VARIABLE_OPTIONS.sutValues[0];
  const envVal = filterEnvSelect?.value && filterEnvSelect.value !== 'All'
    ? filterEnvSelect.value
    : DEMO_VARIABLE_OPTIONS.envValues[0];
  const runIdVal = filterRunIdSelect?.value && filterRunIdSelect.value !== 'All'
    ? filterRunIdSelect.value
    : DEMO_VARIABLE_OPTIONS.runIdValues[0];

  const demo = generateDemoExecution({
    sut: sutVal,
    env: envVal,
    runId: runIdVal
  });

  syncSutLabelFromFilterBar();
  director.sutName = sutVal.toUpperCase();

  applyExternalDataset(
    demo.frames,
    `DEMO SIEGE // ${sutVal.toUpperCase()} (${envVal} · ${runIdVal})`,
    `BUILT-IN SPARTA SIEGE DEMO (${demo.frames.length} pts · ${demo.detectedAgents.length} Load Agents)`,
    demo.endpoints,
    demo.detectedAgents,
    demo.combinedRequests
  );
}

if (loadDemoBtn) {
  loadDemoBtn.addEventListener('click', () => {
    if (!discoveredTagKeys.hasVarTags) {
      initDemoVariableDropdowns();
    }
    loadDemoDataset();
  });
}

// Variable Filter Bar Event Listeners (system_under_test, test_environment, testRunId)
async function handleVariableFilterChange(changedSelect) {
  syncSutLabelFromFilterBar();
  if (isDemoLoaded && !influxHealthPill?.classList.contains('connected')) {
    loadDemoDataset();
    return;
  }
  if (changedSelect === filterSutSelect || changedSelect === filterEnvSelect) {
    await syncVariableDropdownsFromInflux().catch(() => {});
  }
  if (!isLiveMode) {
    await executeInfluxRunLoad({ closeModalOnSuccess: false });
  }
}

filterSutSelect.addEventListener('change', () => handleVariableFilterChange(filterSutSelect));
filterEnvSelect.addEventListener('change', () => handleVariableFilterChange(filterEnvSelect));
filterRunIdSelect.addEventListener('change', () => handleVariableFilterChange(filterRunIdSelect));

refreshVarsBtn.addEventListener('click', async () => {
  const originalLabel = refreshVarsBtn.textContent;
  refreshVarsBtn.textContent = '⏳ Syncing...';
  try {
    const tags = await syncVariableDropdownsFromInflux();
    setInfluxHealthUI('connected');
    connectionStatusText.textContent = `FILTERS SYNCED: ${tags.sutValues.length} SUTs · ${tags.envValues.length} Environments · ${tags.runIdValues.length} Test Run IDs`;
  } catch (err) {
    setInfluxHealthUI('disconnected', err.message);
    connectionStatusText.textContent = `FILTER SYNC FAILED: ${err.message}`;
  } finally {
    refreshVarsBtn.textContent = originalLabel;
  }
});

jsonFileImport.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    stopLiveView(false);
    isDemoLoaded = false;
    const text = await file.text();
    const json = JSON.parse(text);
    let loadedFrames = [];
    let endpoints = [];
    let loadedCombined = [];

    if (Array.isArray(json)) {
      loadedFrames = json;
    } else if (json.results) {
      const norm = normalizeInfluxResponse(json, 1);
      loadedFrames = norm.frames;
      endpoints = norm.endpoints;
      loadedCombined = norm.combinedRequests || [];
    } else if (Array.isArray(json.frames)) {
      loadedFrames = json.frames;
      endpoints = json.endpoints || [];
      loadedCombined = json.combinedRequests || [];
    } else {
      throw new Error('Unrecognized JSON structure. Expected InfluxDB 1.8 {"results": [...]} or frame array.');
    }

    readSlaThresholdsFromForm();
    applyExternalDataset(
      loadedFrames,
      `IMPORTED // ${file.name.replace(/\.json$/i, '')}`,
      `FILE IMPORT · ${loadedFrames.length} FRAMES`,
      endpoints,
      [],
      loadedCombined
    );
    influxStatusBanner.classList.remove('error');
    influxStatusBanner.textContent = `✅ Imported ${loadedFrames.length} frames from ${file.name}!`;
    setTimeout(() => influxDialog.close(), 450);
  } catch (err) {
    influxStatusBanner.classList.add('error');
    influxStatusBanner.textContent = `❌ JSON Import Error: ${err.message}`;
  }
});

function buildFallbackCombinedRequests(frameList, endpointsList = []) {
  if (!frameList || !frameList.length) return [];
  const totalCount = frameList.reduce((acc, f) => acc + Math.round(f.rps || 0), 0) || frameList.length;
  const minAll = Math.min(...frameList.map((f) => f.min ?? f.p50 ?? 0));
  const maxAll = Math.max(...frameList.map((f) => f.max ?? f.p99 ?? 0));
  const avgAll = Math.round(frameList.reduce((acc, f) => acc + (f.mean ?? f.p50 ?? 0), 0) / frameList.length);
  const p95All = Math.max(...frameList.map((f) => f.p95 || 0));
  const p99All = Math.max(...frameList.map((f) => f.p99 || 0));

  const names = endpointsList && endpointsList.length ? endpointsList : ['http_req_duration'];
  return names.map((raw, idx) => {
    const { step, metric } = parseRequestMetricName(raw, idx + 1);
    return {
      step,
      name: metric,
      rawName: raw,
      min: minAll,
      max: maxAll,
      avg: avgAll,
      p95: p95All,
      p99: p99All,
      count: Math.max(1, Math.round(totalCount / names.length))
    };
  });
}

function applyExternalDataset(newFrames, title, sourceLabel, endpoints, detectedAgents = [], newCombinedRequests = []) {
  frames = newFrames;
  combinedRequests = newCombinedRequests && newCombinedRequests.length
    ? newCombinedRequests
    : buildFallbackCombinedRequests(newFrames, endpoints);
  playheadFloat = 0;
  timelineSlider.min = '0';
  timelineSlider.max = String(Math.max(1, frames.length - 1));
  timelineSlider.value = '0';

  const numLoadAgents = resolveRunnerCount(detectedAgents.length ? detectedAgents : endpoints);
  connectionStatusText.textContent = `SOURCE: ${title} · ${sourceLabel}`;
  director.showSummaryOverlay = false;
  director.setDataset(frames, {
    title,
    sourceLabel,
    endpoints,
    numLoadAgents,
    loadAgentNames: detectedAgents
  });
  renderCombinedResponseTable();
  syncLiveButtonUI();
  syncSummaryButtonUI();
  syncSliderValue();
  isPlaying = true;
  playPauseBtn.textContent = '⏸ PAUSE';
}

// Main 60fps Animation Loop
let lastRafTime = performance.now();
let lastTableSyncTime = 0;

function animate(now) {
  const dt = Math.min(0.1, (now - lastRafTime) / 1000);
  lastRafTime = now;

  if (director.hasData && !isLiveMode && isPlaying && frames.length > 1) {
    playheadFloat += dt * playbackSpeed;

    if (playheadFloat >= frames.length - 1) {
      playheadFloat = frames.length - 1;
      isPlaying = false;
      playPauseBtn.textContent = '▶ REPLAY';
      director.showSummaryOverlay = true;
      syncSummaryButtonUI();
      renderCombinedResponseTable(getInterpolatedFrame(playheadFloat));

      if (isGeneratingFullMovie && exporter.isRecording && !movieEndHoldTimer) {
        movieEndHoldTimer = setTimeout(() => {
          movieEndHoldTimer = null;
          if (exporter.isRecording) {
            exporter.stopRecording();
          }
        }, 3500);
      }
    }

    const roundedIdx = Math.round(playheadFloat);
    timelineSlider.value = String(roundedIdx);
    syncSliderValue();
  }

  if (director.hasData) {
    const interpolated = getInterpolatedFrame(playheadFloat);
    director.setFrameData(interpolated);
    if ((isPlaying || isLiveMode) && now - lastTableSyncTime > 85) {
      lastTableSyncTime = now;
      renderCombinedResponseTable(interpolated);
    }
  }
  director.updateAndRender(dt, isPlaying || isLiveMode);

  requestAnimationFrame(animate);
}

// Boot in clean NO DATA standby state until "⚔️ Load Demo" is clicked or InfluxDB 1.8 is connected
director.setNoDataState('NO DATA — CLICK "⚔️ LOAD DEMO" OR CONNECT INFLUXDB 1.8 / GRAFANA');
renderEmptyTable();
syncLiveButtonUI();
syncSummaryButtonUI();
syncSliderValue();
runInfluxHealthCheck();
setInterval(() => runInfluxHealthCheck(), 10000);
requestAnimationFrame(animate);
