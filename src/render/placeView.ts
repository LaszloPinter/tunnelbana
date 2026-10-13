import Phaser from 'phaser';
import { shortName } from '../core/network.ts';
import type { Run } from '../sim/run.ts';
import { MAX_RAILS, type Station } from '../sim/station.ts';
import { fromPlatform } from '../world/floor.ts';
import { RoomPose } from './roomPose.ts';
import { nextArrivalAt } from '../sim/fleetRealise.ts';
import { corridorToward } from '../sim/places.ts';
import { buildStation, type StationCtx } from './stationBuilder.ts';
import type { KioskGfx } from './stationFurniture.ts';
import { EnemyView } from './enemyView.ts';
import { GroundViews } from './groundView.ts';
import { ProjectileView } from './projectileView.ts';
import { TelegraphView } from './telegraphView.ts';
import { CorruptionView } from './lightAndDark.ts';
import { setTextColor } from './text.ts';
import * as DEPTH from './depth.ts';
import { reads, remember, type Fixed } from './placed.ts';

type Board = { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text };

/**
 * THE WHOLE PICTURE OF ONE PLACE, its floor, walls, ads and furniture, its
 * departure boards, its horde, its loot, its shots, its dark, built ONCE in
 * the place's own along-and-across and STOOD where the place stands in
 * Stockholm (poseAt). The trains are the map's own picture
 * (render/mapMetal.ts).
 *
 * There is exactly one way to draw a station. The station you stand in and
 * the one you can see down the tunnel are the same object drawn the same
 * way, so nothing can appear, vanish or change brightness as you arrive.
 */
export class PlaceView {
  readonly st: Station;
  /** the station's build this picture was made from (Station.buildGen) */
  readonly gen: number;
  private fixed: Fixed[] = [];
  /** the departure boards, whose visibility the LAYOUT decides too */
  private boardFixed: Fixed[] = [];
  private slotUsed: boolean[] = [];
  private shown = true;
  /** the world rotation that comes out level on screen */
  upright = 0;
  /** where the room stands and which way up it is shown (roomPose.ts) */
  private readonly pose = new RoomPose();
  /** the whole interior, in one piece, for standing on the map */
  private box: Phaser.GameObjects.Container | null = null;
  /** ...and what is genuinely in front of a person, the exit flight
   * climbing away overhead, posed the same way, above the actors */
  private over: Phaser.GameObjects.Container | null = null;
  /** each rail's next arrival, remembered for the second it was asked in */
  private readonly arrivals = new Map<number, { sec: number; at: number | null }>();
  /** which way along the platform each rail's last train ran (+x or −x in the room) */
  private readonly lastDir: (1 | -1 | undefined)[] = [];

  /** a point of the platform's own along-and-across, on screen: its place
   * in Stockholm */
  private roomPoint(): (x: number, ly: number) => { x: number; y: number } {
    const st = this.st;
    return (x, ly) => fromPlatform(st, x, ly);
  }
  private readonly boards: Board[] = [];
  private kioskGfx: KioskGfx[] = [];
  private readonly enemy: EnemyView;
  private readonly ground: GroundViews;
  private readonly proj: ProjectileView;
  private readonly telegraph: TelegraphView;
  private readonly corruption: CorruptionView;
  /** near enough to the camera for its moving parts to be worth drawing */
  private near = true;

  constructor(
    private readonly scene: Phaser.Scene,
    res: number,
    run: Run,
    st: Station,
  ) {
    this.st = st;
    this.gen = st.buildGen;
    for (let slot = 0; slot < MAX_RAILS; slot++) {
      const bg = scene.add.rectangle(0, 0, 190, 40, 0x0a0c10).setDepth(1.3).setAlpha(0.35);
      const text = scene.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd54a', align: 'center' })
        .setOrigin(0.5, 0.5)
        .setDepth(1.35)
        .setAlpha(0.92);
      this.boards.push({ bg, text });
    }
    const built = buildStation(this.ctx(run), st.name);
    this.fixed = built.decor.map(remember);
    for (const b of this.boards) this.boardFixed.push(remember(b.bg), remember(b.text));
    this.kioskGfx = built.kioskGfx;
    this.railsChanged();
    this.enemy = new EnemyView(scene);
    this.ground = new GroundViews(scene);
    this.proj = new ProjectileView(scene);
    this.telegraph = new TelegraphView(scene);
    this.corruption = new CorruptionView(scene);
  }

