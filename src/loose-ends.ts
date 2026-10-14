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
  PlaneGeometry,
  Pressed,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
  type Entity,
} from '@iwsdk/core';
import { Sort, TRAYS, trayAt, type TrayId } from './sort.js';
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
  readonly sort = new Sort();
  private cardEntities = new Map<number, Entity>();
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
    });

    for (const text of ['Call the dentist', 'Reply to Sam about Saturday', 'Fix the bike light']) {
      this.addCard(text);
    }
    this.layout();

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
      this.note(`press card ${entity.getValue(CardTag, 'cardId')}`);
      this.select(entity.getValue(CardTag, 'cardId') as number);
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
    const card = this.sort.add(text);
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
  }

  select(id: number): void {
    this.selected = this.selected === id ? null : id;
    this.layout();
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

  /** Put every card where the model says it lives. */
  layout(): void {
    const loose = this.sort.loose;
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
