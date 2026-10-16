/**
 * k6 Cyber-Fortress — Thermal State Calculator
 * Maps k6 InfluxDB 1.8 response time (`http_req_duration` P95) & error rate (`http_req_failed`)
 * relative to SLA thresholds into the Fortress color and core temperature.
 */

export function computeThermalState(frame, thresholds = { nominalMs: 180, warningMs: 500, criticalMs: 1100 }) {
  if (!frame || frame.noData) {
    return {
      heat: 0,
      coreTempC: 0,
      level: 'STANDBY',
      label: 'NO DATA // STANDBY',
      colorHex: '#4b6b8a'
    };
  }

  const p95 = frame.p95 || 0;
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
  const coreTempC = Math.round(38 + Math.pow(heat, 1.45) * 1242);

  let level = 'NOMINAL';
  let label = 'CRYO-NOMINAL';
  let colorHex = '#00f0ff';

  if (heat >= 0.82) {
    level = 'MELTDOWN';
    label = 'CORE OVERHEAT // SLA BREACH';
    colorHex = '#ff004c';
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
