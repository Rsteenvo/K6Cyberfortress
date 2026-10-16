/**
 * k6 Cyber-Fortress — InfluxDB 1.8 & Grafana Datasource Client
 * Queries standard k6 measurements:
 *   - vus (MEAN / MAX value)
 *   - http_reqs (SUM(value) per bucket -> RPS)
 *   - http_req_duration (PERCENTILE(value, 50), PERCENTILE(value, 95), PERCENTILE(value, 99))
 *   - http_req_failed (MEAN(value) / SUM(value))
 */

export class InfluxK6Client {
  constructor(config = {}) {
    this.url = (config.url || 'http://localhost:8086').replace(/\/+$/, '');
    this.database = config.database || 'k6';
    this.username = config.username || '';
    this.password = config.password || '';
    this.authToken = config.authToken || ''; // For Grafana proxy or Influx Token
    this.useLocalProxy = config.useLocalProxy ?? true;
  }

  /**
   * Executes an InfluxQL query against InfluxDB 1.8 `/query` endpoint.
   * Automatically tries local `/api/influx` CORS proxy first if available, falling back to direct fetch.
   */
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
        // If 404 (e.g., opened via another static server), fall through to direct fetch
        if (proxyResp.status !== 404) {
          const errText = await proxyResp.text();
          throw new Error(`InfluxDB HTTP ${proxyResp.status}: ${errText}`);
        }
      } catch (err) {
        if (err.message && err.message.startsWith('InfluxDB HTTP')) {
          throw err;
        }
        // Fall back to direct browser request
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

  /**
   * Pings the InfluxDB 1.8 server and discovers available measurements, endpoints, and latest timestamps.
   */
  async discoverMetadata() {
    const discoveryQuery = [
      'SHOW MEASUREMENTS',
      'SELECT "value" FROM "http_reqs" ORDER BY time DESC LIMIT 1',
      'SELECT "value" FROM "http_reqs" ORDER BY time ASC LIMIT 1',
      'SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"',
      'SHOW TAG VALUES FROM "http_reqs" WITH KEY = "testid"'
    ].join('; ');

    const data = await this.queryInfluxQL(discoveryQuery);
    const results = data?.results || [];

    const measurements = (results[0]?.series?.[0]?.values || []).map((v) => v[0]);
    const latestPoint = results[1]?.series?.[0]?.values?.[0]?.[0] || null;
    const earliestPoint = results[2]?.series?.[0]?.values?.[0]?.[0] || null;
    const endpoints = (results[3]?.series?.[0]?.values || []).map((v) => v[1]).filter(Boolean);
    const testIds = (results[4]?.series?.[0]?.values || []).map((v) => v[1]).filter(Boolean);

    return {
      measurements,
      earliestTimeMs: earliestPoint,
      latestTimeMs: latestPoint,
      endpoints: endpoints.slice(0, 12),
      testIds
    };
  }

  /**
   * Fetches a k6 test execution from InfluxDB 1.8 and normalizes it into animation frames.
   *
   * @param {Object} options
   * @param {string} options.timeFilterMode - 'auto_latest' | 'relative' | 'custom'
   * @param {string} options.relativeWindow - e.g. '15m', '1h', '6h', '24h'
   * @param {string} options.startTimeISO - ISO string for custom start
   * @param {string} options.endTimeISO - ISO string for custom end
   * @param {string} options.bucketInterval - e.g. '1s', '2s', '5s', '10s'
   * @param {string} options.tagFilter - optional tag filter e.g. testid='run-1'
   */
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
      // Auto-locate the most recent test run in InfluxDB
      const latestRes = await this.queryInfluxQL('SELECT "value" FROM "http_reqs" ORDER BY time DESC LIMIT 1');
      const latestTs = latestRes?.results?.[0]?.series?.[0]?.values?.[0]?.[0];
      if (!latestTs) {
        throw new Error(`No points found in measurement "http_reqs" in database "${this.database}".`);
      }
      // Look back up to 2 hours before the latest point to capture the full test window
      const lookbackStart = latestTs - 2 * 3600 * 1000;
      timeClause = `time >= ${lookbackStart}ms AND time <= ${latestTs + 5000}ms`;
    }

    const extraTagClause = options.tagFilter?.trim() ? ` AND (${options.tagFilter.trim()})` : '';
    const whereClause = `WHERE ${timeClause}${extraTagClause}`;

    // Multi-statement InfluxQL query for standard k6 metrics
    const statements = [
      // Statement 0: Virtual Users (vus)
      `SELECT MAX("value") AS "vus" FROM "vus" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 1: Total HTTP Requests per bucket (http_reqs)
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 2: HTTP Request Duration p50, p95, p99 (http_req_duration)
      `SELECT PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MEAN("value") AS "mean" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 3: HTTP Request Failed rate (http_req_failed)
      `SELECT MEAN("value") AS "fail_rate", SUM("value") AS "fail_count" FROM "http_req_failed" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 4: Top endpoint names for highway labels
      `SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"`
    ];

    const rawResponse = await this.queryInfluxQL(statements.join('; '));
    return normalizeInfluxResponse(rawResponse, bucketSec);
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

