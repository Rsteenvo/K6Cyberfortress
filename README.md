# ⚡ k6 Cyber-Fortress Cinema (InfluxDB 1.8 Visualizer & Movie Generator)

A deterministic **3D WebGL + Broadcast HUD** visualization and movie generator for **k6** performance tests stored in **InfluxDB 1.8** (or queried via Grafana's datasource proxy).

No AI is used at runtime — the visual engine maps your raw k6 InfluxDB time-series metrics directly into a 60fps 3D Cyber-Fortress simulation and records 1080p `.webm` movies.

---

## 🚀 Quick Start

```bash
git clone https://github.com/Rsteenvo/K6Cyberfortress.git
cd K6Cyberfortress
node server.js
```

Then open **`http://localhost:4173`** in Chrome, Edge, or Firefox.

---

## 🧠 How k6 Metrics Drive the 3D Cyber-Fortress

| k6 InfluxDB 1.8 Measurement | Query / Aggregation | Visual Effect in the Fortress |
| :--- | :--- | :--- |
| `vus` | `MAX("value")` | **Active Bot Swarm Population** streaming across the 6 radial cyber-highways. |
| `http_reqs` | `SUM("value") / bucket` | **Bot Velocity & Ingress Density** rushing through the 6 bastion gates. |
| `http_req_duration` | `PERCENTILE("value", 95)` (P95) | **Fortress Thermal Core State & Inner Queue Congestion**:<br>• **Cryo-Nominal (`<= 180ms`)**: Cool cyan core (`#00f0ff`), fast pass-through.<br>• **Elevated (`180ms–500ms`)**: Caution amber (`#ffaa00`), rising vent plumes.<br>• **Warning (`500ms–1100ms`)**: Molten orange-red (`#ff5500`), bots pile up orbiting inside the inner congestion ring (Little's Law).<br>• **Core Meltdown (`>= 1100ms`)**: Incandescent crimson (`#ff004c`), raging ember vortex, high-speed gimbal spin, camera micro-shake. |
| `http_req_failed` | `MEAN("value")`, `SUM("value")` | **Shield Breach Impacts**: Crimson rogue bots slam into the outer geodesic shield dome, triggering expanding red shockwaves. |
| `http_reqs` tag `name` | `SHOW TAG VALUES WITH KEY = "name"` | Automatically labels the **6 Fortress Gates** (`G01`–`G06`) in 3D space. |

---

## 🔌 Connecting to Your InfluxDB 1.8 or Grafana Instance

1. Click **⚡ Connect InfluxDB 1.8 / Grafana** in the top bar.
2. Enter your InfluxDB 1.8 URL (default `http://localhost:8086`, or a Grafana datasource proxy URL such as `http://localhost:3000/api/datasources/proxy/1`) and database name (default `k6`).
3. Click **🔍 Scan & Verify DB** to verify measurements and inspect the latest timestamp.
4. Select **Auto-Detect Latest Test Run** (or a Relative / Custom time window), adjust your **Cryo-Nominal** and **Core Meltdown** P95 latency SLA thresholds, and click **🚀 Load Test & Build Movie**.

---

## 🎬 Generating a Movie (`.webm`)

- Click **🎬 Generate Full Movie (.webm)** in the top bar to automatically rewind to `00:00`, play through the entire k6 test execution with the **Auto-Director** camera cycling between *Orbital Wide*, *Botnet Highway*, *Thermal Reactor Core*, and *Hex Radar* angles, and download a 1080p 60fps `.webm` movie with all 3D visuals and telemetry overlays baked in.