  private ctx(run: Run): StationCtx {
    const st = this.st;
    void run;
    return {
      scene: this.scene,
      plan: st.plan!,
      worldW: st.worldW,
      bedTop: st.worldTopY,
      platTop: st.platforms[0].top,
      platBottom: st.platforms[0].bottom,
      bed2Bottom: st.worldBottomY,
      rails: st.rails,
      worldBoards: this.boards,
      platforms: st.platforms,
      passages: st.passages,
      path: st.path,
      shaftsTo: [],
      boreL: corridorToward(st, -1) !== null,
      boreR: corridorToward(st, 1) !== null,
      storey: st.storey,
    };
  }

  /**
   * STAND THIS PLATFORM WHERE IT STANDS, facing the way it faces.
   *
   * The art is built in the station's own along-and-across and never needs to
   * be built any other way, so putting it on the map is one rigid motion,
   * and Phaser will carry every ad, bench, machine, tile and board along with
   * it. That is the whole of what "station interiors on the map" takes: the
   * interior was never the problem, the frame was.
   *
   * Everything fixed goes into one container, in the order its depths gave it,
   * because a station's art all sits below the actors (−0.4 to 1.35) and the
   * dark above them belongs to the tunnel, not here.
   */
  poseAt(anchorX: number, anchorY: number, angle: number) {
    this.pose.at(anchorX, anchorY, angle);
    if (!this.box) {
      // A CONTAINER HAS ONE DEPTH, and its children's are forgotten: with
      // everything in one box the exit flight drawn at OVERHEAD came out
      // under the player, the horde and the coins. Two boxes, then, the
      // room, and what stands over it.
      this.box = this.scene.add.container(0, 0).setDepth(DEPTH.ROOM);
      this.over = this.scene.add.container(0, 0).setDepth(DEPTH.OVERHEAD);
      const all = [...this.fixed, ...this.boardFixed].sort(
        (a, b) => (a.obj as Phaser.GameObjects.Image).depth - (b.obj as Phaser.GameObjects.Image).depth,
      );
      for (const f of all) {
        f.obj.setPosition(f.x, f.y).setRotation(f.rot);
        ((f.obj as Phaser.GameObjects.Image).depth >= DEPTH.OVERHEAD ? this.over : this.box).add(f.obj);
      }
    }
    this.pose.apply(this.box);
    if (this.over) this.pose.apply(this.over);
  }

  /**
   * OFF CAMERA, a place keeps its picture but stops being drawn. Phaser
   * transforms and renders every visible object whether or not it is on
   * screen, and a station is hundreds of them; hiding costs nothing and
   * rebuilding would stutter, so the objects stay (2026-09-05).
   */
  private setShown(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    // ONE FLAG when the whole interior is one piece. Hiding a station used to
    // mean touching every object in it; on the map its art is a container
    // standing where the station stands, and a container that is not visible
    // costs nothing to have.
    if (this.box) this.box.setVisible(on);
    if (this.over) this.over.setVisible(on);
    else for (const f of this.fixed) f.obj.setVisible(on);
    this.railsChanged();
  }

  /** the layout changed which rail slots exist */
  railsChanged() {
    this.arrivals.clear();
    for (let sl = 0; sl < MAX_RAILS; sl++) {
      const used = this.st.rails.some((r) => r.slot === sl);
      this.slotUsed[sl] = used;
      this.boards[sl].bg.setVisible(used && this.shown);
      this.boards[sl].text.setVisible(used && this.shown);
    }
  }

  /** WHAT IS READ STAYS THE RIGHT WAY UP. Shown from its other end, the
   * room itself does not turn (roomPose.ts), each label and board turns
   * half round where it stands, so the words read and the machines stay
   * where E finds them. */
  private turnWords() {
    const turn = this.pose.isFlipped ? Math.PI : 0;
    for (const f of this.fixed) if (reads(f.obj)) f.obj.setRotation(f.rot + turn);
    for (const f of this.boardFixed) if (reads(f.obj)) f.obj.setRotation(f.rot + turn);
  }

  /** the horizontal reach of this picture on screen */
  extent(): { x0: number; x1: number } {
    const st = this.st;
    // a platform lies at its own bearing, so its reach across the screen is
    // not its length: a station running north-south covers almost no x at
    // all. Take the box it stands in, got from where it was put, since that
    // is the only thing that knows: at most its half-diagonal either side
    if (!this.box) return { x0: st.x0, x1: st.x1 };
    const half = Math.hypot(st.x1 - st.x0, st.worldBottomY - st.worldTopY) / 2;
    return { x0: this.box.x - half, x1: this.box.x + half };
  }

  /** every frame: what moves, and what counts down */
  /** how far into the chain the horde is drawn (render/enemyRig.ts `dark`) */
  dark = 0;

