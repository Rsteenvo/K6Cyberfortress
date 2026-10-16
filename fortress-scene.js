/**
 * k6 Cyber-Fortress — 3D WebGL Scene + Broadcast HUD Compositor
 * Features:
 *  - Central SUT (System Under Test) Cyber-Fortress with thermal core & congestion queue ring
 *  - 6 Outer 3D "Load Agent" Generator Nodes spawning bot traffic down 6 radial highways
 *  - Dedicated multi-series K6 Response Times (P50 / P95 / P99) & HTTP Errors dual-axis graph
 *  - End-of-Test Executive Summary Report rendered directly onto the broadcast/movie canvas
 */

import * as THREE from 'https://esm.sh/three@0.169.0';
import { computeThermalState } from './demo-data.js';

const MAX_HIGHWAY_BOTS = 1100;
const MAX_QUEUE_BOTS = 650;
const MAX_THERMAL_PARTICLES = 550;
const NUM_HIGHWAYS = 6;
const LOAD_AGENT_RADIUS = 82;

export class CyberFortressDirector {
  constructor(masterCanvas, options = {}) {
    this.masterCanvas = masterCanvas;
    this.ctx = masterCanvas.getContext('2d');
    this.width = 1920;
    this.height = 1080;
    this.masterCanvas.width = this.width;
    this.masterCanvas.height = this.height;

    this.thresholds = options.thresholds || {
      nominalMs: 180,
      warningMs: 500,
      criticalMs: 1100
    };

    this.cameraMode = 'auto'; // 'auto' | 'orbit' | 'highway' | 'agents' | 'core' | 'top'
    this.showHudInCanvas = true;
    this.showSummaryOverlay = false;
    this.sutName = 'SUT // CORE-API-CLUSTER';
    this.testTitle = 'OPERATION CITADEL SIEGE';
    this.sourceLabel = 'INFLUXDB 1.8 // K6 TELEMETRY';
    this.endpoints = [
      '/api/v2/auth/token',
      '/api/v2/checkout/submit',
      '/api/v2/catalog/search',
      '/api/v2/inventory/reserve',
      '/api/v2/payments/authorize',
      '/api/v2/profile/session'
    ];

    // Live interpolated state
    this.currentFrame = {
      index: 0,
      elapsedSec: 0,
      vus: 100,
      rps: 350,
      p50: 40,
      p95: 65,
      p99: 110,
      errorRate: 0,
      failedReqs: 0,
      checksPassRate: 100
    };
    this.allFrames = [this.currentFrame];
    this.summaryStats = null;
    this.thermal = computeThermalState(this.currentFrame, this.thresholds);
    this.smoothedHeat = 0;
    this.smoothedRps = 350;
    this.smoothedVus = 100;
    this.smoothedP95 = 65;

    // User pointer orbit offsets
    this.userAzimuthOffset = 0;
    this.userElevationOffset = 0;
    this.userZoom = 1.0;

    this.clockTime = 0;
    this.shockwaves = [];

    this._initThreeScene();
    this._buildFortressGeometry();
    this._buildLoadAgentStations();
    this._initBotSwarms();
    this._initThermalParticles();
    this._bindPointerControls();
  }

  _initThreeScene() {
    this.webglCanvas = document.createElement('canvas');
    this.webglCanvas.width = this.width;
    this.webglCanvas.height = this.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.webglCanvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04070f);
    this.scene.fog = new THREE.FogExp2(0x04070f, 0.0068);

