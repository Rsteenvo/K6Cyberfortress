/**
 * k6 Cyber-Fortress — Deterministic Data Generator & Normalizer
 * Maps k6 InfluxDB 1.8 metrics (vus, http_reqs, http_req_duration, http_req_failed)
 * into time-bucketed frames for the 3D Fortress & Movie Renderer.
 */

export const SCENARIO_PRESETS = {
  citadel_siege: {
    id: 'citadel_siege',
    name: 'Operation Citadel Siege (Spike & Thermal Meltdown)',
    subtitle: '2,500 VUs · 4,800 RPS Peak · P95 Latency Spike to 1,890ms',
    durationSec: 120,
    bucketSec: 1,
    endpoints: [
      '/api/v2/auth/token',
      '/api/v2/checkout/submit',
      '/api/v2/catalog/search',
      '/api/v2/inventory/reserve',
      '/api/v2/payments/authorize',
      '/api/v2/profile/session'
    ],
    generate() {
      const frames = [];
      const baseTime = Date.now() - 120 * 1000;
      for (let i = 0; i <= 120; i++) {
        const t = i / 120; // 0..1
        let vus = 0;
        let rps = 0;
        let p50 = 38;
        let p95 = 55;
        let p99 = 85;
        let errorRate = 0;

        if (i < 18) {
          // Stage 1: Baseline Warmup
          const p = i / 18;
          vus = Math.round(40 + p * 260);
          rps = Math.round(120 + p * 680 + Math.sin(i * 0.9) * 25);
          p50 = 34 + p * 18;
          p95 = 52 + p * 45 + Math.cos(i) * 4;
          p99 = 88 + p * 70;
          errorRate = 0;
        } else if (i < 42) {
          // Stage 2: Heavy Load Assault (Sustained Ramp)
          const p = (i - 18) / 24;
          vus = Math.round(300 + p * 1100);
          rps = Math.round(800 + p * 2200 + Math.sin(i * 1.3) * 90);
          p50 = 55 + Math.pow(p, 1.4) * 140;
          p95 = 98 + Math.pow(p, 1.6) * 340 + Math.sin(i * 0.8) * 18;
          p99 = 160 + Math.pow(p, 1.7) * 520;
          errorRate = p > 0.6 ? (p - 0.6) * 0.025 : 0;
        } else if (i < 68) {
          // Stage 3: Botnet Surge -> Connection Pool Saturation & Thermal Spike
          const p = (i - 42) / 26;
          vus = Math.round(1400 + Math.sin(p * Math.PI * 0.65) * 1100);
          rps = Math.round(3000 + Math.sin(p * Math.PI * 0.75) * 1820 + Math.cos(i * 1.7) * 140);
          p50 = 195 + Math.pow(p, 1.3) * 490;
          p95 = 440 + Math.pow(p, 1.45) * 1180 + Math.sin(i * 1.5) * 45;
          p99 = 680 + Math.pow(p, 1.5) * 1650;
          errorRate = 0.01 + Math.pow(p, 1.8) * 0.145;
        } else if (i < 88) {
          // Stage 4: Core Overheat Peak (DB Lock Contention & Timeouts)
          const p = (i - 68) / 20;
          const peakWave = Math.sin(p * Math.PI);
          vus = Math.round(2350 + peakWave * 150);
          // Throughput starts throttling slightly as latency peaks (classic Little's Law knee)
          rps = Math.round(4300 - peakWave * 650 + Math.sin(i * 2.1) * 160);
          p50 = 680 + peakWave * 290;
          p95 = 1580 + peakWave * 310 + Math.cos(i * 1.9) * 55;
          p99 = 2250 + peakWave * 640;
          errorRate = 0.15 + peakWave * 0.12;
        } else {
          // Stage 5: Ramp-down & Thermal Cooldown
          const p = (i - 88) / 32;
          const decay = Math.pow(1 - p, 1.8);
          vus = Math.max(25, Math.round(2350 * decay));
          rps = Math.max(85, Math.round(3900 * decay + Math.sin(i) * 30));
          // Thermal inertia: latency cools down slightly slower than VUs drop
          const thermalDecay = Math.pow(1 - p, 1.35);
          p50 = Math.round(42 + 640 * thermalDecay);
          p95 = Math.round(64 + 1520 * thermalDecay);
          p99 = Math.round(105 + 2150 * thermalDecay);
          errorRate = Math.max(0, 0.14 * Math.pow(1 - p, 2.6));
        }

        const failedReqs = Math.round(rps * errorRate);
        frames.push({
          index: i,
          timestamp: baseTime + i * 1000,
          elapsedSec: i,
          vus,
          rps: Math.max(0, rps),
          p50: Math.round(p50),
          p95: Math.round(p95),
          p99: Math.round(p99),
          errorRate: Number((errorRate * 100).toFixed(2)),
          failedReqs,
          checksPassRate: Number((100 - errorRate * 85).toFixed(1))
        });
      }
      return frames;
    }
  },

  ddos_tsunami: {
    id: 'ddos_tsunami',
    name: 'Botnet Tsunami (Breakpoint Circuit-Breaker Test)',
    subtitle: '6,000 VUs · 8,200 RPS · Sudden Saturation & Circuit Breaker Trip',
    durationSec: 90,
    bucketSec: 1,
    endpoints: [
      '/api/v1/login',
      '/api/v1/orders/create',
      '/api/v1/feed/stream',
      '/api/v1/cart/mutate',
      '/api/v1/search/query',
      '/api/v1/webhook/ingest'
    ],
    generate() {
      const frames = [];
      const baseTime = Date.now() - 90 * 1000;
      for (let i = 0; i <= 90; i++) {
        // Step load every 18 seconds
        const step = Math.min(4, Math.floor(i / 18));
        const stepProgress = (i % 18) / 18;
        let vus = [250, 1200, 2800, 5800, 400][step];
        if (step < 4) {
          const nextVus = [250, 1200, 2800, 5800, 400][step + 1] || vus;
          if (stepProgress > 0.75) {
            vus = Math.round(vus + (nextVus - vus) * ((stepProgress - 0.75) / 0.25));
          }
        }

        let rps = Math.round(vus * 1.45 + Math.sin(i * 1.7) * 140);
        let p95 = 65;
        let errorRate = 0;

        if (step === 0) {
          p95 = 62 + Math.sin(i) * 8;
        } else if (step === 1) {
          p95 = 175 + stepProgress * 95 + Math.cos(i * 1.2) * 15;
          errorRate = 0.004;
        } else if (step === 2) {
          p95 = 480 + stepProgress * 460 + Math.sin(i * 1.5) * 35;
          errorRate = 0.035 + stepProgress * 0.05;
        } else if (step === 3) {
          // Breakpoint breached
          p95 = 1420 + stepProgress * 980 + Math.sin(i * 2.3) * 90;
          errorRate = 0.18 + stepProgress * 0.21;
          rps = Math.round(rps * 0.78); // saturation drop
        } else {
          // Recovery step
          const cool = 1 - stepProgress;
          p95 = Math.round(85 + cool * 950);
          errorRate = Math.max(0, cool * 0.09);
        }

        const p50 = Math.round(p95 * 0.44);
        const p99 = Math.round(p95 * 1.48);

        frames.push({
          index: i,
          timestamp: baseTime + i * 1000,
          elapsedSec: i,
          vus,
          rps,
          p50,
          p95: Math.round(p95),
          p99,
          errorRate: Number((errorRate * 100).toFixed(2)),
          failedReqs: Math.round(rps * errorRate),
          checksPassRate: Number((100 - errorRate * 92).toFixed(1))
        });
      }
      return frames;
    }
  },

  endurance_pulse: {
    id: 'endurance_pulse',
    name: 'Cyber-Grid Micro-Burst Soak (GC Pause & Cache Stampede)',
    subtitle: '1,500 VUs Constant · Periodic Cache Expiry Thermal Waves',
    durationSec: 100,
    bucketSec: 1,
    endpoints: [
      '/graphql/query',
      '/api/recommendations',
      '/api/ledger/sync',
      '/api/media/transcode',
      '/api/notifications/poll',
      '/api/analytics/batch'
    ],
    generate() {
      const frames = [];
      const baseTime = Date.now() - 100 * 1000;
      for (let i = 0; i <= 100; i++) {
        const ramp = Math.min(1, i / 12) * Math.min(1, (100 - i) / 10);
        const vus = Math.round(100 + ramp * 1400);
        // Three cache-stampede waves at t=28, t=55, t=80
        const wave1 = Math.exp(-Math.pow((i - 28) / 5.5, 2));
        const wave2 = Math.exp(-Math.pow((i - 55) / 6.5, 2)) * 1.35;
        const wave3 = Math.exp(-Math.pow((i - 80) / 5.0, 2)) * 1.15;
        const stampede = wave1 + wave2 + wave3;

        const rps = Math.round(vus * 1.9 + stampede * 1450 + Math.sin(i * 1.4) * 65);
        const p95 = Math.round(92 * ramp + stampede * 980 + Math.cos(i * 1.1) * 12);
        const p50 = Math.round(p95 * 0.48);
        const p99 = Math.round(p95 * 1.52);
        const errorRate = Math.max(0, (stampede - 0.45) * 0.14);

        frames.push({
          index: i,
          timestamp: baseTime + i * 1000,
          elapsedSec: i,
          vus,
          rps,
          p50,
          p95,
          p99,
          errorRate: Number((errorRate * 100).toFixed(2)),
          failedReqs: Math.round(rps * errorRate),
          checksPassRate: Number((100 - errorRate * 88).toFixed(1))
        });
      }
      return frames;
    }
  }
};