  draw(
    now: number,
    camX0: number,
    camX1: number,
    camY0 = -Infinity,
    camY1 = Infinity,
    seats: readonly { alive: boolean; frame: { kind: string }; placeId: string }[] = [],
  ) {
    const st = this.st;
    const margin = st.platformX1 - st.platformX0;
    const ext = this.extent();
    let near = ext.x1 + margin > camX0 && ext.x0 - margin < camX1;
    // ON THE MAP a platform lies at its own bearing, so being within the
    // camera's x says almost nothing: a station running north-south overlaps
    // every x the camera has and can still be a kilometre away. Five stations
    // and six bores were being drawn in full at once, which is four times
    // what the old chart ever drew (from play 2026-09-10: "FPS drops").
    if (near && this.box) {
      const half = Math.hypot(this.st.x1 - this.st.x0, this.st.worldBottomY - this.st.worldTopY) / 2;
      near = this.box.y + half + margin > camY0 && this.box.y - half - margin < camY1;
    }
    // ...BUT WHAT IS ABOARD A TRAIN IS NOT IN THE ROOM ANY MORE. A rider,
    // yours or the horde's, is wherever its train has got to, which may be a
    // tunnel away from the platform it is still counted into. Hiding the room
    // hid them, so the vättar in the car you were riding blinked out as the
    // station fell behind (from play 2026-09-11: "enemies on trains go
    // invisible for a period"). The ROOM's picture can go; its riders cannot.
    const riders =
      st.enemies.some((e) => e.hp > 0 && e.frame.kind === 'aboard') ||
      seats.some((q) => q.alive && q.frame.kind !== 'world' && q.placeId === st.id);
    this.setShown(near);
    if (!near && !riders) {
      if (this.near) this.clearMoving();
      this.near = false;
      return;
    }
    this.near = true;
    this.proj.sync(st, now);
    this.ground.sync(st, now);
    this.enemy.sync(st, now, this.upright, this.dark);
    if (this.box && this.pose.faceUp(this.upright)) this.turnWords();
    this.telegraph.sync(st, now);
    this.corruption.draw(st, now, this.roomPoint());
    const sec = Math.floor(now / 1000);
    for (let ti = 0; ti < st.rails.length; ti++) {
      const rail = st.rails[ti];
      // THE WAY IT GOES along the platform, the arrow used to show which
      // side the doors opened, which reads as a direction and is not one
      // (from play 2026-09-25: "why are they switched?"). A train that is
      // here or coming says which way it runs; before any has, the last one's
      // way stands, and until then there is no arrow to be wrong.
      if (rail.journey) this.lastDir[ti] = rail.train.dir;
      const dir = this.lastDir[ti];
      const arrow = dir === undefined ? '•' : dir > 0 ? '▶' : '◀';
      let timeStr: string;
      if (rail.train.phase === 'dwell') timeStr = 'Now';
      else {
        // ONCE A SECOND: the answer walks the timetable and the board shows
        // whole seconds, and it was asked for every rail every frame
        let next = this.arrivals.get(ti);
        if (!next || next.sec !== sec)
          this.arrivals.set(ti, (next = { sec, at: nextArrivalAt(st, ti, now) }));
        const at = next.at;
        timeStr = at === null ? '-' : `${Math.max(0, Math.round((at - now) / 1000))} s`;
      }
      const cur = rail.current;
      const board = this.boards[rail.slot];
      board.text.setText(
        `${arrow} ${cur.service.id} ${shortName(cur.terminus)}\n${timeStr}${rail.short ? '   KORT TÅG' : ''}`,
      );
      setTextColor(board.text, '#ffd54a');
    }
    // the kiosks: shuttered and a red lamp, or lit and humming once the
    // station is cleared, every window of the one vendor together
    for (const k of this.kioskGfx) {
      if (st.cleared) {
        k.pane.setFillStyle(0xf0d27a);
        k.glow.setAlpha(0.25 + Math.sin(now / 220) * 0.12);
        k.lamp.setFillStyle(0x7ae08a);
      } else {
        k.pane.setFillStyle(0x2a3344);
        k.glow.setAlpha(0);
        k.lamp.setFillStyle(0xd6453c);
      }
    }
  }

  private clearMoving() {
    this.proj.clear();
    this.ground.clear();
    this.enemy.clear();
    this.telegraph.clear();
    this.corruption.draw(this.st, 0, this.roomPoint());
  }

  destroy() {
    for (const f of this.fixed) f.obj.destroy();
    for (const f of this.boardFixed) f.obj.destroy();
    this.fixed = [];
    this.boardFixed = [];
    this.proj.clear();
    this.ground.clear();
    this.enemy.clear();
    this.telegraph.clear();
    this.corruption.destroy();
    // the boxes themselves, or every rebuild left an empty container behind
    this.box?.destroy();
    this.over?.destroy();
    this.box = null;
    this.over = null;
  }
}
