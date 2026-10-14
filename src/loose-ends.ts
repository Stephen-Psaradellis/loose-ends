import {
  BoxGeometry,
  CanvasTexture,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MovementMode,
  OneHandGrabbable,
  CircleGeometry,
  Object3D,
  PlaneGeometry,
  Pressed,
  Raycaster,
  RayInteractable,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  type Entity,
  type Intersection,
} from '@iwsdk/core';
import { Dwell } from './dwell.js';
import { loadSort, saveSort, Sort, TRAYS, trayAt, type Card, type TrayId } from './sort.js';
import { CardTag, TrayTag } from './sort-components.js';

// Seated layout, metres. The viewer's head sits near (0, 1.2-1.6, 0) facing -z.
const TRAY_Y = 0.95;
const TRAY_Z = -0.5;
const TRAY_GAP = 0.36;
const TRAY_W = 0.3;
const TRAY_D = 0.22;
const CARD_W = 0.2;
const CARD_H = 0.1;
const LOOSE_Y = 1.3;
const LOOSE_Z = -0.62;
const DRAG_MIN = 0.06;
const DWELL_SECONDS = 1.2;
/** A pinch on a card the gaze just selected confirms it rather than toggling it off. */
const GAZE_GRACE = 1.0;
const DEMO_CARDS = ['Call the dentist', 'Reply to Sam about Saturday', 'Fix the bike light'];

const TRAY_COLORS: Record<TrayId, string> = {
  tomorrow: '#e8b04a',
  week: '#5fa8d3',
  letgo: '#8a7f99',
};

