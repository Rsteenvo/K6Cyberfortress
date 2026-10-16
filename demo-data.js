/**
 * k6 Sparta // Total War — Fortress Siege State Calculator & Built-In Demo Generator
 * Maps k6 InfluxDB 1.8 response time (`http_req_duration` P95) & error rate (`http_req_failed`)
 * relative to SLA thresholds into the Medieval Fortress defense state, siege intensity,
 * and 30-second (30,000 ms) catastrophic castle explosion at the end of the test.
 */

export const DEMO_VARIABLE_OPTIONS = {
  sutValues: ['ecommerce-fortress-api', 'checkout-core-svc', 'payment-gateway'],
  envValues: ['staging-eu-west', 'perf-war-room', 'prod-shadow'],
  runIdValues: ['RUN-2026-SPARTA-300', 'RUN-2026-HEAVY-SIEGE', 'RUN-2026-ENDURANCE']
};

export const CASTLE_BREAK_MS = 30000; // 30 seconds response time breach

export function computeThermalState(frame, thresholds = { nominalMs: 180, warningMs: 500, criticalMs: 1100 }) {
  if (!frame || frame.noData) {
    return {
      heat: 0,
      breachFracture: 0,
      castleBroken: false,
      coreTempC: 0,
      level: 'STANDBY',
      label: 'NO DATA // GATES CLOSED',
      colorHex: '#a1a0ab'
    };
  }

  const p95 = frame.p95 || 0;
  const p99 = frame.p99 || p95;
  const errPenalty = (frame.errorRate || 0) * 18;
  const effectiveMs = p95 + errPenalty;

  const { nominalMs, warningMs, criticalMs } = thresholds;
  let heat = 0;

  if (effectiveMs <= nominalMs) {
    heat = (effectiveMs / Math.max(1, nominalMs)) * 0.25;
  } else if (effectiveMs <= warningMs) {
    heat = 0.25 + ((effectiveMs - nominalMs) / Math.max(1, warningMs - nominalMs)) * 0.35;
  } else {
    heat = 0.60 + ((effectiveMs - warningMs) / Math.max(1, criticalMs - warningMs)) * 0.40;
  }

  heat = Math.max(0, Math.min(1, heat));

  // Structural fracture builds as latency climbs past 8s and triggers full explosion when breaching 30,000ms (30s)
  const peakLatencyMs = Math.max(p95, p99 * 0.94);
  const breachFracture = peakLatencyMs <= 8000
    ? 0
    : Math.max(0, Math.min(1, (peakLatencyMs - 8000) / (CASTLE_BREAK_MS - 8000)));
  const castleBroken = p95 >= CASTLE_BREAK_MS || p99 >= CASTLE_BREAK_MS;

  const coreTempC = Math.round(38 + Math.pow(heat, 1.45) * 1242 + breachFracture * 1450);

  let level = 'NOMINAL';
  let label = 'WALLS HOLDING // PHALANX STEADY';
  let colorHex = '#e6c687';

  if (castleBroken) {
    level = 'EXPLODED';
    label = '💥 CASTLE EXPLODED! // >30s RESPONSE TIME BREACH';
    colorHex = '#ff1e42';
  } else if (breachFracture >= 0.25) {
    level = 'CRACKING';
    label = `WALLS FRACTURING // ${(p95 / 1000).toFixed(1)}s LATENCY`;
    colorHex = '#ef4444';
  } else if (heat >= 0.82) {
    level = 'MELTDOWN';
    label = 'THIS IS SPARTA! // WALLS BREACHED';
    colorHex = '#ef4444';
  } else if (heat >= 0.56) {
    level = 'WARNING';
    label = 'HEAVY SIEGE ASSAULT';
    colorHex = '#f97316';
  } else if (heat >= 0.28) {
    level = 'ELEVATED';
    label = 'SHIELDS LOCKED // ENGAGED';
    colorHex = '#f59e0b';
  }

  return {
    heat,
    breachFracture,
    castleBroken,
    coreTempC,
    level,
    label,
    colorHex
  };
}