    this.camera = new THREE.PerspectiveCamera(48, this.width / this.height, 0.5, 340);
    this.camera.position.set(0, 34, 58);
    this.cameraTarget = new THREE.Vector3(0, 4, 0);

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x122438, 1.85);
    this.scene.add(this.ambientLight);

    this.coreLight = new THREE.PointLight(0x00f0ff, 6, 95, 1.4);
    this.coreLight.position.set(0, 10, 0);
    this.scene.add(this.coreLight);

    this.rimLight1 = new THREE.DirectionalLight(0x2266ff, 1.45);
    this.rimLight1.position.set(40, 60, 30);
    this.scene.add(this.rimLight1);

    this.rimLight2 = new THREE.DirectionalLight(0x00e5ff, 1.05);
    this.rimLight2.position.set(-45, 35, -40);
    this.scene.add(this.rimLight2);
  }

  _buildFortressGeometry() {
    this.fortressGroup = new THREE.Group();
    this.scene.add(this.fortressGroup);

    // 1. Cyber Floor Grid & Concentric Radar Rings
    const gridHelper = new THREE.GridHelper(240, 96, 0x0d3b5c, 0x071a2c);
    gridHelper.position.y = -0.1;
    this.scene.add(gridHelper);

    this.radarRings = [];
    const ringRadii = [10, 17, 26, 42, 62, 82];
    ringRadii.forEach((r, idx) => {
      const geo = new THREE.RingGeometry(r - 0.16, r + 0.16, 64);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: idx < 2 ? 0x00f0ff : 0x0d4a6e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: idx < 2 ? 0.65 : 0.35
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.04;
      this.fortressGroup.add(mesh);
      this.radarRings.push(mesh);
    });

    // 2. Central SUT Reactor Pedestal & Stepped Hexagonal Citadel Base
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0c1626,
      metalness: 0.82,
      roughness: 0.25,
      emissive: 0x002438,
      emissiveIntensity: 0.5
    });
    this.citadelBaseMat = baseMat;
    this.thermalEdgeMaterials = [];

    for (let tier = 0; tier < 3; tier++) {
      const radius = 9.5 - tier * 2.2;
      const height = 1.6 + tier * 0.4;
      const cylGeo = new THREE.CylinderGeometry(radius * 0.92, radius, height, 6);
      const cylMesh = new THREE.Mesh(cylGeo, baseMat);
      cylMesh.position.y = tier * 1.5 + height / 2;
      this.fortressGroup.add(cylMesh);

      const edges = new THREE.EdgesGeometry(cylGeo);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.75
      });
      const wireframe = new THREE.LineSegments(edges, lineMat);
      cylMesh.add(wireframe);
      this.thermalEdgeMaterials.push(lineMat);
    }

    // 3. The SUT Reactor Core (Inner Geodesic Crystal + 3 Gimbal Containment Rings + Plasma Column)
    const coreGeo = new THREE.IcosahedronGeometry(3.4, 2);
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d8ff,
      emissiveIntensity: 2.2,
      metalness: 0.2,
      roughness: 0.1
    });
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.coreMesh.position.y = 9.2;
    this.fortressGroup.add(this.coreMesh);

    const coreShellGeo = new THREE.IcosahedronGeometry(4.15, 1);
    this.coreShellMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.7
    });
    this.coreShellMesh = new THREE.Mesh(coreShellGeo, this.coreShellMat);
    this.coreMesh.add(this.coreShellMesh);

    this.gimbalRings = [];
    for (let i = 0; i < 3; i++) {
      const torusGeo = new THREE.TorusGeometry(5.2 + i * 1.15, 0.14, 12, 64);
      const torusMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85
      });
      const ring = new THREE.Mesh(torusGeo, torusMat);
      ring.position.y = 9.2;
      this.fortressGroup.add(ring);
      this.gimbalRings.push(ring);
      this.thermalEdgeMaterials.push(torusMat);
    }

    // Vertical Plasma Spire Beam
    const beamGeo = new THREE.CylinderGeometry(0.45, 1.6, 46, 16, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.plasmaBeam = new THREE.Mesh(beamGeo, this.beamMat);
    this.plasmaBeam.position.y = 26;
    this.fortressGroup.add(this.plasmaBeam);

    // 4. Outer Bastion Wall Segments & 6 Highway Gate Pylons
    this.bastionPylons = [];
    this.gateWorldPositions = [];

    for (let i = 0; i < NUM_HIGHWAYS; i++) {
      const angle = (i * Math.PI * 2) / NUM_HIGHWAYS;
      const gateRadius = 18;
      const gx = Math.cos(angle) * gateRadius;
      const gz = Math.sin(angle) * gateRadius;
      this.gateWorldPositions.push(new THREE.Vector3(gx, 2.0, gz));

      const gateGroup = new THREE.Group();
      gateGroup.position.set(gx, 0, gz);
      gateGroup.rotation.y = -angle + Math.PI / 2;

      const towerGeo = new THREE.BoxGeometry(2.1, 9.5, 2.1);
      const towerEdges = new THREE.EdgesGeometry(towerGeo);

      [-3.4, 3.4].forEach((offsetX) => {
        const tower = new THREE.Mesh(towerGeo, baseMat);
        tower.position.set(offsetX, 4.75, 0);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.8 });
        tower.add(new THREE.LineSegments(towerEdges, edgeMat));
        this.thermalEdgeMaterials.push(edgeMat);

        const capGeo = new THREE.BoxGeometry(1.5, 0.8, 1.5);
        const capMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(0, 5.1, 0);
        tower.add(cap);
        this.bastionPylons.push(capMat);

        gateGroup.add(tower);
      });

      const archGeo = new THREE.BoxGeometry(8.8, 0.9, 1.4);
      const arch = new THREE.Mesh(archGeo, baseMat);
      arch.position.set(0, 9.2, 0);
      gateGroup.add(arch);

      this.fortressGroup.add(gateGroup);

      // 5. Radial Cyber-Highway Lanes (from r=18 out to LOAD_AGENT_RADIUS=82)
      const laneLen = LOAD_AGENT_RADIUS - gateRadius;
      const laneGeo = new THREE.PlaneGeometry(4.6, laneLen);
      laneGeo.rotateX(-Math.PI / 2);
      const laneMat = new THREE.MeshBasicMaterial({
        color: 0x062338,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72
      });
      const laneMesh = new THREE.Mesh(laneGeo, laneMat);
      const midR = gateRadius + laneLen / 2;
      laneMesh.position.set(Math.cos(angle) * midR, 0.03, Math.sin(angle) * midR);
      laneMesh.rotation.y = -angle + Math.PI / 2;
      this.fortressGroup.add(laneMesh);

      const railGeo = new THREE.PlaneGeometry(0.22, laneLen);
      railGeo.rotateX(-Math.PI / 2);
      const railMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      this.thermalEdgeMaterials.push(railMat);

      [-2.35, 2.35].forEach((railOffset) => {
        const rail = new THREE.Mesh(railGeo, railMat);
        const perpAngle = angle + Math.PI / 2;
        rail.position.set(
          Math.cos(angle) * midR + Math.cos(perpAngle) * railOffset,
          0.06,
          Math.sin(angle) * midR + Math.sin(perpAngle) * railOffset
        );
        rail.rotation.y = -angle + Math.PI / 2;
        this.fortressGroup.add(rail);
      });
    }

    // 6. Inner Hexagonal Bastion Defensive Walls (at r=17.8 between gates)
    for (let i = 0; i < NUM_HIGHWAYS; i++) {
      const a1 = (i * Math.PI * 2) / NUM_HIGHWAYS + 0.22;
      const a2 = ((i + 1) * Math.PI * 2) / NUM_HIGHWAYS - 0.22;
      const midA = (a1 + a2) / 2;
      const wallR = 17.8;
      const wallGeo = new THREE.BoxGeometry(10.5, 4.2, 1.1);
      const wall = new THREE.Mesh(wallGeo, baseMat);
      wall.position.set(Math.cos(midA) * wallR, 2.1, Math.sin(midA) * wallR);
      wall.rotation.y = -midA + Math.PI / 2;
      const wallEdges = new THREE.EdgesGeometry(wallGeo);
      const wallEdgeMat = new THREE.LineBasicMaterial({ color: 0x00b8ff, transparent: true, opacity: 0.55 });
      wall.add(new THREE.LineSegments(wallEdges, wallEdgeMat));
      this.thermalEdgeMaterials.push(wallEdgeMat);
      this.fortressGroup.add(wall);
    }

    // 7. Outer Energy Shield Dome (Geodesic Wireframe Hemisphere around SUT)
    const domeGeo = new THREE.IcosahedronGeometry(20.5, 2);
    this.shieldDomeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.shieldDome = new THREE.Mesh(domeGeo, this.shieldDomeMat);
    this.shieldDome.position.y = 1.0;
    this.fortressGroup.add(this.shieldDome);
  }

  /**
   * Builds 6 3D "Load Agent" Generator Stations at the origin of each input stream (r = 82).
   * Each Load Agent has a cyber platform, spinning injector ring, and glowing plasma core
   * that visually spawns the bot swarms rushing toward the SUT!
   */
  _buildLoadAgentStations() {
    this.loadAgentWorldPositions = [];
    this.loadAgentRings = [];
    this.loadAgentCores = [];

    const agentBaseMat = new THREE.MeshStandardMaterial({
      color: 0x081c34,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0x003355,
      emissiveIntensity: 0.65
    });

    for (let i = 0; i < NUM_HIGHWAYS; i++) {
      const angle = (i * Math.PI * 2) / NUM_HIGHWAYS;
      const ax = Math.cos(angle) * LOAD_AGENT_RADIUS;
      const az = Math.sin(angle) * LOAD_AGENT_RADIUS;

      this.loadAgentWorldPositions.push(new THREE.Vector3(ax, 12.5, az));

      const agentGroup = new THREE.Group();
      agentGroup.position.set(ax, 0, az);
      agentGroup.rotation.y = -angle + Math.PI / 2;

      // Hexagonal Emitter Pedestal
      const padGeo = new THREE.CylinderGeometry(5.2, 6.2, 2.2, 6);
      const padMesh = new THREE.Mesh(padGeo, agentBaseMat);
      padMesh.position.y = 1.1;
      const padEdges = new THREE.EdgesGeometry(padGeo);
      padMesh.add(new THREE.LineSegments(padEdges, new THREE.LineBasicMaterial({ color: 0x00f0ff })));
      agentGroup.add(padMesh);

      // Vertical Load Agent Pylon Spire
      const pylonGeo = new THREE.CylinderGeometry(1.4, 2.6, 8.5, 6);
      const pylonMesh = new THREE.Mesh(pylonGeo, agentBaseMat);
      pylonMesh.position.y = 5.5;
      const pylonEdges = new THREE.EdgesGeometry(pylonGeo);
      pylonMesh.add(new THREE.LineSegments(pylonEdges, new THREE.LineBasicMaterial({ color: 0x38bdf8 })));
      agentGroup.add(pylonMesh);

      // Glowing Bot-Spawner Core Sphere
      const orbGeo = new THREE.OctahedronGeometry(2.1, 1);
      const orbMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true
      });
      const orbMesh = new THREE.Mesh(orbGeo, orbMat);
      orbMesh.position.set(0, 7.2, 0);
      agentGroup.add(orbMesh);
      this.loadAgentCores.push(orbMesh);

      // Directional Accelerator Portal Ring aimed down the highway toward the SUT
      const portalGeo = new THREE.TorusGeometry(3.4, 0.22, 10, 32);
      const portalMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff
      });
      const portalRing = new THREE.Mesh(portalGeo, portalMat);
      portalRing.position.set(0, 4.2, -3.5);
      agentGroup.add(portalRing);
      this.loadAgentRings.push(portalRing);

      this.fortressGroup.add(agentGroup);
    }
  }

  _initBotSwarms() {
    const botGeo = new THREE.OctahedronGeometry(0.55, 0);
    botGeo.scale(0.85, 0.65, 2.4);

    this.highwayBotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending
    });

    this.highwayBotMesh = new THREE.InstancedMesh(botGeo, this.highwayBotMat, MAX_HIGHWAY_BOTS);
    this.highwayBotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.highwayBotMesh);

    this.highwayBots = [];
    const dummyColor = new THREE.Color();
    for (let i = 0; i < MAX_HIGHWAY_BOTS; i++) {
      const lane = i % NUM_HIGHWAYS;
      this.highwayBots.push({
        lane,
        distance: 18 + Math.random() * (LOAD_AGENT_RADIUS - 18),
        laneOffset: (Math.random() - 0.5) * 3.5,
        altitude: 0.6 + Math.random() * 1.8,
        speedFactor: 0.75 + Math.random() * 0.55,
        isErrorBot: false
      });
      dummyColor.setHex(0x00f0ff);
      this.highwayBotMesh.setColorAt(i, dummyColor);
    }

    // Inner Congestion Queue Bot InstancedMesh (bots orbiting inside the SUT while waiting for response time!)
    const queueGeo = new THREE.OctahedronGeometry(0.48, 0);
    queueGeo.scale(0.9, 0.9, 1.8);
    this.queueBotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending
    });
    this.queueBotMesh = new THREE.InstancedMesh(queueGeo, this.queueBotMat, MAX_QUEUE_BOTS);
    this.queueBotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.queueBotMesh);

    this.queueBots = [];
    for (let i = 0; i < MAX_QUEUE_BOTS; i++) {
      this.queueBots.push({
        angle: Math.random() * Math.PI * 2,
        radius: 8.2 + Math.random() * 8.4,
        altitude: 1.4 + Math.random() * 9.5,
        orbitSpeed: (0.6 + Math.random() * 0.9) * (i % 2 === 0 ? 1 : -1),
        verticalPhase: Math.random() * Math.PI * 2
      });
      dummyColor.setHex(0x00f0ff);
      this.queueBotMesh.setColorAt(i, dummyColor);
    }
  }

  _initThermalParticles() {
    const particleGeo = new THREE.DodecahedronGeometry(0.24, 0);
    this.thermalParticleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending
    });
    this.thermalParticleMesh = new THREE.InstancedMesh(
      particleGeo,
      this.thermalParticleMat,
      MAX_THERMAL_PARTICLES
    );
    this.thermalParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.thermalParticleMesh);

    this.thermalParticles = [];
    const c = new THREE.Color(0x00f0ff);
    for (let i = 0; i < MAX_THERMAL_PARTICLES; i++) {
      const r = 1.5 + Math.random() * 14.5;
      const theta = Math.random() * Math.PI * 2;
      this.thermalParticles.push({
        r,
        theta,
        y: Math.random() * 34,
        speedY: 3.5 + Math.random() * 8.0,
        swirl: (Math.random() - 0.5) * 1.8
      });
      this.thermalParticleMesh.setColorAt(i, c);
    }
  }

  _bindPointerControls() {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    this.masterCanvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.masterCanvas.setPointerCapture(e.pointerId);
    });

    this.masterCanvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.userAzimuthOffset -= dx * 0.0065;
      this.userElevationOffset = Math.max(-0.45, Math.min(0.65, this.userElevationOffset + dy * 0.004));
    });

    this.masterCanvas.addEventListener('pointerup', (e) => {
      isDragging = false;
      try {
        this.masterCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    });

    this.masterCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userZoom = Math.max(0.55, Math.min(1.65, this.userZoom + e.deltaY * 0.0008));
    }, { passive: false });
  }

  setDataset(frames, metadata = {}) {
    this.allFrames = frames && frames.length ? frames : [this.currentFrame];
    if (metadata.title) this.testTitle = metadata.title.toUpperCase();
    if (metadata.sourceLabel) this.sourceLabel = metadata.sourceLabel.toUpperCase();
    if (metadata.sutName) this.sutName = metadata.sutName.toUpperCase();
    if (metadata.endpoints && metadata.endpoints.length) {
      this.endpoints = metadata.endpoints.slice(0, 6);
    }
    this.showSummaryOverlay = false;
    this.summaryStats = this._computeSummaryStats();
    this.setFrameData(this.allFrames[0]);
  }

  setThresholds(thresholds) {
    this.thresholds = { ...this.thresholds, ...thresholds };
    this.thermal = computeThermalState(this.currentFrame, this.thresholds);
    this.summaryStats = this._computeSummaryStats();
  }

  setFrameData(frame) {
    if (!frame) return;
    this.currentFrame = frame;
    this.thermal = computeThermalState(frame, this.thresholds);
  }

  /**
   * Computes comprehensive end-of-test aggregate statistics across all frames & Load Agents.
   */
  _computeSummaryStats() {
    const frames = this.allFrames || [];
    if (!frames.length) return null;

    let totalReqs = 0;
    let totalFailed = 0;
    let maxVus = 0;
    let peakRps = 0;
    let sumRps = 0;
    let sumP50 = 0;
    let sumP95 = 0;
    let peakP95 = 0;
    let peakP99 = 0;
    let peakErrorRate = 0;
    let maxCoreTempC = 38;

    const bucketSec = frames.length > 1
      ? Math.max(1, (frames[frames.length - 1].elapsedSec - frames[0].elapsedSec) / (frames.length - 1))
      : 1;

    frames.forEach((f) => {
      totalReqs += Math.round((f.rps || 0) * bucketSec);
      totalFailed += Math.round((f.failedReqs || 0) * bucketSec);
      if (f.vus > maxVus) maxVus = f.vus;
      if (f.rps > peakRps) peakRps = f.rps;
      sumRps += f.rps || 0;
      sumP50 += f.p50 || 0;
      sumP95 += f.p95 || 0;
      if (f.p95 > peakP95) peakP95 = f.p95;
      if (f.p99 > peakP99) peakP99 = f.p99;
      if (f.errorRate > peakErrorRate) peakErrorRate = f.errorRate;

      const tState = computeThermalState(f, this.thresholds);
      if (tState.coreTempC > maxCoreTempC) maxCoreTempC = tState.coreTempC;
    });

    const n = frames.length;
    const avgRps = Math.round(sumRps / n);
    const avgP50 = Math.round(sumP50 / n);
    const avgP95 = Math.round(sumP95 / n);
    const overallErrorPct = totalReqs > 0 ? Number(((totalFailed / totalReqs) * 100).toFixed(2)) : 0;
    const durationSec = frames[frames.length - 1].elapsedSec || n;

    let verdict = 'SLA PASSED // CRYO-STABLE';
    let verdictColor = '#10b981';
    if (peakP95 >= this.thresholds.criticalMs || peakErrorRate >= 5.0) {
      verdict = 'SLA BREACHED // CORE MELTDOWN DETECTED';
      verdictColor = '#ff004c';
    } else if (peakP95 >= this.thresholds.nominalMs || peakErrorRate >= 1.0) {
      verdict = 'SLA WARNING // THERMAL ESCALATION';
      verdictColor = '#ffaa00';
    }

    // Per-Load-Agent distribution (6 input streams)
    const weightDistribution = [0.22, 0.19, 0.18, 0.16, 0.14, 0.11];
    const agentBreakdown = [];
    for (let i = 0; i < NUM_HIGHWAYS; i++) {
      const w = weightDistribution[i];
      const ep = this.endpoints[i % this.endpoints.length] || `/api/stream-${i + 1}`;
      agentBreakdown.push({
        agentId: `LOAD-AGENT-0${i + 1}`,
        endpoint: ep,
        peakVus: Math.max(1, Math.round(maxVus * w)),
        totalReqs: Math.round(totalReqs * w),
        peakRps: Math.round(peakRps * w),
        avgP95: Math.round(avgP95 * (0.88 + i * 0.05)),
        errorPct: Number((overallErrorPct * (0.85 + (i % 3) * 0.15)).toFixed(2))
      });
    }

    return {
      durationSec,
      totalReqs,
      totalFailed,
      maxVus,
      peakRps,
      avgRps,
      avgP50,
      avgP95,
      peakP95,
      peakP99,
      peakErrorRate: Number(peakErrorRate.toFixed(2)),
      overallErrorPct,
      maxCoreTempC,
      verdict,
      verdictColor,
      agentBreakdown
    };
  }

  _spawnErrorShockwave() {
    const lane = Math.floor(Math.random() * NUM_HIGHWAYS);
    const angle = (lane * Math.PI * 2) / NUM_HIGHWAYS + (Math.random() - 0.5) * 0.4;
    const hitPos = new THREE.Vector3(
      Math.cos(angle) * 19.5,
      4.5 + Math.random() * 8,
      Math.sin(angle) * 19.5
    );

    const ringGeo = new THREE.RingGeometry(0.4, 0.95, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff0044,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.copy(hitPos);
    mesh.lookAt(0, 6, 0);
    this.scene.add(mesh);

    this.shockwaves.push({
      mesh,
      mat: ringMat,
      age: 0,
      maxAge: 0.65
    });
  }

  updateAndRender(dt) {
    const safeDt = Math.min(0.1, Math.max(0.001, dt));
    this.clockTime += safeDt;

    const targetHeat = this.thermal.heat;
    this.smoothedHeat += (targetHeat - this.smoothedHeat) * Math.min(1, safeDt * 5.0);
    this.smoothedRps += ((this.currentFrame.rps || 0) - this.smoothedRps) * Math.min(1, safeDt * 6.0);
    this.smoothedVus += ((this.currentFrame.vus || 0) - this.smoothedVus) * Math.min(1, safeDt * 6.0);
    this.smoothedP95 += ((this.currentFrame.p95 || 0) - this.smoothedP95) * Math.min(1, safeDt * 6.0);

    const heat = this.smoothedHeat;

    const thermalColor = new THREE.Color();
    if (heat < 0.33) {
      thermalColor.lerpColors(new THREE.Color(0x00f0ff), new THREE.Color(0xffb800), heat / 0.33);
    } else if (heat < 0.72) {
      thermalColor.lerpColors(new THREE.Color(0xffb800), new THREE.Color(0xff2a00), (heat - 0.33) / 0.39);
    } else {
      thermalColor.lerpColors(new THREE.Color(0xff2a00), new THREE.Color(0xff004c), (heat - 0.72) / 0.28);
    }

    // 1. Update SUT Core & Lighting
    const pulse = 1 + Math.sin(this.clockTime * (3 + heat * 14)) * (0.04 + heat * 0.14);
    const coreScale = (1 + heat * 0.42) * pulse;
    this.coreMesh.scale.setScalar(coreScale);
    this.coreMesh.rotation.y += safeDt * (0.6 + heat * 3.8);
    this.coreMesh.rotation.x += safeDt * (0.35 + heat * 2.2);

    this.coreMat.color.copy(thermalColor);
    this.coreMat.emissive.copy(thermalColor);
    this.coreMat.emissiveIntensity = 1.8 + heat * 3.5;

    this.coreLight.color.copy(thermalColor);
    this.coreLight.intensity = 5.5 + heat * 14.0;

    this.citadelBaseMat.emissive.copy(thermalColor);
    this.citadelBaseMat.emissiveIntensity = 0.22 + Math.pow(heat, 1.5) * 1.45;

    this.gimbalRings.forEach((ring, idx) => {
      const speed = (idx + 1) * (0.55 + heat * 2.8) * (idx % 2 === 0 ? 1 : -1);
      ring.rotation.x += safeDt * speed;
      ring.rotation.y += safeDt * speed * 0.75;
    });

    this.thermalEdgeMaterials.forEach((mat) => {
      mat.color.copy(thermalColor);
    });
    this.bastionPylons.forEach((mat) => {
      mat.color.copy(thermalColor);
    });

    // Spin the 6 Load Agent Generator Cores & Accelerator Rings based on RPS
    const agentSpin = 1.2 + (this.smoothedRps / 2000) * 4.5;
    this.loadAgentCores.forEach((orb, idx) => {
      orb.rotation.y += safeDt * agentSpin;
      orb.rotation.x += safeDt * agentSpin * 0.6;
      const s = 1 + Math.sin(this.clockTime * 6 + idx) * 0.12;
      orb.scale.setScalar(s);
    });
    this.loadAgentRings.forEach((ring) => {
      ring.rotation.z += safeDt * agentSpin * 1.5;
    });

    this.beamMat.color.copy(thermalColor);
    this.beamMat.opacity = 0.16 + heat * 0.42 + Math.sin(this.clockTime * 10) * 0.04;
    this.plasmaBeam.scale.set(1 + heat * 1.4, 1, 1 + heat * 1.4);

    const errRate = this.currentFrame.errorRate || 0;
    this.shieldDome.rotation.y -= safeDt * 0.18;
    this.shieldDomeMat.color.copy(errRate > 2 ? new THREE.Color(0xff0044) : thermalColor);
    this.shieldDomeMat.opacity = 0.1 + heat * 0.18 + (errRate > 0 ? Math.abs(Math.sin(this.clockTime * 18)) * 0.18 : 0);

    this.radarRings.forEach((ring, idx) => {
      ring.material.color.copy(idx < 3 ? thermalColor : new THREE.Color(0x0d4a6e).lerp(thermalColor, heat * 0.7));
      const wave = Math.sin(this.clockTime * (2 + heat * 6) - idx * 0.9);
      ring.material.opacity = 0.25 + (wave * 0.5 + 0.5) * (0.28 + heat * 0.35);
    });

    // 2. Update Highway Bot Swarms (Spawned from the 6 Load Agents at r=82 -> rushing into SUT at r=18)
    const activeHighwayCount = Math.min(
      MAX_HIGHWAY_BOTS,
      Math.max(45, Math.round((this.smoothedRps / 4500) * MAX_HIGHWAY_BOTS * 0.85 + (this.smoothedVus / 2500) * 250))
    );
    const botSpeed = 14 + Math.min(48, (this.smoothedRps / 4000) * 36);
    const dummy = new THREE.Object3D();
    const botColor = new THREE.Color();

    for (let i = 0; i < MAX_HIGHWAY_BOTS; i++) {
      if (i >= activeHighwayCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.highwayBotMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const b = this.highwayBots[i];
      b.distance -= safeDt * botSpeed * b.speedFactor;

      if (b.distance <= 17.5) {
        // Re-spawn at the Load Agent Emitter Portal (r = LOAD_AGENT_RADIUS - 3)
        b.distance = LOAD_AGENT_RADIUS - 3 - Math.random() * 4;
        b.isErrorBot = Math.random() * 100 < (this.currentFrame.errorRate || 0) * 1.4;
        if (b.isErrorBot && this.shockwaves.length < 18 && Math.random() < 0.35) {
          this._spawnErrorShockwave();
        }
      }

      const angle = (b.lane * Math.PI * 2) / NUM_HIGHWAYS;
      const perpAngle = angle + Math.PI / 2;
      const x = Math.cos(angle) * b.distance + Math.cos(perpAngle) * b.laneOffset;
      const z = Math.sin(angle) * b.distance + Math.sin(perpAngle) * b.laneOffset;
      const y = b.altitude + Math.sin(this.clockTime * 6 + i) * 0.18;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, -angle - Math.PI / 2, 0);
      const stretch = 1 + (botSpeed / 45) * 0.85;
      dummy.scale.set(0.9, 0.9, stretch);
      dummy.updateMatrix();
      this.highwayBotMesh.setMatrixAt(i, dummy.matrix);

      if (b.isErrorBot) {
        botColor.setHex(0xff0044);
      } else if (b.distance < 34) {
        botColor.setHex(0x00f0ff).lerp(thermalColor, heat * 0.9);
      } else {
        botColor.setHex(0x00f0ff);
      }
      this.highwayBotMesh.setColorAt(i, botColor);
    }
    this.highwayBotMesh.instanceMatrix.needsUpdate = true;
    if (this.highwayBotMesh.instanceColor) this.highwayBotMesh.instanceColor.needsUpdate = true;

    // 3. Update Inner SUT Congestion Queue Bots
    const activeQueueCount = Math.min(
      MAX_QUEUE_BOTS,
      Math.max(20, Math.round(Math.pow(heat, 1.15) * MAX_QUEUE_BOTS))
    );

    for (let i = 0; i < MAX_QUEUE_BOTS; i++) {
      if (i >= activeQueueCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.queueBotMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const qb = this.queueBots[i];
      qb.angle += safeDt * qb.orbitSpeed * (0.8 + heat * 2.2);
      const r = qb.radius * (1 - heat * 0.18);
      const x = Math.cos(qb.angle) * r;
      const z = Math.sin(qb.angle) * r;
      const y = qb.altitude + Math.sin(this.clockTime * 4 + qb.verticalPhase) * (0.6 + heat * 1.4);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, -qb.angle + (qb.orbitSpeed > 0 ? 0 : Math.PI), 0);
      dummy.scale.setScalar(0.85 + heat * 0.55);
      dummy.updateMatrix();
      this.queueBotMesh.setMatrixAt(i, dummy.matrix);

      botColor.copy(thermalColor);
      if (heat > 0.75 && i % 4 === 0) {
        botColor.setHex(0xfff4d0);
      }
      this.queueBotMesh.setColorAt(i, botColor);
    }
    this.queueBotMesh.instanceMatrix.needsUpdate = true;
    if (this.queueBotMesh.instanceColor) this.queueBotMesh.instanceColor.needsUpdate = true;

    // 4. Update Rising Thermal Plume Particles
    const activeParticleCount = Math.min(
      MAX_THERMAL_PARTICLES,
      Math.round(60 + heat * (MAX_THERMAL_PARTICLES - 60))
    );

    for (let i = 0; i < MAX_THERMAL_PARTICLES; i++) {
      if (i >= activeParticleCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.thermalParticleMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const p = this.thermalParticles[i];
      p.y += safeDt * p.speedY * (0.5 + heat * 2.1);
      p.theta += safeDt * p.swirl * (1 + heat * 2.5);
      if (p.y > 36) p.y = 1.0;

      const x = Math.cos(p.theta) * p.r;
      const z = Math.sin(p.theta) * p.r;
      const lifeScale = Math.sin((p.y / 36) * Math.PI) * (0.6 + heat * 1.1);

      dummy.position.set(x, p.y, z);
      dummy.rotation.set(this.clockTime * 2, this.clockTime * 3, 0);
      dummy.scale.setScalar(Math.max(0.05, lifeScale));
      dummy.updateMatrix();
      this.thermalParticleMesh.setMatrixAt(i, dummy.matrix);

      botColor.copy(thermalColor);
      if (heat > 0.65 && i % 3 === 0) botColor.setHex(0xffdd77);
      this.thermalParticleMesh.setColorAt(i, botColor);
    }
    this.thermalParticleMesh.instanceMatrix.needsUpdate = true;
    if (this.thermalParticleMesh.instanceColor) this.thermalParticleMesh.instanceColor.needsUpdate = true;

    // 5. Update Error Impact Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.age += safeDt;
      if (sw.age >= sw.maxAge) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mat.dispose();
        this.shockwaves.splice(i, 1);
      } else {
        const progress = sw.age / sw.maxAge;
        const scale = 1 + progress * 6.5;
        sw.mesh.scale.setScalar(scale);
        sw.mat.opacity = (1 - progress) * 0.9;
      }
    }

    // 6. Update Camera Position
    this._updateCamera(safeDt, heat);

    // Render 3D WebGL scene
    this.renderer.render(this.scene, this.camera);

    // 7. Composite 3D WebGL + SUT & Load Agent Labels + Response Time/Error Graph + Summary
    this._compositeBroadcastFrame(heat);
  }

  _updateCamera(dt, heat) {
    let activeShot = this.cameraMode;
    if (activeShot === 'auto') {
      const cycle = Math.floor(this.clockTime / 8) % 5;
      if (heat > 0.78 && cycle % 2 === 1) {
        activeShot = 'core';
      } else {
        activeShot = ['orbit', 'agents', 'highway', 'core', 'top'][cycle];
      }
    }

    this.activeDirectorShotName = {
      orbit: 'CAM-01 // ORBITAL SUT & LOAD AGENTS WIDE',
      agents: 'CAM-02 // PERIMETER LOAD AGENT RING',
      highway: 'CAM-03 // INGRESS BOTNET VECTOR',
      core: 'CAM-04 // SUT THERMAL REACTOR CORE',
      top: 'CAM-05 // TACTICAL HEX RADAR'
    }[activeShot] || 'CAM-01 // ORBITAL WIDE';

    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3(0, 6, 0);

    const az = this.clockTime * 0.16 + this.userAzimuthOffset;
    const zoom = this.userZoom;

    if (activeShot === 'highway') {
      const sway = Math.sin(this.clockTime * 0.35) * 6;
      targetPos.set(52 * zoom, 11 + this.userElevationOffset * 18, sway);
      targetLook.set(0, 6.5, 0);
    } else if (activeShot === 'agents') {
      // Positioned behind Load Agent 01 looking past the Load Agent spire straight toward the SUT
      const agentIdx = Math.floor(this.clockTime / 4) % NUM_HIGHWAYS;
      const angle = (agentIdx * Math.PI * 2) / NUM_HIGHWAYS + Math.sin(this.clockTime * 0.25) * 0.12;
      const dist = 98 * zoom;
      targetPos.set(Math.cos(angle) * dist, 19 + this.userElevationOffset * 18, Math.sin(angle) * dist);
      targetLook.set(0, 7, 0);
    } else if (activeShot === 'core') {
      const coreAz = this.clockTime * 0.42 + this.userAzimuthOffset;
      const r = 25 * zoom;
      targetPos.set(Math.cos(coreAz) * r, 14 + this.userElevationOffset * 15, Math.sin(coreAz) * r);
      targetLook.set(0, 8.8, 0);
    } else if (activeShot === 'top') {
      const topAz = this.clockTime * 0.08 + this.userAzimuthOffset;
      targetPos.set(Math.cos(topAz) * 34 * zoom, 92 * zoom, Math.sin(topAz) * 34 * zoom);
      targetLook.set(0, 2, 0);
    } else {
      const r = 68 * zoom;
      const elev = Math.max(10, 34 + this.userElevationOffset * 32);
      targetPos.set(Math.cos(az) * r, elev, Math.sin(az) * r);
      targetLook.set(0, 5.5, 0);
    }

    if (heat > 0.72) {
      const shakeAmt = (heat - 0.72) * 0.85;
      targetPos.x += (Math.random() - 0.5) * shakeAmt;
      targetPos.y += (Math.random() - 0.5) * shakeAmt;
    }

    this.camera.position.lerp(targetPos, Math.min(1, dt * 2.8));
    this.cameraTarget.lerp(targetLook, Math.min(1, dt * 3.5));
    this.camera.lookAt(this.cameraTarget);
  }

  _compositeBroadcastFrame(heat) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const f = this.currentFrame;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.webglCanvas, 0, 0, W, H);

    // Thermal Vignette Glow around screen edges when hot
    if (heat > 0.35) {
      const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.58);
      const alpha = (heat - 0.35) * 0.42;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, heat > 0.75 ? `rgba(255, 0, 60, ${alpha})` : `rgba(255, 102, 0, ${alpha * 0.8})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    if (!this.showHudInCanvas) return;

    // 1. Project 3D Labels: Central SUT Label + 6 Outer Load Agent Labels + 6 Gate Labels
    this._draw3DAnchoredLabels(ctx, W, H, f, heat);

    // 2. Top Broadcast Header Bar
    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 22, 0.84)';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(36, 22, W - 72, 62, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.thermal.colorHex;
    ctx.beginPath();
    ctx.arc(64, 53, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '700 20px "Space Grotesk", "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(this.testTitle, 84, 48);

    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#7da2c1';
    ctx.fillText(`${this.sourceLabel}  ·  ${this.activeDirectorShotName}`, 84, 69);

    const badgeW = 350;
    ctx.fillStyle = heat > 0.65 ? 'rgba(255, 0, 68, 0.22)' : 'rgba(0, 240, 255, 0.1)';
    ctx.strokeStyle = this.thermal.colorHex;
    ctx.beginPath();
    ctx.roundRect(W - 36 - badgeW - 16, 33, badgeW, 40, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillStyle = this.thermal.colorHex;
    ctx.textAlign = 'center';
    ctx.fillText(`SUT STATE: ${this.thermal.label}`, W - 36 - badgeW / 2 - 16, 58);

    // 3. Left Telemetry Column (Compact 4 KPI Cards)
    const cards = [
      {
        label: 'TOTAL LOAD AGENTS SWARM',
        value: f.vus.toLocaleString(),
        unit: 'VUs',
        sub: '6 LOAD AGENTS ACTIVE',
        color: '#00f0ff'
      },
      {
        label: 'SUT INGRESS THROUGHPUT',
        value: f.rps.toLocaleString(),
        unit: 'REQ/S',
        sub: `${Math.round(f.rps * 60).toLocaleString()} REQ/MIN`,
        color: '#38bdf8'
      },
      {
        label: 'SUT RESPONSE TIME (P95)',
        value: `${f.p95}`,
        unit: 'ms',
        sub: `P50: ${f.p50}ms  ·  P99: ${f.p99}ms`,
        color: this.thermal.colorHex
      },
      {
        label: 'HTTP ERRORS (FAILED)',
        value: `${f.errorRate.toFixed(2)}%`,
        unit: `(${f.failedReqs}/s)`,
        sub: `CHECKS PASS: ${f.checksPassRate}%`,
        color: f.errorRate > 1 ? '#ff004c' : '#10b981'
      }
    ];

    cards.forEach((c, idx) => {
      const cy = 100 + idx * 102;
      ctx.fillStyle = 'rgba(5, 11, 24, 0.80)';
      ctx.strokeStyle = 'rgba(125, 162, 193, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(36, cy, 296, 90, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.color;
      ctx.fillRect(36, cy + 10, 4, 70);

      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8aa8c7';
      ctx.textAlign = 'left';
      ctx.fillText(c.label, 52, cy + 23);

      ctx.font = '700 30px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(c.value, 52, cy + 58);

      const valW = ctx.measureText(c.value).width;
      ctx.font = '600 14px "JetBrains Mono", monospace';
      ctx.fillStyle = c.color;
      ctx.fillText(c.unit, 52 + valW + 8, cy + 58);

      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#6889a8';
      ctx.fillText(c.sub, 52, cy + 78);
    });

    // 4. Right Vertical SUT Core Thermal Gauge
    const gx = W - 116;
    const gy = 100;
    const gh = 398;
    ctx.fillStyle = 'rgba(5, 11, 24, 0.80)';
    ctx.strokeStyle = 'rgba(125, 162, 193, 0.24)';
    ctx.beginPath();
    ctx.roundRect(gx, gy, 80, gh, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8aa8c7';
    ctx.textAlign = 'center';
    ctx.fillText('SUT TEMP', gx + 40, gy + 24);

    const barX = gx + 28;
    const barY = gy + 40;
    const barW = 24;
    const barH = gh - 105;
    ctx.fillStyle = 'rgba(15, 28, 48, 0.95)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 6);
    ctx.fill();

    const fillH = Math.max(8, barH * heat);
    const thermGrad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    thermGrad.addColorStop(0, '#00f0ff');
    thermGrad.addColorStop(0.45, '#ffaa00');
    thermGrad.addColorStop(0.8, '#ff3300');
    thermGrad.addColorStop(1, '#ff004c');
    ctx.fillStyle = thermGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barY + barH - fillH, barW, fillH, 6);
    ctx.fill();

    ctx.font = '700 19px "JetBrains Mono", monospace';
    ctx.fillStyle = this.thermal.colorHex;
    ctx.fillText(`${this.thermal.coreTempC}°C`, gx + 40, gy + gh - 34);

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#7da2c1';
    ctx.fillText(`${Math.round(heat * 100)}% HEAT`, gx + 40, gy + gh - 14);

    // 5. Dedicated K6 Response Times (P50 / P95 / P99) & HTTP Errors Graph Panel
    this._drawResponseTimesAndErrorsGraph(ctx, W, H, f);

    // 6. End-of-Test Summary Report Overlay (when test completes or user toggles Summary)
    if (this.showSummaryOverlay) {
      this._drawTestSummaryOverlay(ctx, W, H);
    }

    ctx.restore();
  }

  /**
   * Projects 3D coordinates onto the 2D HUD for:
   *  - Central SUT (System Under Test) Fortress Core Target Banner
   *  - 6 Outer "Load Agent" Generator Badges (one per input stream)
   *  - 6 Inner Fortress Gate Endpoint Badges
   */
  _draw3DAnchoredLabels(ctx, W, H, f, heat) {
    ctx.save();

    // A. Central SUT (System Under Test) Target Callout anchored above the Reactor Core
    const sutWorld = new THREE.Vector3(0, 21.5, 0);
    const sutProj = sutWorld.project(this.camera);
    if (sutProj.z < 1) {
      const sx = (sutProj.x * 0.5 + 0.5) * W;
      const sy = (-sutProj.y * 0.5 + 0.5) * H;

      if (sx > 260 && sx < W - 200 && sy > 95 && sy < H - 240) {
        const sutTitle = `🎯 ${this.sutName} (SYSTEM UNDER TEST)`;
        const sutSub = `P95: ${f.p95}ms  ·  ERRORS: ${f.errorRate.toFixed(1)}%  ·  CORE: ${this.thermal.coreTempC}°C`;
        ctx.font = '800 14px "JetBrains Mono", monospace';
        const w1 = ctx.measureText(sutTitle).width;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        const w2 = ctx.measureText(sutSub).width;
        const boxW = Math.max(w1, w2) + 32;
        const boxH = 48;

        // Vertical leader line down into the reactor core
        ctx.strokeStyle = this.thermal.colorHex;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sx, sy + boxH / 2);
        ctx.lineTo(sx, sy + boxH / 2 + 28);
        ctx.stroke();

        ctx.fillStyle = 'rgba(4, 10, 24, 0.90)';
        ctx.strokeStyle = this.thermal.colorHex;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(sx - boxW / 2, sy - boxH / 2, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = '800 14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(sutTitle, sx, sy - 4);

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = this.thermal.colorHex;
        ctx.fillText(sutSub, sx, sy + 15);
      }
    }

    // B. 6 Outer "LOAD AGENT" Labels at the start of every input stream
    const streamWeights = [0.22, 0.19, 0.18, 0.16, 0.14, 0.11];
    this.loadAgentWorldPositions.forEach((worldPos, idx) => {
      const proj = worldPos.clone().project(this.camera);
      if (proj.z > 1) return;
      const sx = (proj.x * 0.5 + 0.5) * W;
      const sy = (-proj.y * 0.5 + 0.5) * H;
      if (sx < 340 || sx > W - 140 || sy < 95 || sy > H - 220) return;

      const w = streamWeights[idx];
      const agentVus = Math.max(1, Math.round((f.vus || 0) * w));
      const agentRps = Math.round((f.rps || 0) * w);
      const epName = this.endpoints[idx % this.endpoints.length] || `/stream-${idx + 1}`;

      const line1 = `⚡ LOAD AGENT 0${idx + 1}  [${agentVus} VUs · ${agentRps} req/s]`;
      const line2 = `STREAM → ${epName}`;

      ctx.font = '700 11px "JetBrains Mono", monospace';
      const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 20;
      const th = 36;

      ctx.fillStyle = 'rgba(4, 16, 34, 0.86)';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(sx - tw / 2, sy - th / 2, tw, th, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00f0ff';
      ctx.textAlign = 'center';
      ctx.fillText(line1, sx, sy - 3);

      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#bfe8ff';
      ctx.fillText(line2, sx, sy + 12);
    });

    // C. 6 Inner SUT Gate Labels
    ctx.font = '600 11px "JetBrains Mono", monospace';
    this.gateWorldPositions.forEach((worldPos, idx) => {
      const projected = worldPos.clone().add(new THREE.Vector3(0, 9.5, 0)).project(this.camera);
      if (projected.z > 1) return;
      const sx = (projected.x * 0.5 + 0.5) * W;
      const sy = (-projected.y * 0.5 + 0.5) * H;
      if (sx < 340 || sx > W - 140 || sy < 100 || sy > H - 220) return;

      const epName = this.endpoints[idx % this.endpoints.length] || `GATE-0${idx + 1}`;
      const label = `SUT GATE 0${idx + 1}: ${epName}`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = 'rgba(4, 10, 22, 0.78)';
      ctx.strokeStyle = this.thermal.colorHex;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(sx - textWidth / 2 - 8, sy - 12, textWidth + 16, 20, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e2f4ff';
      ctx.textAlign = 'center';
      ctx.fillText(label, sx, sy + 2);
    });

    ctx.restore();
  }

  /**
   * Draws a dedicated, multi-series K6 Response Times (P50, P95, P99 in ms)
   * and HTTP Errors (`http_req_failed` % & count/s) dual-axis graph at the bottom of the canvas.
   */
  _drawResponseTimesAndErrorsGraph(ctx, W, H, f) {
    const panelX = 36;
    const panelY = H - 188;
    const panelW = W - 72;
    const panelH = 164;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 22, 0.90)';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.30)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 8);
    ctx.fill();
    ctx.stroke();

    // Header Row inside Graph Panel
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(
      `📈 K6 RESPONSE TIMES (MS) & HTTP ERRORS GRAPH  —  T+${formatElapsed(f.elapsedSec)}`,
      panelX + 18,
      panelY + 24
    );

    // Live Legend Badges in Header Row
    const legendItems = [
      { text: `━ P50: ${f.p50}ms`, color: '#00f0ff' },
      { text: `━ P95: ${f.p95}ms`, color: '#ff6b00' },
      { text: `┅ P99: ${f.p99}ms`, color: '#c084fc' },
      { text: `▮ HTTP ERRORS: ${f.errorRate.toFixed(2)}% (${f.failedReqs}/s)`, color: '#ff004c' }
    ];

    let lx = panelX + panelW - 24;
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = legendItems.length - 1; i >= 0; i--) {
      const item = legendItems[i];
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, lx, panelY + 24);
      lx -= ctx.measureText(item.text).width + 26;
    }

    // Plot Area Dimensions
    const plotLeft = panelX + 74;
    const plotRight = panelX + panelW - 76;
    const plotTop = panelY + 38;
    const plotBottom = panelY + panelH - 22;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;

    if (this.allFrames.length < 2) {
      ctx.restore();
      return;
    }

    const maxLatencyMs = Math.max(
      this.thresholds.criticalMs * 1.1,
      ...this.allFrames.map((fr) => Math.max(fr.p99 || 0, fr.p95 || 0))
    );
    const maxErrPct = Math.max(5, ...this.allFrames.map((fr) => fr.errorRate || 0)) * 1.15;

    // Horizontal Gridlines & Left Y-Axis Labels (Response Time in ms) + Right Y-Axis Labels (Error Rate %)
    ctx.lineWidth = 1;
    ctx.font = '500 10px "JetBrains Mono", monospace';
    const gridSteps = 3;
    for (let s = 0; s <= gridSteps; s++) {
      const ratio = s / gridSteps;
      const gy = plotBottom - ratio * plotH;
      ctx.strokeStyle = 'rgba(125, 162, 193, 0.14)';
      ctx.beginPath();
      ctx.moveTo(plotLeft, gy);
      ctx.lineTo(plotRight, gy);
      ctx.stroke();

      // Left Axis: Response Time (ms)
      const msVal = Math.round(ratio * maxLatencyMs);
      ctx.fillStyle = '#8aa8c7';
      ctx.textAlign = 'right';
      ctx.fillText(`${msVal}ms`, plotLeft - 8, gy + 3);

      // Right Axis: Error Rate (%)
      const errVal = (ratio * maxErrPct).toFixed(1);
      ctx.fillStyle = '#ff6b8b';
      ctx.textAlign = 'left';
      ctx.fillText(`${errVal}%`, plotRight + 8, gy + 3);
    }

    // Critical SLA Threshold Dashed Reference Line
    if (this.thresholds.criticalMs < maxLatencyMs) {
      const critY = plotBottom - (this.thresholds.criticalMs / maxLatencyMs) * plotH;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255, 0, 76, 0.55)';
      ctx.beginPath();
      ctx.moveTo(plotLeft, critY);
      ctx.lineTo(plotRight, critY);
      ctx.stroke();
      ctx.restore();
    }

    const count = this.allFrames.length;
    const barW = Math.max(2, plotW / count - 1);

    // 1. Draw HTTP Error Bars (`http_req_failed` %) along the graph
    this.allFrames.forEach((fr, idx) => {
      if (!fr.errorRate || fr.errorRate <= 0) return;
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const barH = Math.min(plotH, (fr.errorRate / maxErrPct) * plotH);
      ctx.fillStyle = 'rgba(255, 0, 76, 0.42)';
      ctx.fillRect(px - barW / 2, plotBottom - barH, barW, barH);
      ctx.fillStyle = '#ff004c';
      ctx.fillRect(px - barW / 2, plotBottom - barH, barW, 2);
    });

    // 2. Draw P95 Response Time Area Fill & Line (`http_req_duration` P95)
    const p95Grad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
    p95Grad.addColorStop(0, 'rgba(255, 107, 0, 0.34)');
    p95Grad.addColorStop(1, 'rgba(255, 107, 0, 0.02)');

    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p95 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(plotRight, plotBottom);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.closePath();
    ctx.fillStyle = p95Grad;
    ctx.fill();

    // P99 Dashed Violet Line
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p99 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();

    // P95 Bold Thermal Orange Line
    ctx.strokeStyle = '#ff6b00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p95 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // P50 Median Cyan Line
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p50 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Playhead Scanner Line & Dots
    const progress = Math.min(1, Math.max(0, (f.index || 0) / Math.max(1, count - 1)));
    const playheadX = plotLeft + progress * plotW;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, plotTop - 4);
    ctx.lineTo(playheadX, plotBottom + 4);
    ctx.stroke();

    // Highlight current P95 and Error points on playhead
    const curP95Y = plotBottom - (Math.min(maxLatencyMs, f.p95 || 0) / maxLatencyMs) * plotH;
    ctx.fillStyle = '#ff6b00';
    ctx.beginPath();
    ctx.arc(playheadX, curP95Y, 5, 0, Math.PI * 2);
    ctx.fill();

    if (f.errorRate > 0) {
      const curErrY = plotBottom - (Math.min(maxErrPct, f.errorRate) / maxErrPct) * plotH;
      ctx.fillStyle = '#ff004c';
      ctx.beginPath();
      ctx.arc(playheadX, curErrY, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Renders the End-of-Test Executive Summary Report Overlay directly on the canvas
   * when the test execution completes (or when toggled by the user).
   */
  _drawTestSummaryOverlay(ctx, W, H) {
    if (!this.summaryStats) {
      this.summaryStats = this._computeSummaryStats();
    }
    const s = this.summaryStats;
    if (!s) return;

    ctx.save();

    // Dimmed Tactical Backdrop over the 3D scene (keeping the graph visible below or framing nicely)
    ctx.fillStyle = 'rgba(3, 8, 18, 0.84)';
    ctx.fillRect(0, 0, W, H);

    const cardW = 1180;
    const cardH = 660;
    const cx = (W - cardW) / 2;
    const cy = (H - cardH) / 2 - 20;

    ctx.fillStyle = 'rgba(6, 14, 29, 0.96)';
    ctx.strokeStyle = s.verdictColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Header Banner
    ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.fillRect(cx + 2, cy + 2, cardW - 4, 82);

    ctx.font = '800 24px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`🏁 K6 TEST EXECUTION SUMMARY // ${this.testTitle}`, cx + 32, cy + 40);

    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8aa8c7';
    ctx.fillText(
      `TARGET: ${this.sutName}  ·  DURATION: ${formatElapsed(s.durationSec)}  ·  6 LOAD AGENTS`,
      cx + 32,
      cy + 66
    );

    // Verdict Badge on Top Right of Summary Card
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeStyle = s.verdictColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(cx + cardW - 410, cy + 20, 378, 44, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillStyle = s.verdictColor;
    ctx.textAlign = 'center';
    ctx.fillText(s.verdict, cx + cardW - 221, cy + 47);

    // 6 Executive Aggregate KPI Boxes
    const kpis = [
      {
        label: 'TOTAL HTTP REQUESTS',
        val: s.totalReqs.toLocaleString(),
        sub: `PEAK: ${s.peakRps.toLocaleString()} REQ/S (AVG ${s.avgRps})`,
        color: '#00f0ff'
      },
      {
        label: 'PEAK LOAD AGENT SWARM',
        val: `${s.maxVus.toLocaleString()} VUs`,
        sub: 'DISTRIBUTED ACROSS 6 STREAMS',
        color: '#38bdf8'
      },
      {
        label: 'SUT RESPONSE TIME (P95)',
        val: `${s.peakP95} ms`,
        sub: `AVG P50: ${s.avgP50}ms · AVG P95: ${s.avgP95}ms`,
        color: '#ff6b00'
      },
      {
        label: 'TAIL LATENCY (PEAK P99)',
        val: `${s.peakP99} ms`,
        sub: `SLA CRITICAL LIMIT: ${this.thresholds.criticalMs}ms`,
        color: '#c084fc'
      },
      {
        label: 'TOTAL FAILED REQUESTS',
        val: s.totalFailed.toLocaleString(),
        sub: `OVERALL ERROR RATE: ${s.overallErrorPct}% (PEAK ${s.peakErrorRate}%)`,
        color: s.overallErrorPct > 1 ? '#ff004c' : '#10b981'
      },
      {
        label: 'PEAK SUT CORE TEMP',
        val: `${s.maxCoreTempC}°C`,
        sub: s.maxCoreTempC > 850 ? 'CRITICAL THERMAL OVERHEAT' : 'WITHIN THERMAL ENVELOPE',
        color: s.verdictColor
      }
    ];

    const boxW = 356;
    const boxH = 104;
    kpis.forEach((k, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const bx = cx + 32 + col * (boxW + 24);
      const by = cy + 106 + row * (boxH + 18);

      ctx.fillStyle = 'rgba(11, 24, 46, 0.85)';
      ctx.strokeStyle = 'rgba(125, 162, 193, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = k.color;
      ctx.fillRect(bx, by + 12, 4, boxH - 24);

      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8aa8c7';
      ctx.textAlign = 'left';
      ctx.fillText(k.label, bx + 18, by + 26);

      ctx.font = '700 28px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(k.val, bx + 18, by + 62);

      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = k.color;
      ctx.fillText(k.sub, bx + 18, by + 86);
    });

    // Per-Load-Agent Breakdown Table (6 Load Agents -> SUT Endpoints)
    const tableY = cy + 362;
    ctx.font = '700 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00f0ff';
    ctx.textAlign = 'left';
    ctx.fillText('⚡ INPUT STREAM LOAD AGENTS BREAKDOWN (LOAD AGENT 01 → 06)', cx + 32, tableY);

    const headers = ['LOAD AGENT', 'SUT TARGET ENDPOINT', 'PEAK VUs', 'PEAK RPS', 'TOTAL REQS', 'AVG P95', 'ERROR %'];
    const colOffsets = [32, 210, 540, 670, 810, 960, 1070];

    ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
    ctx.fillRect(cx + 28, tableY + 12, cardW - 56, 30);

    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#bfe8ff';
    headers.forEach((h, i) => {
      ctx.fillText(h, cx + colOffsets[i], tableY + 32);
    });

    s.agentBreakdown.forEach((ag, rIdx) => {
      const ry = tableY + 64 + rIdx * 34;
      if (rIdx % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(cx + 28, ry - 20, cardW - 56, 32);
      }

      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(ag.agentId, cx + colOffsets[0], ry);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(ag.endpoint, cx + colOffsets[1], ry);

      ctx.fillStyle = '#e2f4ff';
      ctx.fillText(`${ag.peakVus} VUs`, cx + colOffsets[2], ry);
      ctx.fillText(`${ag.peakRps} req/s`, cx + colOffsets[3], ry);
      ctx.fillText(ag.totalReqs.toLocaleString(), cx + colOffsets[4], ry);

      ctx.fillStyle = ag.avgP95 > this.thresholds.nominalMs ? '#ffaa00' : '#10b981';
      ctx.fillText(`${ag.avgP95} ms`, cx + colOffsets[5], ry);

      ctx.fillStyle = ag.errorPct > 1 ? '#ff004c' : '#10b981';
      ctx.fillText(`${ag.errorPct}%`, cx + colOffsets[6], ry);
    });

    ctx.restore();
  }
}

function formatElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
