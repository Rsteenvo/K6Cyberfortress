/**
 * k6 Cyber-Fortress — 1080p 60fps WebM / MP4 Video Exporter
 * Captures both the Left "Battle Scroll — Response Times" Table (`# METRICS MIN MAX AVG P95 P99 COUNT`)
 * AND the Right 3D Siege Broadcast Stage into a crisp 1920×1080 60fps standalone video file.
 */

export class FortressVideoExporter {
  constructor(canvas, onStateChange = () => {}) {
    this.stageCanvas = canvas;
    this.onStateChange = onStateChange;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;

    // Dedicated 1920×1080 broadcast composite canvas that combines:
    // - Left Panel (640×1080): Live "⚔️ Battle Scroll — Response Times" Table
    // - Right Panel (1280×1080): 3D Siege Cinema + HUD + Graph + Summary
    this.recordCanvas = document.createElement('canvas');
    this.recordCanvas.width = 1920;
    this.recordCanvas.height = 1080;
    this.recordCtx = this.recordCanvas.getContext('2d', { alpha: false });

    this.liveTableRows = [];
    this.liveTableBadge = 'NO DATA';
    this.nominalMs = 220;
    this.criticalMs = 550;
  }

  /**
   * Updated by app.js whenever the Response Times table updates so the exported video
   * renders the exact same live-streaming rows (`# | METRICS | MIN | MAX | AVG | P95 | P99 | COUNT`).
   */
  setTableData(rows = [], badgeText = 'LIVE', thresholds = {}) {
    this.liveTableRows = rows;
    this.liveTableBadge = badgeText;
    if (thresholds.nominalMs) this.nominalMs = thresholds.nominalMs;
    if (thresholds.criticalMs) this.criticalMs = thresholds.criticalMs;
  }

  /**
   * Called once per animation frame from app.js (`animate()`) while recording is active
   * (or unconditionally so `recordCanvas` is always up to date).
   */
  renderCompositeFrame() {
    if (!this.isRecording) return;

    const ctx = this.recordCtx;
    const W = this.recordCanvas.width;  // 1920
    const H = this.recordCanvas.height; // 1080

    // 1. Deep Obsidian & Warm Bronze Broadcast Frame Background
    ctx.fillStyle = '#09090d';
    ctx.fillRect(0, 0, W, H);

    const pad = 16;
    const tableW = 636;
    const tableH = H - pad * 2;
    const stageX = pad + tableW + 14;
    const stageW = W - stageX - pad; // 1254

    // 2. Left Panel: "⚔️ BATTLE SCROLL — RESPONSE TIMES" Table Card
    this._drawResponseTimesTablePanel(ctx, pad, pad, tableW, tableH);

    // 3. Right Panel: 16:9 3D Siege Cinema Stage (preserving aspect ratio with obsidian letterbox + gold frame)
    const stageAreaH = H - pad * 2;
    const targetAspect = this.stageCanvas.width / this.stageCanvas.height; // 16:9
    let drawW = stageW;
    let drawH = Math.round(drawW / targetAspect);
    if (drawH > stageAreaH) {
      drawH = stageAreaH;
      drawW = Math.round(drawH * targetAspect);
    }
    const drawX = stageX + Math.round((stageW - drawW) / 2);
    const drawY = pad + Math.round((stageAreaH - drawH) / 2);

    ctx.save();
    ctx.fillStyle = '#0c0c12';
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(stageX, pad, stageW, stageAreaH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.drawImage(this.stageCanvas, drawX, drawY, drawW, drawH);

    ctx.strokeStyle = 'rgba(230, 198, 135, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  _drawResponseTimesTablePanel(ctx, x, y, w, h) {
    ctx.save();

    // Outer Card Container
    const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
    cardGrad.addColorStop(0, 'rgba(22, 22, 30, 0.96)');
    cardGrad.addColorStop(1, 'rgba(13, 13, 19, 0.98)');
    ctx.fillStyle = cardGrad;
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    // Card Header
    const headerH = 48;
    ctx.font = '800 14px "Cinzel", Georgia, serif';
    ctx.fillStyle = '#e6c687';
    ctx.textAlign = 'left';
    ctx.fillText('⚔️ BATTLE SCROLL — RESPONSE TIMES', x + 16, y + 30);

    // Live Time Badge in Header Right
    ctx.font = '700 11px "JetBrains Mono", monospace';
    const badgeStr = this.liveTableBadge || 'LIVE';
    const badgeW = Math.max(96, ctx.measureText(badgeStr).width + 20);
    const badgeX = x + w - badgeW - 14;
    const badgeY = y + 13;
    ctx.fillStyle = 'rgba(230, 198, 135, 0.14)';
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.36)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, 24, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f5d996';
    ctx.textAlign = 'center';
    ctx.fillText(badgeStr, badgeX + badgeW / 2, badgeY + 16);

    // Divider below card header
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.22)';
    ctx.beginPath();
    ctx.moveTo(x + 12, y + headerH);
    ctx.lineTo(x + w - 12, y + headerH);
    ctx.stroke();

