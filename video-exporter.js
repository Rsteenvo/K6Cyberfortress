/**
 * k6 Cyber-Fortress — 1080p 60fps WebM / MP4 Video Exporter
 * Captures the composite master canvas (3D WebGL + Broadcast Telemetry HUD)
 * and exports a standalone video file of the test execution.
 */

export class FortressVideoExporter {
  constructor(canvas, onStateChange = () => {}) {
    this.canvas = canvas;
    this.onStateChange = onStateChange;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
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

    const stream = this.canvas.captureStream(60);
    const mimeType = this.getSupportedMimeType();
    const options = {
      videoBitsPerSecond: 14_000_000 // 14 Mbps for crisp 1080p particle & HUD detail
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
    this.isRecording = true;
    this.onStateChange({ isRecording: true, downloaded: false });
  }

  stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }
}