function textTexture(text: string, bg: string, fg: string, w = 512, h = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 28);
  g.fill();
  g.fillStyle = fg;
  g.font = '600 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Greedy wrap to at most three lines.
  const words = text.split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > w - 60 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  shown.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (shown.length - 1) / 2) * 54));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class LooseEndsSystem extends createSystem({
  cards: { required: [CardTag] },
  heldCards: { required: [CardTag, Grabbed] },
  pressedCards: { required: [CardTag, Pressed] },
  pressedTrays: { required: [TrayTag, Pressed] },
}) {
  sort!: Sort;
  private cardEntities = new Map<number, Entity>();
  /** Head-gaze dwell: every action reachable by looking alone (Accessibility Forward). */
  gazeDwell = true;
  private dwell = new Dwell(DWELL_SECONDS);
  // A head ray is not something RayInteractable models (IWSDK's GazeSystem needs an
  // eye-tracked transient pointer, which Quest Browser does not expose), so this one
  // Raycaster is the exception to the "no manual Raycaster" rule.
  private ray = new Raycaster();
  private gazeTargets: Object3D[] = [];
  private gazeKeys = new Map<Object3D, string>();
  private hits: Intersection[] = [];
  private head = new Vector3();
  private dir = new Vector3();
  private reticle = new Object3D();
  private reticleFill!: Mesh;
  private selectedBy: 'gaze' | 'hand' = 'hand';
  private selectedAt = 0;
  private now = 0;
  private trayCentres: { id: TrayId; x: number; z: number }[] = [];
  private selected: number | null = null;
  private tmp = new Vector3();
  private home = new Map<number, Vector3>();
  /** Last input events, newest last; read in the emulator to debug input paths. */
  readonly trace: string[] = [];

  private note(s: string): void {
    this.trace.push(s);
    if (this.trace.length > 30) this.trace.shift();
  }

  init(): void {
    TRAYS.forEach((tray, i) => {
      const x = (i - 1) * TRAY_GAP;
      const box = new Mesh(
        new BoxGeometry(TRAY_W, 0.03, TRAY_D),
        new MeshStandardMaterial({ color: TRAY_COLORS[tray.id], roughness: 0.8 }),
      );
      box.position.set(x, TRAY_Y, TRAY_Z);
      const label = new Mesh(
        new PlaneGeometry(TRAY_W, TRAY_W / 4),
        new MeshBasicMaterial({
          map: textTexture(tray.label, 'rgba(0,0,0,0)', '#f4efe6', 512, 128),
          transparent: true,
        }),
      );
      label.position.set(0, 0.07, TRAY_D / 2);
      label.rotation.x = -0.5;
      // Rays hit the tray box, never its floating label.
      label.raycast = () => {};
      box.add(label);
      const e = this.world.createTransformEntity(box);
      e.addComponent(TrayTag, { trayIndex: i });
      e.addComponent(RayInteractable);
      this.trayCentres.push({ id: tray.id, x, z: TRAY_Z });
      this.gazeTargets.push(box);
      this.gazeKeys.set(box, `tray:${tray.id}`);
    });

    // Last evening's sort comes back; a first visit gets three example cards.
    const saved = loadSort(globalThis.localStorage);
    this.sort = saved ?? new Sort();
    if (saved) saved.cards.forEach((c) => this.spawn(c));
    else DEMO_CARDS.forEach((text) => this.addCard(text));
    this.layout();

    // Gaze reticle: an outline ring with a disc that fills as the dwell completes.
    const ring = new Mesh(
      new RingGeometry(0.011, 0.014, 32),
      new MeshBasicMaterial({ color: '#f4efe6', transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.reticleFill = new Mesh(
      new CircleGeometry(0.011, 32),
      new MeshBasicMaterial({ color: '#e8b04a', transparent: true, opacity: 0.9, depthTest: false }),
    );
    ring.renderOrder = this.reticleFill.renderOrder = 10;
    this.reticle.add(ring, this.reticleFill);
    this.reticle.visible = false;
    this.world.createTransformEntity(this.reticle);

    // Pinch-drag path: a card released over a tray goes in it; anywhere else it floats back.
    this.queries.heldCards.subscribe('disqualify', (entity) => {
      const id = entity.getValue(CardTag, 'cardId') as number;
      entity.object3D!.getWorldPosition(this.tmp);
      this.note(`release ${id} ${this.tmp.x.toFixed(2)},${this.tmp.y.toFixed(2)},${this.tmp.z.toFixed(2)}`);
      // A pinch or click that barely moved the card is a select, not a drop.
      const home = this.home.get(id);
      if (home && home.distanceTo(this.tmp) < DRAG_MIN) {
        this.layout();
        return;
      }
      const tray = trayAt(this.tmp.x, this.tmp.z, this.trayCentres, TRAY_W / 2 + 0.03, TRAY_D / 2 + 0.08);
      if (tray && Math.abs(this.tmp.y - TRAY_Y) < 0.3) this.sort.send(id, tray);
      this.selected = null;
      this.layout();
    });

    // Select-then-tray path (rays and mouse today; gaze dwell and voice drive the same calls).
    this.queries.pressedCards.subscribe('qualify', (entity) => {
      const id = entity.getValue(CardTag, 'cardId') as number;
      this.note(`press card ${id}`);
      // Looking at a card then pinching it is one intent, not select-then-deselect.
      const confirming =
        this.selected === id && this.selectedBy === 'gaze' && this.now - this.selectedAt < GAZE_GRACE;
      if (!confirming) this.select(id);
    });
    this.queries.pressedTrays.subscribe('qualify', (entity) => {
      const tray = TRAYS[entity.getValue(TrayTag, 'trayIndex') as number].id;
      this.note(`press tray ${tray} sel=${this.selected}`);
      if (this.selected != null) {
        this.sort.send(this.selected, tray);
        this.selected = null;
        this.layout();
      }
    });
  }

  addCard(text: string): void {
    this.spawn(this.sort.add(text));
  }

  private spawn(card: Card): void {
    const mesh = new Mesh(
      new PlaneGeometry(CARD_W, CARD_H),
      new MeshBasicMaterial({ map: textTexture(card.text, '#f4efe6', '#26222b') }),
    );
    const e = this.world.createTransformEntity(mesh);
    e.addComponent(CardTag, { cardId: card.id });
    e.addComponent(RayInteractable);
    e.addComponent(OneHandGrabbable, { rotate: false });
    e.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
      rotate: false,
      scale: false,
    });
    this.cardEntities.set(card.id, e);
    this.gazeKeys.set(mesh, `card:${card.id}`);
  }

  select(id: number, by: 'gaze' | 'hand' = 'hand'): void {
    this.selected = by === 'hand' && this.selected === id ? null : id;
    this.selectedBy = by;
    this.selectedAt = this.now;
    this.layout();
  }

  update(delta: number): void {
    this.now += delta;
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    // On a flat screen the camera never moves, so dwell would just pick the middle card.
    if (!this.gazeDwell || !inXR || this.queries.heldCards.entities.size > 0) {
      this.reticle.visible = false;
      this.dwell.reset();
      return;
    }
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.dir);
    this.ray.set(this.head, this.dir);
    this.hits.length = 0;
    this.ray.intersectObjects(this.gazeTargets, false, this.hits);
    const hit = this.hits[0];
    const key = hit ? (this.gazeKeys.get(hit.object) ?? null) : null;
    const fired = this.dwell.update(key, delta);
    if (hit) {
      this.reticle.visible = true;
      this.reticle.position.copy(hit.point).addScaledVector(this.dir, -0.005);
      this.reticle.lookAt(this.head);
      this.reticleFill.scale.setScalar(Math.max(0.001, this.dwell.progress));
    } else {
      this.reticle.visible = false;
    }
    if (!fired) return;
    this.note(`gaze ${fired}`);
    const [kind, value] = fired.split(':');
    if (kind === 'card') {
      this.select(Number(value), 'gaze');
    } else if (this.selected != null) {
      const id = this.selected;
      this.selected = null;
      this.send(id, value as TrayId);
    }
  }

  send(id: number, tray: TrayId | null): void {
    this.sort.send(id, tray);
    this.layout();
  }

  undo(): void {
    this.sort.undo();
    this.layout();
  }

  private remember(id: number, p: Vector3): void {
    const v = this.home.get(id);
    if (v) v.copy(p);
    else this.home.set(id, p.clone());
  }

  /** Put every card where the model says it lives, and keep what the evening sorted. */
  layout(): void {
    saveSort(this.sort, globalThis.localStorage);
    // Only loose cards and the trays are gaze targets; a card already in a tray is done.
    this.gazeTargets.length = TRAYS.length;
    const loose = this.sort.loose;
    for (const card of loose) this.gazeTargets.push(this.cardEntities.get(card.id)!.object3D!);
    loose.forEach((card, i) => {
      const o = this.cardEntities.get(card.id)!.object3D!;
      const x = (i - (loose.length - 1) / 2) * (CARD_W + 0.03);
      const lift = card.id === this.selected ? 0.04 : 0;
      o.position.set(x, LOOSE_Y + lift, LOOSE_Z + Math.abs(x) * 0.25);
      o.rotation.set(0, -x * 0.6, 0);
      o.scale.setScalar(card.id === this.selected ? 1.12 : 1);
      this.remember(card.id, o.position);
    });
    TRAYS.forEach((tray, t) => {
      this.sort.inTray(tray.id).forEach((card, i) => {
        const o = this.cardEntities.get(card.id)!.object3D!;
        o.position.set((t - 1) * TRAY_GAP, TRAY_Y + 0.02 + i * 0.006, TRAY_Z - 0.02 + i * 0.01);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.setScalar(0.9);
        this.remember(card.id, o.position);
      });
    });
  }
}