    // Inner Table Box
    const tblX = x + 10;
    const tblY = y + headerH + 8;
    const tblW = w - 20;
    const tblH = h - headerH - 18;

    ctx.fillStyle = 'rgba(10, 10, 15, 0.90)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.beginPath();
    ctx.roundRect(tblX, tblY, tblW, tblH, 7);
    ctx.fill();
    ctx.stroke();

    // Column layout matching `# | METRICS | MIN | MAX | AVG | P95 | P99 | COUNT`
    const cols = [
      { label: '#',       x: tblX + 10,  align: 'left' },
      { label: 'METRICS', x: tblX + 38,  align: 'left' },
      { label: 'MIN',     x: tblX + 292, align: 'right' },
      { label: 'MAX',     x: tblX + 354, align: 'right' },
      { label: 'AVG',     x: tblX + 414, align: 'right' },
      { label: 'P95',     x: tblX + 476, align: 'right' },
      { label: 'P99',     x: tblX + 538, align: 'right' },
      { label: 'COUNT',   x: tblX + tblW - 10, align: 'right' }
    ];

    // Sticky Table Header Row
    const thH = 34;
    ctx.fillStyle = '#16161f';
    ctx.beginPath();
    ctx.roundRect(tblX + 1, tblY + 1, tblW - 2, thH, [6, 6, 0, 0]);
    ctx.fill();

    ctx.strokeStyle = 'rgba(230, 198, 135, 0.30)';
    ctx.beginPath();
    ctx.moveTo(tblX, tblY + thH);
    ctx.lineTo(tblX + tblW, tblY + thH);
    ctx.stroke();

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e6c687';
    cols.forEach((col) => {
      ctx.textAlign = col.align;
      ctx.fillText(col.label, col.x, tblY + 22);
    });

    // Render Table Rows
    const rows = this.liveTableRows || [];
    if (!rows.length) {
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8b8a96';
      ctx.textAlign = 'center';
      ctx.fillText('NO DATA — Connect InfluxDB 1.8', tblX + tblW / 2, tblY + 80);
      ctx.restore();
      return;
    }

    const availH = tblH - thH - 6;
    const rowH = Math.min(36, Math.max(24, Math.floor(availH / Math.max(1, rows.length))));

    rows.forEach((r, idx) => {
      const ry = tblY + thH + idx * rowH;
      if (ry + rowH > tblY + tblH) return;

      if (idx % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.fillRect(tblX + 1, ry, tblW - 2, rowH);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(tblX + 2, ry + rowH);
      ctx.lineTo(tblX + tblW - 2, ry + rowH);
      ctx.stroke();

      const textY = ry + Math.round(rowH * 0.64);

      // # Step
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#e6c687';
      ctx.textAlign = 'left';
      ctx.fillText(String(r.step || String(idx + 1).padStart(2, '0')), cols[0].x, textY);

      // METRICS Name (clipped cleanly if very long)
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f5f3ef';
      let metricName = String(r.name || '');
      if (metricName.length > 26) metricName = `${metricName.slice(0, 25)}…`;
      ctx.fillText(metricName, cols[1].x, textY);

      // MIN, MAX, AVG
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#d4d4dc';
      ctx.textAlign = 'right';
      ctx.fillText(`${r.min}ms`, cols[2].x, textY);
      ctx.fillText(`${r.max}ms`, cols[3].x, textY);
      ctx.fillText(`${r.avg}ms`, cols[4].x, textY);

      // P95 (color-coded by SLA threshold)
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = r.p95Color || '#e6c687';
      ctx.fillText(`${r.p95}ms`, cols[5].x, textY);

      // P99
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#d4d4dc';
      ctx.fillText(`${r.p99}ms`, cols[6].x, textY);

      // COUNT
      ctx.fillStyle = '#f5f3ef';
      ctx.fillText(Number(r.count || 0).toLocaleString(), cols[7].x, textY);
    });

    ctx.restore();
  }

  getSupportedMimeType() {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return '';
  }

  startRecording(filenamePrefix = 'k6-cyber-fortress-movie') {
    if (this.isRecording) return;

    this.isRecording = true;
    this.renderCompositeFrame();

    const stream = this.recordCanvas.captureStream(60);
    const mimeType = this.getSupportedMimeType();
    const options = {
      videoBitsPerSecond: 16_000_000 // 16 Mbps for crisp 1080p table text & 3D siege detail
    };
    if (mimeType) options.mimeType = mimeType;

    this.chunks = [];
    this.filenamePrefix = filenamePrefix;
    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(this.chunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `${this.filenamePrefix}-${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      this.isRecording = false;
      this.onStateChange({ isRecording: false, downloaded: true });
    };

    this.mediaRecorder.start(200);
    this.onStateChange({ isRecording: true, downloaded: false });
  }

  stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }
}
