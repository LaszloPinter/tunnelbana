import Phaser from 'phaser';

/**
 * F toggles a frame-time overlay. It answers "is it slow, or does it HITCH?",
 * an average FPS hides exactly the thing that feels bad, so the readout leads
 * with the worst frame of the last ten seconds and how long ago it happened,
 * over a sparkline of the last few seconds of frame times.
 *
 * Costs to itself: the text is rewritten five times a second, never per frame
 * (rewriting a Text re-rasterises its canvas and re-uploads it to the GPU),
 * and the sparkline is one Graphics.
 */

const SAMPLES = 160;
/** one frame at 60Hz, the line everything is judged against */
const BUDGET = 1000 / 60;
const SPARK_W = 320;
const SPARK_H = 46;
/** frame times above this are spikes worth remembering */
const SPIKE_MS = 32;

export interface PerfCounts {
  enemies: number;
  projs: number;
  /** coins + pickups + stains + acid pools: the churn of short-lived things */
  fx: number;
  /** everything on the scene's display list */
  objects: number;
  tweens: number;
}

export class PerfHud {
  private readonly text: Phaser.GameObjects.Text;
  private readonly spark: Phaser.GameObjects.Graphics;
  private readonly frames = new Float32Array(SAMPLES);
  /** how many sim ticks each of those frames ran, the stutter instrument:
   * a steady 60 fps that alternates 0 and 2 is exactly what jitters */
  private readonly ticks = new Uint8Array(SAMPLES);
  private head = 0;
  private filled = 0;
  private simMs = 0;
  private drawMs = 0;
  private worst = 0;
  private worstAt = 0;
  private counts: PerfCounts = { enemies: 0, projs: 0, fx: 0, objects: 0, tweens: 0 };
  private nextPaintAt = 0;
  private visible = false;
  /** THE SPIKES, KEPT for the debug run file (dev/runFile.ts): every frame
   * over the line, with the tick it landed on and what was on screen */
  readonly spikes: { tick: number; ms: number; simMs: number; drawMs: number; counts: PerfCounts }[] = [];
  /** the sim tick this frame ended on, set by the scene before `sample` */
  atTick = 0;
  /** what the RENDERER does, which our own sim/draw timers cannot see: the
   * draw calls it issues and the Graphics commands it re-triangulates. A
   * frame can be 25 ms with both our timers at 1 ms, and then these two
   * numbers are the whole story (2026-09-05) */
  private glCalls = 0;
  private gfxCmds = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly x = 16,
    private readonly y = 132,
  ) {
    this.spark = scene.add.graphics().setScrollFactor(0).setDepth(190).setVisible(false);
    this.text = scene.add
      .text(x, y, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#b8f0d0',
        backgroundColor: '#0b0f14e0',
        padding: { x: 8, y: 6 },
        lineSpacing: 2,
      })
      .setScrollFactor(0)
      .setDepth(191)
      .setVisible(false);
  }

  toggle() {
    this.visible = !this.visible;
    this.text.setVisible(this.visible);
    this.spark.setVisible(this.visible);
    if (this.visible) {
      this.worst = 0;
      this.nextPaintAt = 0;
    } else {
      this.spark.clear();
    }
  }

  /** how long the fixed-step sim and the draw pass took inside this frame */
  timings(simMs: number, drawMs: number) {
    this.simMs = simMs;
    this.drawMs = drawMs;
  }

  /**
   * One frame's wall time, from Phaser's own delta, it spans the whole frame
   * including the render of the previous one, which is what the eye judges.
   */
  /**
   * ...and the counts themselves, gathered from the place and the scene. It
   * is the READOUT's business what it wants to count; the scene's job is to
   * hand it the two objects that know.
   */
  sampleFrom(
    frameMs: number,
    ticksRan: number,
    st: {
      enemies: unknown[];
      projs: unknown[];
      coins: unknown[];
      pickups: unknown[];
      stains: unknown[];
      acidPools: unknown[];
    },
    scene: { children: { length: number }; tweens: { getTweens(): unknown[] } },
    now: number,
  ) {
    this.sample(
      frameMs,
      ticksRan,
      {
        enemies: st.enemies.length,
        projs: st.projs.length,
        fx: st.coins.length + st.pickups.length + st.stains.length + st.acidPools.length,
        objects: scene.children.length,
        tweens: scene.tweens.getTweens().length,
      },
      now,
    );
  }

  sample(frameMs: number, ticksRan: number, counts: PerfCounts, now: number) {
    this.frames[this.head] = frameMs;
    this.ticks[this.head] = ticksRan;
    this.head = (this.head + 1) % SAMPLES;
    if (this.filled < SAMPLES) this.filled += 1;
    this.counts = counts;
    if (frameMs > SPIKE_MS) {
      this.spikes.push({
        tick: this.atTick,
        ms: Math.round(frameMs),
        simMs: Math.round(this.simMs * 10) / 10,
        drawMs: Math.round(this.drawMs * 10) / 10,
        counts,
      });
      if (this.spikes.length > 300) this.spikes.shift();
    }
    // a spike is remembered for ten seconds, then forgotten so the readout
    // reflects what is happening now
    if (frameMs > this.worst || now - this.worstAt > 10_000) {
      this.worst = frameMs;
      this.worstAt = now;
    }
    if (!this.visible || now < this.nextPaintAt) return;
    this.nextPaintAt = now + 200;
    this.paint(now);
  }

  /** count what the renderer is asked to do, once per repaint of this overlay */
  private measureRenderer() {
    const scene = this.text.scene;
    let cmds = 0;
    for (const o of scene.children.list) {
      const g = o as Phaser.GameObjects.Graphics;
      if (o.type === 'Graphics' && g.visible && g.commandBuffer) cmds += g.commandBuffer.length;
    }
    this.gfxCmds = cmds;
    const gl = (scene.game.renderer as { gl?: WebGLRenderingContext & { __calls?: number } }).gl;
    if (!gl) return;
    const tagged = gl as WebGLRenderingContext & { __calls?: number; __patched?: boolean };
    if (!tagged.__patched) {
      tagged.__patched = true;
      tagged.__calls = 0;
      const de = gl.drawElements.bind(gl);
      gl.drawElements = (m, cnt, t, o) => {
        tagged.__calls = (tagged.__calls ?? 0) + 1;
        de(m, cnt, t, o);
      };
      const da = gl.drawArrays.bind(gl);
      gl.drawArrays = (m, f, cnt) => {
        tagged.__calls = (tagged.__calls ?? 0) + 1;
        da(m, f, cnt);
      };
    }
    // calls since the last repaint, over the frames in between
    const frames = Math.max(
      1,
      Math.round(200 / Math.max(1, this.frames[(this.head - 1 + SAMPLES) % SAMPLES])),
    );
    this.glCalls = Math.round((tagged.__calls ?? 0) / frames);
    tagged.__calls = 0;
  }

  private paint(now: number) {
    let sum = 0;
    let recentMax = 0;
    const recent = Math.min(this.filled, 60);
    let none = 0;
    let twice = 0;
    for (let i = 1; i <= recent; i++) {
      const j = (this.head - i + SAMPLES) % SAMPLES;
      const v = this.frames[j];
      sum += v;
      if (v > recentMax) recentMax = v;
      if (this.ticks[j] === 0) none += 1;
      else if (this.ticks[j] > 1) twice += 1;
    }
    const avg = recent > 0 ? sum / recent : 0;
    const fps = avg > 0 ? 1000 / avg : 0;
    const spikeAge = (now - this.worstAt) / 1000;
    const c = this.counts;
    const cam = this.text.scene.cameras.main;
    this.measureRenderer();
    this.text.setText(
      [
        `FPS ${fps.toFixed(0).padStart(3)}   frame ${avg.toFixed(1)}ms   1s peak ${recentMax.toFixed(0)}ms`,
        `worst ${this.worst.toFixed(0)}ms  ${spikeAge < 0.4 ? 'NOW' : `${spikeAge.toFixed(0)}s ago`}   (10s window)`,
        `sim ${this.simMs.toFixed(2)}ms   draw ${this.drawMs.toFixed(2)}ms   ticks/frame: ${none} empty, ${twice} double (last 1s; both 0 = smooth)`,
        `enemies ${c.enemies}  projs ${c.projs}  fx ${c.fx}`,
        `objects ${c.objects}  tweens ${c.tweens}`,
        `gl calls ${this.glCalls}  graphics cmds ${this.gfxCmds}  (what the renderer redoes each frame)`,
        `canvas ${this.text.scene.scale.width}x${this.text.scene.scale.height}  zoom ${cam.zoom.toFixed(2)}  dpr ${window.devicePixelRatio}  (G to change)`,
      ].join('\n'),
    );

    // sparkline: one column per frame, tallest = 3 frame budgets
    const g = this.spark;
    const x0 = this.x;
    const y0 = this.y + this.text.height + 4;
    const top = BUDGET * 3;
    g.clear();
    g.fillStyle(0x0b0f14, 0.88);
    g.fillRect(x0, y0, SPARK_W, SPARK_H);
    const colW = SPARK_W / SAMPLES;
    for (let i = 0; i < this.filled; i++) {
      const v = this.frames[(this.head - this.filled + i + SAMPLES) % SAMPLES];
      const h = Math.min(1, v / top) * SPARK_H;
      g.fillStyle(v > SPIKE_MS ? 0xff5a4a : v > BUDGET * 1.25 ? 0xffc24a : 0x5ad08a, 0.95);
      g.fillRect(x0 + i * colW, y0 + SPARK_H - h, Math.max(1, colW - 0.5), h);
    }
    // the 60Hz line
    g.lineStyle(1, 0x8fa8c0, 0.7);
    const by = y0 + SPARK_H - (BUDGET / top) * SPARK_H;
    g.beginPath();
    g.moveTo(x0, by);
    g.lineTo(x0 + SPARK_W, by);
    g.strokePath();
  }
}