/**
 * Generates a 120-frame k6 siege execution where the Spartan legions progressively overwhelm the fortress
 * and at the END of the run, response times breach 30,000 ms (30+ seconds) and the castle explodes!
 */
export function generateDemoExecution({
  sut = 'ecommerce-fortress-api',
  env = 'staging-eu-west',
  runId = 'RUN-2026-SPARTA-300'
} = {}) {
  const seedStr = `${sut}:${env}:${runId}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) % 1000;
  }
  const scaleFactor = 0.96 + (hash % 9) / 100;

  const detectedAgents = [
    'sparta-legion-01',
    'sparta-legion-02',
    'sparta-legion-03',
    'sparta-legion-04',
    'sparta-legion-05',
    'sparta-legion-06'
  ];

  const endpoints = [
    '01_OpenHomepage',
    '02_BrowseCategoryCatalog',
    '03_SearchProductsQuery',
    '04_GetProductDetails',
    '05_CheckInventoryStock',
    '06_AddItemToCart',
    '07_ApplyPromoVoucher',
    '08_CalculateShippingRates',
    '09_SubmitCheckoutOrder',
    '10_AuthorizePaymentGateway'
  ];

  const totalPoints = 120;
  const stepSec = 2;
  const nowMs = Date.now() - totalPoints * stepSec * 1000;
  const frames = [];

  for (let i = 0; i < totalPoints; i++) {
    const progress = i / (totalPoints - 1);
    const wave = Math.sin(i * 0.35);
    const micro = Math.cos(i * 0.85);

    let loadEnvelope = 0;
    let timeoutSurgeMs = 0;

    if (progress < 0.28) {
      // Phase 1 (0% - 28%): Legion Muster & Initial March (Nominal 55ms - 180ms)
      loadEnvelope = (progress / 0.28) * 0.42;
    } else if (progress < 0.58) {
      // Phase 2 (28% - 58%): Heavy Phalanx Shield Wall Assault (220ms - 1,800ms)
      loadEnvelope = 0.42 + ((progress - 0.28) / 0.30) * 0.36;
    } else if (progress < 0.80) {
      // Phase 3 (58% - 80%): Structural Cracking — Latency climbs from 2s to 26s as walls fracture
      const crackPhase = (progress - 0.58) / 0.22;
      loadEnvelope = 0.78 + crackPhase * 0.18;
      timeoutSurgeMs = Math.round(Math.pow(crackPhase, 1.75) * 26500);
    } else {
      // Phase 4 (80% - 100% AT THE END): 30-SECOND BREACH & CASTLE EXPLOSION! (30,200ms -> 35,400ms)
      const endPhase = (progress - 0.80) / 0.20;
      loadEnvelope = 0.96 + endPhase * 0.12;
      timeoutSurgeMs = Math.round(29200 + endPhase * 5800);
    }

    const vus = Math.max(12, Math.round((loadEnvelope * 2900 + wave * 45) * scaleFactor));
    const rps = Math.max(35, Math.round((loadEnvelope * 4500 + wave * 140 + micro * 55) * scaleFactor));

    const congestion = Math.pow(Math.max(0, loadEnvelope), 2.15);
    const p50 = Math.max(18, Math.round((45 + congestion * 340 + timeoutSurgeMs * 0.42 + wave * 15) * scaleFactor));
    const p90 = Math.max(p50 + 20, Math.round((90 + congestion * 780 + timeoutSurgeMs * 0.85 + wave * 35) * scaleFactor));
    const p95 = Math.max(p90 + 15, Math.round((115 + congestion * 1150 + timeoutSurgeMs + wave * 50) * scaleFactor));
    const p99 = Math.max(p95 + 40, Math.round(Math.min(39800, p95 * 1.12 + Math.abs(micro) * 240)));
    const min = Math.max(8, Math.round(Math.min(250, p50 * 0.32)));
    const max = Math.round(Math.min(42500, p99 * 1.08));
    const mean = Math.round(p50 * 0.62 + p95 * 0.38);

    let errorRate = 0;
    if (p95 >= CASTLE_BREAK_MS) {
      errorRate = Number(Math.min(64.0, 28.0 + ((p95 - CASTLE_BREAK_MS) / 5000) * 25.0 + Math.abs(wave) * 2.2).toFixed(2));
    } else if (p95 >= 10000) {
      errorRate = Number(Math.min(27.5, 4.5 + ((p95 - 10000) / 20000) * 22.0 + Math.abs(wave) * 1.4).toFixed(2));
    } else if (loadEnvelope > 0.58) {
      errorRate = Number(((loadEnvelope - 0.58) * 14.0 + Math.abs(wave) * 0.9).toFixed(2));
    } else if (loadEnvelope > 0.40) {
      errorRate = Number(((loadEnvelope - 0.40) * 2.2).toFixed(2));
    }
    const failedReqs = Math.round((rps * errorRate) / 100);
    const checksPassRate = Number(Math.max(36, 100 - errorRate * 1.05).toFixed(1));

    frames.push({
      index: i,
      timestampMs: nowMs + i * stepSec * 1000,
      elapsedSec: i * stepSec,
      vus,
      rps,
      mean,
      min,
      max,
      p50,
      p90,
      p95,
      p99,
      errorRate,
      failedReqs,
      checksPassRate
    });
  }

  // Combined Request Metrics Table (`01 | METRICS | MIN | MAX | AVG | P95 | P99 | COUNT`)
  const baseRequests = [
    { step: '01', name: 'OpenHomepage', min: 14, max: 14200, avg: 420, p90: 1850, p95: 3420, p99: 8900, count: 64280 },
    { step: '02', name: 'BrowseCategoryCatalog', min: 19, max: 18600, avg: 610, p90: 2940, p95: 5840, p99: 14200, count: 54120 },
    { step: '03', name: 'SearchProductsQuery', min: 28, max: 30400, avg: 1890, p90: 9400, p95: 18600, p99: 30100, count: 46890 },
    { step: '04', name: 'GetProductDetails', min: 16, max: 15800, avg: 540, p90: 2410, p95: 4920, p99: 11800, count: 51340 },
    { step: '05', name: 'CheckInventoryStock', min: 22, max: 31200, avg: 2340, p90: 12800, p95: 24500, p99: 30400, count: 38920 },
    { step: '06', name: 'AddItemToCart', min: 25, max: 28400, avg: 1620, p90: 8200, p95: 16400, p99: 26900, count: 32450 },
    { step: '07', name: 'ApplyPromoVoucher', min: 31, max: 29600, avg: 1980, p90: 10600, p95: 21200, p99: 28900, count: 19840 },
    { step: '08', name: 'CalculateShippingRates', min: 38, max: 31800, avg: 2890, p90: 15400, p95: 29200, p99: 31100, count: 24110 },
    { step: '09', name: 'SubmitCheckoutOrder', min: 54, max: 34200, avg: 4120, p90: 22600, p95: 31450, p99: 33600, count: 18650 },
    { step: '10', name: 'AuthorizePaymentGateway', min: 68, max: 36800, avg: 4860, p90: 25800, p95: 33200, p99: 35900, count: 16420 }
  ];

  const combinedRequests = baseRequests.map((r) => ({
    step: r.step,
    name: r.name,
    rawName: `${r.step}_${r.name}`,
    min: Math.round(r.min * scaleFactor),
    max: Math.round(r.max * scaleFactor),
    avg: Math.round(r.avg * scaleFactor),
    p90: Math.round(r.p90 * scaleFactor),
    p95: Math.round(r.p95 * scaleFactor),
    p99: Math.round(r.p99 * scaleFactor),
    count: Math.round(r.count * scaleFactor)
  }));

  return {
    frames,
    endpoints,
    detectedAgents,
    combinedRequests,
    sut,
    env,
    runId
  };
}