/**
 * Computes thermal index (0.0 = cryo nominal, 1.0 = critical core meltdown)
 * based on user-configured latency thresholds.
 */
export function computeThermalState(frame, thresholds = { nominalMs: 180, warningMs: 500, criticalMs: 1100 }) {
  if (!frame) {
    return {
      heat: 0,
      coreTempC: 35,
      level: 'NOMINAL',
      label: 'CRYO-STABLE',
      colorHex: '#00f0ff'
    };
  }

  const p95 = frame.p95 || 0;
  const errPenalty = (frame.errorRate || 0) * 18; // Errors add extra thermal stress
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
  // Core temperature scales from 38°C (idle) to 1,280°C (meltdown)
  const coreTempC = Math.round(38 + Math.pow(heat, 1.45) * 1242);

  let level = 'NOMINAL';
  let label = 'CRYO-NOMINAL';
  let colorHex = '#00f0ff';

  if (heat >= 0.82) {
    level = 'MELTDOWN';
    label = 'CORE OVERHEAT // SLA BREACH';
    colorHex = '#ff0044';
  } else if (heat >= 0.56) {
    level = 'WARNING';
    label = 'THERMAL ESCALATION';
    colorHex = '#ff5500';
  } else if (heat >= 0.28) {
    level = 'ELEVATED';
    label = 'SHIELDS WARMING';
    colorHex = '#ffaa00';
  }

  return {
    heat,
    coreTempC,
    level,
    label,
    colorHex
  };
}
