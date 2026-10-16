/**
 * k6 Cyber-Fortress — InfluxDB 1.8 & Grafana Datasource Client
 * Supports:
 *   1. Historical Test Execution loading
 *   2. Real-time LIVE VIEW polling (on-the-fly rendering of an active k6 run)
 *   3. Dynamic detection of active Load Agents / Runners from InfluxDB tags
 *      (instance_id, runner, load_zone, scenario, name)
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

  /**
   * Discovers measurements, latest timestamps, endpoints, and active Load Agent / Runner tags.
   */
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

  /**
   * Resolves the list of distinct Load Agents / Runners from InfluxDB tag values.
   */
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
      } catch (_) {
        // try next candidate tag key
      }
    }

    return {
      tagKey: 'default',
      agents: ['RUNNER-01']
    };
  }

  /**
   * Fetches a k6 test execution from InfluxDB 1.8 and normalizes it into animation frames.
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

    const statements = [
      `SELECT MAX("value") AS "vus" FROM "vus" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      `SELECT PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MEAN("value") AS "mean" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      `SELECT MEAN("value") AS "fail_rate", SUM("value") AS "fail_count" FROM "http_req_failed" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      `SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"`
    ];

    const [rawResponse, detectedRunners] = await Promise.all([
      this.queryInfluxQL(statements.join('; ')),
      this.detectLoadAgents()
    ]);

    const normalized = normalizeInfluxResponse(rawResponse, bucketSec);
    normalized.detectedAgents = detectedRunners.agents;
    normalized.runnerTagKey = detectedRunners.tagKey;
    return normalized;
  }

  /**
   * Fetches the rolling live telemetry window for LIVE VIEW mode (`time >= now() - window`).
   */
  async fetchLiveTelemetry(options = {}) {
    const windowStr = options.liveWindow || '3m';
    const bucket = options.bucketInterval || '1s';
    const bucketSec = parseBucketToSeconds(bucket);
    const extraTagClause = options.tagFilter?.trim() ? ` AND (${options.tagFilter.trim()})` : '';
    const whereClause = `WHERE time >= now() - ${windowStr}${extraTagClause}`;

    const statements = [
      `SELECT MAX("value") AS "vus" FROM "vus" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      `SELECT PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MEAN("value") AS "mean" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      `SELECT MEAN("value") AS "fail_rate", SUM("value") AS "fail_count" FROM "http_req_failed" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      `SHOW TAG VALUES FROM "http_reqs" WITH KEY = "name"`
    ];

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
        p50: null,
        p95: null,
        p99: null,
        failRate: 0,
        failCount: 0
      });
    }
    return timeMap.get(ts);
  };

  const vusValues = results[0]?.series?.[0]?.values || [];
  for (const [ts, vus] of vusValues) {
    if (vus !== null && vus !== undefined) {
      ensureBucket(ts).vus = Math.round(Number(vus));
    }
  }

  const reqValues = results[1]?.series?.[0]?.values || [];
  for (const [ts, reqs] of reqValues) {
    if (reqs !== null && reqs !== undefined) {
      ensureBucket(ts).reqs = Number(reqs);
    }
  }

  const durValues = results[2]?.series?.[0]?.values || [];
  for (const [ts, p50, p95, p99, mean] of durValues) {
    const b = ensureBucket(ts);
    b.p50 = p50 ?? mean ?? 0;
    b.p95 = p95 ?? mean ?? 0;
    b.p99 = p99 ?? b.p95 ?? 0;
  }

  const failValues = results[3]?.series?.[0]?.values || [];
  for (const [ts, failRate, failCount] of failValues) {
    const b = ensureBucket(ts);
    b.failRate = Number(failRate || 0);
    b.failCount = Number(failCount || 0);
  }

  const endpointValues = results[4]?.series?.[0]?.values || [];
  const endpoints = endpointValues.map((row) => row[1]).filter(Boolean).slice(0, 16);

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
      '/api/v2/auth/token',
      '/api/v2/checkout/submit',
      '/api/v2/catalog/search',
      '/api/v2/inventory/reserve',
      '/api/v2/payments/authorize',
      '/api/v2/profile/session'
    ],
    bucketSec
  };
}
