/**
 * k6 Cyber-Fortress — InfluxDB 1.8 & Grafana Datasource Client
 * Queries both time-series telemetry for the 3D animation and combined per-request
 * response time metrics across all measurements:
 *   - vus (MAX("value"))
 *   - http_reqs (SUM("value"))
 *   - http_req_duration (MIN, MAX, MEAN/AVG, PERCENTILE 50, PERCENTILE 90, PERCENTILE 95, PERCENTILE 99, COUNT)
 *   - http_req_failed (MEAN("value"), SUM("value"))
 *   - Combined per-request metrics across all measurements (GROUP BY "name" and GROUP BY "group")
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

  async checkHealth() {
    const data = await this.queryInfluxQL('SHOW MEASUREMENTS LIMIT 1');
    const firstResult = data?.results?.[0];
    if (!firstResult || firstResult.error) {
      throw new Error(firstResult?.error || 'Invalid InfluxDB response');
    }
    return {
      ok: true,
      url: this.url,
      database: this.database
    };
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

  async discoverVariableTags({ sut = 'All', testEnvironment = 'All' } = {}) {
    const resolveTagKeyAndValues = async (candidateKeys, whereConditions = []) => {
      const whereStr = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(' AND ')}` : '';
      const measurements = ['http_req_duration', 'http_reqs'];
      for (const measurement of measurements) {
        for (const key of candidateKeys) {
          try {
            const q = `SHOW TAG VALUES FROM "${measurement}" WITH KEY = "${key}"${whereStr}`;
            const res = await this.queryInfluxQL(q);
            const vals = (res?.results?.[0]?.series?.[0]?.values || [])
              .map((row) => row[1])
              .filter(Boolean);
            if (vals.length > 0) {
              return { key, values: Array.from(new Set(vals)) };
            }
          } catch (_) {}
        }
      }
      return { key: candidateKeys[0], values: [] };
    };

    const sutResult = await resolveTagKeyAndValues(['systemUnderTest', 'system_under_test', 'sut', 'system']);
    const envConditions = [];
    if (sut && sut !== 'All') {
      envConditions.push(`"${sutResult.key}" =~ /^${escapeInfluxRegex(sut)}$/`);
    }

    const envResult = await resolveTagKeyAndValues(
      ['testEnvironment', 'test_environment', 'environment', 'env'],
      envConditions
    );

    const runIdConditions = [...envConditions];
    if (testEnvironment && testEnvironment !== 'All') {
      runIdConditions.push(`"${envResult.key}" =~ /^${escapeInfluxRegex(testEnvironment)}$/`);
    }

    const runIdResult = await resolveTagKeyAndValues(
      ['testRunId', 'testid', 'test_run_id', 'run_id'],
      runIdConditions
    );

    return {
      sutKey: sutResult.key,
      sutValues: sutResult.values,
      envKey: envResult.key,
      envValues: envResult.values,
      runIdKey: runIdResult.key,
      runIdValues: runIdResult.values
    };
  }

  async detectLoadAgents(whereClause = '') {
    const candidateKeys = this.runnerTagKey && this.runnerTagKey !== 'auto'
      ? [this.runnerTagKey]
      : ['instance_id', 'runner', 'load_zone', 'pod', 'scenario', 'name'];

    for (const key of candidateKeys) {
      try {
        const q = `SHOW TAG VALUES FROM "http_req_duration" WITH KEY = "${key}" ${whereClause}`;
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
      // Statement 0: Virtual Users (vus) over time
      `SELECT MAX("value") AS "vus" FROM "vus" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 1: Total HTTP Requests per bucket (http_reqs)
      `SELECT SUM("value") AS "reqs" FROM "http_reqs" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 2: Overall HTTP Request Duration stats over time (min, mean, p50, p90, p95, p99, max)
      `SELECT PERCENTILE("value", 50) AS "p50", PERCENTILE("value", 95) AS "p95", PERCENTILE("value", 99) AS "p99", MEAN("value") AS "mean", MIN("value") AS "min", MAX("value") AS "max", PERCENTILE("value", 90) AS "p90" FROM "http_req_duration" ${whereClause} GROUP BY time(${bucket}) fill(none)`,
      // Statement 3: HTTP Request Failed rate over time
      `SELECT MEAN("value") AS "fail_rate", SUM("value") AS "fail_count" FROM "http_req_failed" ${whereClause} GROUP BY time(${bucket}) fill(0)`,
      // Statement 4: Endpoint tag names
      `SHOW TAG VALUES FROM "http_req_duration" WITH KEY = "name"`,
      // Statement 5: Exact Grafana Response Time Table query (combined per request across all measurements, GROUP BY "name")
      `SELECT MEAN("value") as Mean, PERCENTILE("value", 90) AS "P90", PERCENTILE("value", 95) AS "P95", PERCENTILE("value", 99) AS "P99", MIN("value") AS "Min", MAX("value") AS "Max", COUNT("value") AS "Count" FROM "http_req_duration" ${whereClause} GROUP BY "name"`,
      // Statement 6: Combined per-group fallback (GROUP BY "group")
      `SELECT MEAN("value") as Mean, PERCENTILE("value", 90) AS "P90", PERCENTILE("value", 95) AS "P95", PERCENTILE("value", 99) AS "P99", MIN("value") AS "Min", MAX("value") AS "Max", COUNT("value") AS "Count" FROM "http_req_duration" ${whereClause} GROUP BY "group"`
    ];
  }

  async fetchTestExecution(options = {}) {
    const bucket = options.bucketInterval || '2s';
    const bucketSec = parseBucketToSeconds(bucket);
    const cleanTagFilter = options.tagFilter?.trim() || '';
    const extraTagClause = cleanTagFilter ? ` AND (${cleanTagFilter})` : '';

    let timeClause = '';
    if (options.timeFilterMode === 'custom' && options.startTimeISO && options.endTimeISO) {
      const startMs = new Date(options.startTimeISO).getTime();
      const endMs = new Date(options.endTimeISO).getTime();
      timeClause = `time >= ${startMs}ms AND time <= ${endMs}ms`;
    } else if (options.timeFilterMode === 'relative' && options.relativeWindow) {
      timeClause = `time >= now() - ${options.relativeWindow}`;
    } else {
      const tagWhere = cleanTagFilter ? `WHERE (${cleanTagFilter})` : '';
      const boundsRes = await this.queryInfluxQL(
        `SELECT "value" FROM "http_req_duration" ${tagWhere} ORDER BY time DESC LIMIT 1; SELECT "value" FROM "http_req_duration" ${tagWhere} ORDER BY time ASC LIMIT 1`
      );
      const latestTs = boundsRes?.results?.[0]?.series?.[0]?.values?.[0]?.[0];
      const earliestTs = boundsRes?.results?.[1]?.series?.[0]?.values?.[0]?.[0];
      if (!latestTs) {
        throw new Error(`No points found in measurement "http_req_duration" in database "${this.database}"${cleanTagFilter ? ` matching filter (${cleanTagFilter})` : ''}.`);
      }
      const defaultLookback = latestTs - 2 * 3600 * 1000;
      const lookbackStart = cleanTagFilter && earliestTs
        ? Math.max(earliestTs - 5000, latestTs - 12 * 3600 * 1000)
        : defaultLookback;
      timeClause = `time >= ${lookbackStart}ms AND time <= ${latestTs + 5000}ms`;
    }

    const whereClause = `WHERE (${timeClause})${extraTagClause}`;

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
    const whereClause = `WHERE (time >= now() - ${windowStr})${extraTagClause}`;

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

export function escapeInfluxRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
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
 * Extracts a clean request/metric name and optional leading step number (e.g., "01_openhomepage" -> { step: "01", metric: "openhomepage" }).
 */
