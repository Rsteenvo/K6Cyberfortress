/**
 * k6 Cyber-Fortress — InfluxDB 1.8 & Grafana Datasource Client
 * Queries both aggregate and per-endpoint ("name" tag) actual response times:
 *   - vus (MAX("value"))
 *   - http_reqs (SUM("value"))
 *   - http_req_duration (MIN, MEAN, PERCENTILE 50, PERCENTILE 90, PERCENTILE 95, PERCENTILE 99, MAX)
 *   - http_req_failed (MEAN("value"), SUM("value"))
 *   - Per-request/endpoint breakdown grouped by "name" tag
 */

export class InfluxK6Client {
  constructor(config = {}) {
    this.url = (config.url || 'http://localhost:8086').replace(/\/+$/, '');
    this.database = config.database || 'k6';
    this.username = config.username || '';
    this.password = config.password || '';
    this.authToken = config.authToken || '';
    this.runnerTagKey = config.runnerTagKey || 'auto';
    this.useLocalProxy = config.useLocalProxy ?? true;
  }

  async queryInfluxQL(influxQL) {
    const params = new URLSearchParams({
      db: this.database,
      q: influxQL,
      epoch: 'ms'
    });
    if (this.username) params.set('u', this.username);
    if (this.password) params.set('p', this.password);

    const headers = {
      Accept: 'application/json'
    };
    if (this.authToken) {
      headers['Authorization'] = this.authToken.startsWith('Bearer ') || this.authToken.startsWith('Token ')
        ? this.authToken
        : `Bearer ${this.authToken}`;
    } else if (this.username && this.password) {
      headers['Authorization'] = 'Basic ' + btoa(`${this.username}:${this.password}`);
    }

    const directTarget = `${this.url}/query?${params.toString()}`;

    if (this.useLocalProxy && window.location.protocol.startsWith('http')) {
      try {
        const proxyResp = await fetch('/api/influx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUrl: directTarget,
            headers
          })
        });
        if (proxyResp.ok) {
          return await proxyResp.json();
        }
        if (proxyResp.status !== 404) {
          const errText = await proxyResp.text();
          throw new Error(`InfluxDB HTTP ${proxyResp.status}: ${errText}`);
        }
      } catch (err) {
        if (err.message && err.message.startsWith('InfluxDB HTTP')) {
          throw err;
        }
      }
    }

    const response = await fetch(directTarget, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`InfluxDB (${response.status}): ${text || response.statusText}`);
    }

    return await response.json();
  }

  async discoverMetadata() {
    const discoveryQuery = [
      'SHOW MEASUREMENTS',
      'SELECT "value" FROM "http_reqs" ORDER BY time DESC LIMIT 1',
      'SELECT "value" FROM "http_reqs" ORDER BY time ASC LIMIT 1',
      'SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"',
      'SHOW TAG VALUES FROM "http_reqs" WITH KEY = "testid"',
      'SHOW TAG VALUES FROM "http_reqs" WITH KEY IN ("instance_id", "runner", "load_zone", "pod", "scenario")'
    ].join('; ');

    const data = await this.queryInfluxQL(discoveryQuery);
    const results = data?.results || [];

    const measurements = (results[0]?.series?.[0]?.values || []).map((v) => v[0]);
    const latestPoint = results[1]?.series?.[0]?.values?.[0]?.[0] || null;
    const earliestPoint = results[2]?.series?.[0]?.values?.[0]?.[0] || null;
    const endpoints = (results[3]?.series?.[0]?.values || []).map((v) => v[1]).filter(Boolean);
    const testIds = (results[4]?.series?.[0]?.values || []).map((v) => v[1]).filter(Boolean);
    const runnerTags = (results[5]?.series?.[0]?.values || []).map((v) => `${v[0]}:${v[1]}`).filter(Boolean);

    return {
      measurements,
      earliestTimeMs: earliestPoint,
      latestTimeMs: latestPoint,
      endpoints: endpoints.slice(0, 16),
      testIds,
      runnerTags
    };
  }

  async detectLoadAgents(whereClause = '') {
    const candidateKeys = this.runnerTagKey && this.runnerTagKey !== 'auto'
      ? [this.runnerTagKey]
      : ['instance_id', 'runner', 'load_zone', 'pod', 'scenario', 'name'];

    for (const key of candidateKeys) {
      try {
        const q = `SHOW TAG VALUES FROM "http_reqs" WITH KEY = "${key}" ${whereClause}`;
        const res = await this.queryInfluxQL(q);
        const vals = (res?.results?.[0]?.series?.[0]?.values || [])
          .map((row) => row[1])
          .filter(Boolean);
        if (vals.length > 0) {
          return {
            tagKey: key,
            agents: vals.slice(0, 16)
          };
        }
      } catch (_) {}
    }

    return {
      tagKey: 'default',
      agents: ['RUNNER-01']
    };
  }

  _buildStatements(whereClause, bucket) {
    return [
      // Statement 0: Virtual Users (vus)
      `SELECT MAX("value") AS "vus" FROM "vus" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 1: Total HTTP Requests per bucket (http_reqs)
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 2: Overall HTTP Request Duration stats (min, mean, p50, p90, p95, p99, max)
      `SELECT PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MEAN("value") AS "mean", MIN("value") AS "min", MAX("value") AS "max", PERCENTILE("value", 90) AS "p90" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 3: HTTP Request Failed rate
      `SELECT MEAN("value") AS "fail_rate", SUM("value") AS "fail_count" FROM "http_req_failed" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 4: Endpoint tag names
      `SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"`,
      // Statement 5: Per-endpoint actual response times grouped by "name"
      `SELECT MEAN("value") AS "mean", PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 90) AS "p90", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MAX("value") AS "max" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}), "name" fill(none)`,
      // Statement 6: Per-endpoint request count & error rate grouped by "name"
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}), "name" fill(0)`
    ];
  }

  async fetchTestExecution(options = {}) {
    const bucket = options.bucketInterval || '2s';
    const bucketSec = parseBucketToSeconds(bucket);

    let timeClause = '';
    if (options.timeFilterMode === 'custom' && options.startTimeISO && options.endTimeISO) {
      const startMs = new Date(options.startTimeISO).getTime();
      const endMs = new Date(options.endTimeISO).getTime();
      timeClause = `time >= ${startMs}ms AND time <= ${endMs}ms`;
    } else if (options.timeFilterMode === 'relative' && options.relativeWindow) {
      timeClause = `time >= now() - ${options.relativeWindow}`;
    } else {
      const latestRes = await this.queryInfluxQL('SELECT "value" FROM "http_reqs" ORDER BY time DESC LIMIT 1');
      const latestTs = latestRes?.results?.[0]?.series?.[0]?.values?.[0]?.[0];
      if (!latestTs) {
        throw new Error(`No points found in measurement "http_reqs" in database "${this.database}".`);
      }
      const lookbackStart = latestTs - 2 * 3600 * 1000;
      timeClause = `time >= ${lookbackStart}ms AND time <= ${latestTs + 5000}ms`;
    }

    const extraTagClause = options.tagFilter?.trim() ? ` AND (${options.tagFilter.trim()})` : '';
    const whereClause = `WHERE ${timeClause}${extraTagClause}`;

    const statements = this._buildStatements(whereClause, bucket);
    const [rawResponse, detectedRunners] = await Promise.all([
      this.queryInfluxQL(statements.join('; ')),
      this.detectLoadAgents()
    ]);

    const normalized = normalizeInfluxResponse(rawResponse, bucketSec);
    normalized.detectedAgents = detectedRunners.agents;
    normalized.runnerTagKey = detectedRunners.tagKey;
    return normalized;
  }

  async fetchLiveTelemetry(options = {}) {
    const windowStr = options.liveWindow || '3m';
    const bucket = options.bucketInterval || '1s';
    const bucketSec = parseBucketToSeconds(bucket);
    const extraTagClause = options.tagFilter?.trim() ? ` AND (${options.tagFilter.trim()})` : '';
    const whereClause = `WHERE time >= now() - ${windowStr}${extraTagClause}`;

    const statements = this._buildStatements(whereClause, bucket);
    const [rawResponse, detectedRunners] = await Promise.all([
      this.queryInfluxQL(statements.join('; ')),
      this.detectLoadAgents()
    ]);

    const normalized = normalizeInfluxResponse(rawResponse, bucketSec);
    normalized.detectedAgents = detectedRunners.agents;
    normalized.runnerTagKey = detectedRunners.tagKey;
    return normalized;
  }
}

export function parseBucketToSeconds(bucketStr) {
  const match = String(bucketStr).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!match) return 1;
  const val = parseFloat(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'ms') return Math.max(0.1, val / 1000);
  if (unit === 'm') return val * 60;
  if (unit === 'h') return val * 3600;
  return val;
}

export function normalizeInfluxResponse(rawResponse, bucketSec = 1) {
  const results = rawResponse?.results || [];
  const timeMap = new Map();

  const ensureBucket = (ts) => {
    if (!timeMap.has(ts)) {
      timeMap.set(ts, {
        timestamp: ts,
        vus: null,
        reqs: 0,
        min: null,
        mean: null,
        p50: null,
        p90: null,
        p95: null,
        p99: null,
        max: null,
        failRate: 0,
        failCount: 0,
        byEndpoint: {}
      });
    }
    return timeMap.get(ts);
  };

  // Statement 0: vus
  const vusValues = results[0]?.series?.[0]?.values || [];
  for (const [ts, vus] of vusValues) {
    if (vus !== null && vus !== undefined) {
      ensureBucket(ts).vus = Math.round(Number(vus));
    }
  }

  // Statement 1: http_reqs
  const reqValues = results[1]?.series?.[0]?.values || [];
  for (const [ts, reqs] of reqValues) {
    if (reqs !== null && reqs !== undefined) {
      ensureBucket(ts).reqs = Number(reqs);
    }
  }

  // Statement 2: Overall http_req_duration (p50, p95, p99, mean, min, max, p90)
  const durValues = results[2]?.series?.[0]?.values || [];
  for (const [ts, p50, p95, p99, mean, min, max, p90] of durValues) {
    const b = ensureBucket(ts);
    b.p50 = p50 ?? mean ?? 0;
    b.p95 = p95 ?? mean ?? 0;
    b.p99 = p99 ?? b.p95 ?? 0;
    b.mean = mean ?? b.p50 ?? 0;
    b.min = min ?? b.p50 ?? 0;
    b.max = max ?? b.p99 ?? 0;
    b.p90 = p90 ?? b.p95 ?? 0;
  }

  // Statement 3: http_req_failed
  const failValues = results[3]?.series?.[0]?.values || [];
  for (const [ts, failRate, failCount] of failValues) {
    const b = ensureBucket(ts);
    b.failRate = Number(failRate || 0);
    b.failCount = Number(failCount || 0);
  }

  // Statement 4: Endpoint tag names
  const endpointValues = results[4]?.series?.[0]?.values || [];
  const endpoints = endpointValues.map((row) => row[1]).filter(Boolean).slice(0, 16);

  // Statement 5: Per-endpoint http_req_duration grouped by "name"
  const epDurSeries = results[5]?.series || [];
  for (const serie of epDurSeries) {
    const epName = serie.tags?.name || 'default';
    for (const [ts, mean, p50, p90, p95, p99, max] of serie.values || []) {
      const b = ensureBucket(ts);
      if (!b.byEndpoint[epName]) b.byEndpoint[epName] = { name: epName, rps: 0 };
      b.byEndpoint[epName].mean = Math.round(mean ?? p50 ?? 0);
      b.byEndpoint[epName].p50 = Math.round(p50 ?? mean ?? 0);
      b.byEndpoint[epName].p90 = Math.round(p90 ?? p95 ?? 0);
      b.byEndpoint[epName].p95 = Math.round(p95 ?? mean ?? 0);
      b.byEndpoint[epName].p99 = Math.round(p99 ?? p95 ?? 0);
      b.byEndpoint[epName].max = Math.round(max ?? p99 ?? 0);
    }
  }

  // Statement 6: Per-endpoint http_reqs grouped by "name"
  const epReqSeries = results[6]?.series || [];
  for (const serie of epReqSeries) {
    const epName = serie.tags?.name || 'default';
    for (const [ts, reqs] of serie.values || []) {
      const b = ensureBucket(ts);
      if (!b.byEndpoint[epName]) b.byEndpoint[epName] = { name: epName };
      b.byEndpoint[epName].rps = Math.round(Number(reqs || 0) / Math.max(0.1, bucketSec));
    }
  }

  let sorted = Array.from(timeMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  const firstActiveIdx = sorted.findIndex((b) => (b.reqs > 0) || (b.vus && b.vus > 0) || (b.p95 && b.p95 > 0));
  let lastActiveIdx = sorted.length - 1;
  while (lastActiveIdx > firstActiveIdx && sorted[lastActiveIdx].reqs === 0 && !sorted[lastActiveIdx].vus && !sorted[lastActiveIdx].p95) {
    lastActiveIdx--;
  }

  if (firstActiveIdx !== -1 && lastActiveIdx >= firstActiveIdx) {
    sorted = sorted.slice(firstActiveIdx, lastActiveIdx + 1);
  }

  if (sorted.length === 0) {
    throw new Error('InfluxDB returned 0 active data points for the selected time window.');
  }

  let lastVus = 1;
  let lastMin = 0;
  let lastMean = 0;
  let lastP50 = 0;
  let lastP90 = 0;
  let lastP95 = 0;
  let lastP99 = 0;
  let lastMax = 0;
  let lastByEndpoint = {};
  const startTs = sorted[0].timestamp;

  const frames = sorted.map((b, idx) => {
    if (b.vus !== null && b.vus !== undefined) lastVus = b.vus;
    if (b.min !== null && b.min !== undefined) lastMin = b.min;
    if (b.mean !== null && b.mean !== undefined) lastMean = b.mean;
    if (b.p50 !== null && b.p50 !== undefined) lastP50 = b.p50;
    if (b.p90 !== null && b.p90 !== undefined) lastP90 = b.p90;
    if (b.p95 !== null && b.p95 !== undefined) lastP95 = b.p95;
    if (b.p99 !== null && b.p99 !== undefined) lastP99 = b.p99;
    if (b.max !== null && b.max !== undefined) lastMax = b.max;
    if (Object.keys(b.byEndpoint).length > 0) {
      lastByEndpoint = { ...lastByEndpoint, ...b.byEndpoint };
    }

    const rps = Math.round(b.reqs / Math.max(0.1, bucketSec));
    const errorRatePct = Number((b.failRate * 100).toFixed(2));

    return {
      index: idx,
      timestamp: b.timestamp,
      elapsedSec: Math.round((b.timestamp - startTs) / 1000),
      vus: lastVus,
      rps,
      min: Math.round(lastMin),
      mean: Math.round(lastMean),
      p50: Math.round(lastP50),
      p90: Math.round(lastP90),
      p95: Math.round(lastP95),
      p99: Math.round(lastP99),
      max: Math.round(lastMax),
      errorRate: errorRatePct,
      failedReqs: Math.round(b.failCount / Math.max(0.1, bucketSec)),
      checksPassRate: Number(Math.max(0, 100 - errorRatePct).toFixed(1)),
      endpointRows: Object.values(lastByEndpoint)
    };
  });

  return {
    frames,
    endpoints: endpoints.length > 0 ? endpoints : Object.keys(lastByEndpoint),
    bucketSec
  };
}