/**
 * Normalizes a multi-statement InfluxDB 1.8 JSON response (or imported JSON)
 * into clean time-aligned frames for the Cyber-Fortress engine.
 */
export function normalizeInfluxResponse(rawResponse, bucketSec = 1) {
  const results = rawResponse?.results || [];
  const timeMap = new Map();

  const ensureBucket = (ts) => {
    if (!timeMap.has(ts)) {
      timeMap.set(ts, {
        timestamp: ts,
        vus: null,
        reqs: 0,
        p50: null,
        p95: null,
        p99: null,
        failRate: 0,
        failCount: 0
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

  // Statement 2: http_req_duration
  const durValues = results[2]?.series?.[0]?.values || [];
  for (const [ts, p50, p95, p99, mean] of durValues) {
    const b = ensureBucket(ts);
    b.p50 = p50 ?? mean ?? 0;
    b.p95 = p95 ?? mean ?? 0;
    b.p99 = p99 ?? b.p95 ?? 0;
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
  const endpoints = endpointValues.map((row) => row[1]).filter(Boolean).slice(0, 6);

  // Sort buckets chronologically and trim leading/trailing empty zero-activity buckets
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

  // Forward-fill VUs and latencies across any sparse buckets
  let lastVus = 1;
  let lastP50 = 40;
  let lastP95 = 65;
  let lastP99 = 95;
  const startTs = sorted[0].timestamp;

  const frames = sorted.map((b, idx) => {
    if (b.vus !== null && b.vus !== undefined) lastVus = b.vus;
    if (b.p50 !== null && b.p50 !== undefined) lastP50 = b.p50;
    if (b.p95 !== null && b.p95 !== undefined) lastP95 = b.p95;
    if (b.p99 !== null && b.p99 !== undefined) lastP99 = b.p99;

    const rps = Math.round(b.reqs / Math.max(0.1, bucketSec));
    const errorRatePct = Number((b.failRate * 100).toFixed(2));

    return {
      index: idx,
      timestamp: b.timestamp,
      elapsedSec: Math.round((b.timestamp - startTs) / 1000),
      vus: lastVus,
      rps,
      p50: Math.round(lastP50),
      p95: Math.round(lastP95),
      p99: Math.round(lastP99),
      errorRate: errorRatePct,
      failedReqs: Math.round(b.failCount / Math.max(0.1, bucketSec)),
      checksPassRate: Number(Math.max(0, 100 - errorRatePct).toFixed(1))
    };
  });

  return {
    frames,
    endpoints: endpoints.length > 0 ? endpoints : [
      'GATE-01 // INGRESS',
      'GATE-02 // AUTH',
      'GATE-03 // CORE-API',
      'GATE-04 // DB-POOL',
      'GATE-05 // CACHE',
      'GATE-06 // WORKER'
    ],
    bucketSec
  };
}