export function parseRequestMetricName(rawName, fallbackIndex = 1) {
  const cleaned = String(rawName || '')
    .replace(/^:+/, '')
    .trim();
  const match = cleaned.match(/^(\d{1,3})[\s_\-:]+(.+)$/);
  if (match) {
    return {
      step: match[1].padStart(2, '0'),
      metric: match[2].trim()
    };
  }
  return {
    step: String(fallbackIndex).padStart(2, '0'),
    metric: cleaned || `request_${fallbackIndex}`
  };
}

/**
 * Combines series rows per request name so that each request (e.g., "openhomepage")
 * appears once with all measurements aggregated into { min, max, avg, p90, p95, p99, count }.
 */
function buildCombinedRequestsFromSeries(seriesList = [], tagKey = 'name') {
  const combinedMap = new Map();

  for (const serie of seriesList) {
    const rawTagVal = (serie.tags?.[tagKey] || '').replace(/^:+/, '').trim();
    if (!rawTagVal) continue;

    const cols = (serie.columns || []).map((c) => String(c).toLowerCase());
    const idxMin = cols.indexOf('min');
    const idxMax = cols.indexOf('max');
    const idxAvg = cols.indexOf('mean') !== -1 ? cols.indexOf('mean') : cols.indexOf('avg');
    const idxP90 = cols.indexOf('p90');
    const idxP95 = cols.indexOf('p95');
    const idxP99 = cols.indexOf('p99');
    const idxCount = cols.indexOf('count');

    for (const row of serie.values || []) {
      const minVal = idxMin !== -1 ? Number(row[idxMin]) : null;
      const maxVal = idxMax !== -1 ? Number(row[idxMax]) : null;
      const avgVal = idxAvg !== -1 ? Number(row[idxAvg]) : null;
      const p90Val = idxP90 !== -1 ? Number(row[idxP90]) : null;
      const p95Val = idxP95 !== -1 ? Number(row[idxP95]) : null;
      const p99Val = idxP99 !== -1 ? Number(row[idxP99]) : null;
      const countVal = idxCount !== -1 ? Number(row[idxCount]) : 1;

      if (avgVal === null && p95Val === null && minVal === null) continue;
      const c = Math.max(1, countVal || 1);

      if (!combinedMap.has(rawTagVal)) {
        combinedMap.set(rawTagVal, {
          rawName: rawTagVal,
          min: minVal ?? avgVal ?? 0,
          max: maxVal ?? p99Val ?? p95Val ?? avgVal ?? 0,
          weightedAvgSum: (avgVal ?? p95Val ?? 0) * c,
          p90Max: p90Val ?? p95Val ?? avgVal ?? 0,
          p95Max: p95Val ?? avgVal ?? 0,
          p99Max: p99Val ?? p95Val ?? avgVal ?? 0,
          count: idxCount !== -1 ? Number(row[idxCount] || 0) : 1
        });
      } else {
        const entry = combinedMap.get(rawTagVal);
        if (minVal !== null && !Number.isNaN(minVal)) {
          entry.min = Math.min(entry.min, minVal);
        }
        if (maxVal !== null && !Number.isNaN(maxVal)) {
          entry.max = Math.max(entry.max, maxVal);
        }
        if (avgVal !== null && !Number.isNaN(avgVal)) {
          entry.weightedAvgSum += avgVal * c;
        }
        if (p90Val !== null && !Number.isNaN(p90Val)) {
          entry.p90Max = Math.max(entry.p90Max, p90Val);
        }
        if (p95Val !== null && !Number.isNaN(p95Val)) {
          entry.p95Max = Math.max(entry.p95Max, p95Val);
        }
        if (p99Val !== null && !Number.isNaN(p99Val)) {
          entry.p99Max = Math.max(entry.p99Max, p99Val);
        }
        entry.count += idxCount !== -1 ? Number(row[idxCount] || 0) : 1;
      }
    }
  }

  const sortedEntries = Array.from(combinedMap.values()).sort((a, b) =>
    a.rawName.localeCompare(b.rawName, undefined, { numeric: true, sensitivity: 'base' })
  );

  return sortedEntries.map((item, idx) => {
    const { step, metric } = parseRequestMetricName(item.rawName, idx + 1);
    const totalCount = Math.max(1, Math.round(item.count));
    const avg = Math.round(item.weightedAvgSum / totalCount);
    const min = Math.round(item.min);
    const p90 = Math.round(item.p90Max);
    const p95 = Math.round(item.p95Max);
    const p99 = Math.round(Math.max(p95, item.p99Max));
    const max = Math.round(Math.max(p99, item.max));

    return {
      step,
      name: metric,
      rawName: item.rawName,
      min,
      max,
      avg,
      p90,
      p95,
      p99,
      count: totalCount
    };
  });
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

  // Statement 5 & 6: Combined per-request stats across all measurements (by "name" or by "group")
  const byNameSeries = results[5]?.series || [];
  const byGroupSeries = results[6]?.series || [];

  let combinedRequests = buildCombinedRequestsFromSeries(byNameSeries, 'name');
  const combinedGroups = buildCombinedRequestsFromSeries(byGroupSeries, 'group');

  // If the test defined named k6 groups (e.g. "01 openhomepage") and "name" was empty or raw URLs,
  // or if "name" had no tags, use the combined groups
  if (combinedGroups.length > 0 && combinedRequests.length === 0) {
    combinedRequests = combinedGroups;
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
      checksPassRate: Number(Math.max(0, 100 - errorRatePct).toFixed(1))
    };
  });

  // Fallback if imported JSON had no Statement 5/6 series: aggregate across frames into 1 combined row per endpoint
  if (combinedRequests.length === 0 && frames.length > 0) {
    const totalCount = sorted.reduce((acc, b) => acc + Math.round(b.reqs || 0), 0) || frames.length;
    const minAll = Math.min(...frames.map((f) => f.min || f.p50 || 0));
    const maxAll = Math.max(...frames.map((f) => f.max || f.p99 || 0));
    const avgAll = Math.round(frames.reduce((acc, f) => acc + (f.mean || f.p50 || 0), 0) / frames.length);
    const p95All = Math.max(...frames.map((f) => f.p95 || 0));
    const p99All = Math.max(...frames.map((f) => f.p99 || 0));

    const epList = endpoints.length > 0 ? endpoints : ['http_req_duration'];
    combinedRequests = epList.map((ep, idx) => {
      const { step, metric } = parseRequestMetricName(ep, idx + 1);
      return {
        step,
        name: metric,
        rawName: ep,
        min: minAll,
        max: maxAll,
        avg: avgAll,
        p95: p95All,
        p99: p99All,
        count: Math.max(1, Math.round(totalCount / epList.length))
      };
    });
  }

  return {
    frames,
    endpoints: combinedRequests.map((r) => r.name),
    combinedRequests,
    bucketSec
  };
}
