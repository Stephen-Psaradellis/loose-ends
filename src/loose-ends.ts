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
  CircleGeometry,
  CylinderGeometry,
  Object3D,
  PlaneGeometry,
  Pressed,
  Raycaster,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  type Entity,
  type Intersection,
} from '@iwsdk/core';
import { Dwell } from './dwell.js';
import { loadGarden, localDay, MAX_LEAVES, saveGarden, type Garden } from './garden.js';
import { Guide, GUIDE_STEPS, type GuideEvent } from './guide.js';
import { Mic, type MicState } from './mic.js';
import { HeightFit, loadPrefs, rowMax, savePrefs, trayLayout, type PrefChange, type PrefKey, type Prefs } from './prefs.js';
import { loadSort, saveSort, Sort, TRAYS, trayAt, type Card, type Rollover, type TrayId } from './sort.js';
import { ButtonTag, CardTag, MicTag, TrayTag } from './sort-components.js';
import { Sounds } from './sound.js';
import { Speaker } from './speak.js';
import { parseUtterance } from './voice.js';

// Seated layout, metres. The viewer's head sits near (0, 1.2-1.6, 0) facing -z.
const TRAY_Y = 0.95;
const TRAY_Z = -0.5;
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
const MIC_POS = [0.62, 1.12, -0.5] as const;
const CAPTION_Y = 1.5;
const CAPTION_W = 0.9;
const CAPTION_H = (CAPTION_W * 192) / 1024;
const PROMPT = "Say what's on your mind - tap the orb, or look at it.";
const REVIEW_PROMPT = (n: number) =>
  `Welcome back. Yesterday's plan is on the desk (${n}). Which happened? Pick one, then 'It happened' - or say it.`;
const HELP =
  "Say a thought to add it. Or: 'dentist to tomorrow', 'sort them for me', 'undo', 'settings', 'I'm done'.";
type Action = 'accept' | 'undo' | 'done' | 'settings' | 'close' | `pref:${PrefKey}`;
/** Buttons left of the trays: every voice command also has a pinch and a gaze target. */
const BUTTONS: readonly { action: Action; label: string; y: number }[] = [
  { action: 'accept', label: 'Sort as suggested', y: 1.38 },
  { action: 'settings', label: 'Settings', y: 1.27 },
  { action: 'undo', label: 'Undo', y: 1.16 },
  { action: 'done', label: 'Done for tonight', y: 1.05 },
];
const BUTTON_X = -0.62;
/** The settings panel replaces the loose cards while open: 3 rows of 3, all three inputs. */
const PANEL: readonly Action[] = [
  'pref:text', 'pref:contrast', 'pref:bright',
  'pref:hand', 'pref:turn', 'pref:dwell',
  'pref:gaze', 'pref:sound', 'close',
];
const PANEL_W = 0.22;
const ALL_BUTTONS: readonly Action[] = [...BUTTONS.map((b) => b.action), ...PANEL];
/** Theme colours [background, text, outline] per surface; high contrast is pure black/white/yellow. */
const THEMES = {
  soft: { card: ['#f4efe6', '#26222b', ''], button: ['#3a3442', '#f4efe6', ''], caption: ['rgba(20,18,26,0.75)', '#f4efe6', ''] },
  contrast: { card: ['#000000', '#ffffff', '#ffffff'], button: ['#000000', '#ffe600', '#ffe600'], caption: ['#000000', '#ffffff', ''] },
} as const;
type Surface = keyof (typeof THEMES)['soft'];
const NO_RAY = () => {};
const PLANT_POS = [0.8, 0.9, -0.66] as const;
const DEMO_CARDS = ['Call the dentist', 'Reply to Sam about Saturday', 'Fix the bike light'];

/** Suggestion footers: the tray colours, darkened to read on the cream card. */
const REVIEW_COLOR = '#2f7a3a';
const HINT_COLORS: Record<TrayId, string> = {
  tomorrow: '#9a6a0c',
  week: '#24648c',
  letgo: '#5d5270',
};

const TRAY_COLORS: Record<TrayId, string> = {
  tomorrow: '#e8b04a',
  week: '#5fa8d3',
  letgo: '#8a7f99',
};

function textTexture(
  text: string,
  bg: string,
  fg: string,
  w = 512,
  h = 256,
  outline = '',
  foot: { text: string; color: string } | null = null,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 28);
  g.fill();
  if (outline) {
    g.strokeStyle = outline;
    g.lineWidth = 8;
    g.stroke();
  }
  g.fillStyle = fg;
  g.font = `${outline ? 700 : 600} 44px system-ui, sans-serif`;
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
  // A footer (the assistant's suggestion) takes the bottom band, so the text keeps two lines.
  const shown = lines.slice(0, foot ? 2 : 3);
  const mid = foot ? h / 2 - 24 : h / 2;
  shown.forEach((l, i) => g.fillText(l, w / 2, mid + (i - (shown.length - 1) / 2) * 54));
  if (foot) {
    g.fillStyle = foot.color;
    g.font = `${outline ? 700 : 600} 34px system-ui, sans-serif`;
    g.fillText(foot.text, w / 2, h - 42);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class LooseEndsSystem extends createSystem({
  cards: { required: [CardTag] },
  heldCards: { required: [CardTag, Grabbed] },
  pressedCards: { required: [CardTag, Pressed] },
  pressedTrays: { required: [TrayTag, Pressed] },
  pressedMic: { required: [MicTag, Pressed] },
  pressedButtons: { required: [ButtonTag, Pressed] },
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
  /** Parent of every placed object; lifted once per XR session to the viewer's head height. */
  private root!: Entity;
  private heightFit = new HeightFit();
  /** Last input events, newest last; read in the emulator to debug input paths. */
  readonly trace: string[] = [];
  mic!: Mic;
  private orb!: Mesh;
  private caption!: Mesh;
  private captionText = '';
  /** Orb and buttons: gaze targets that never leave, unlike loose cards. */
  private fixedTargets: Object3D[] = [];
  garden!: Garden;
  private leafMeshes: Mesh[] = [];
  private flower!: Mesh;
  prefs!: Prefs;
  readonly sounds = new Sounds();
  readonly speaker = new Speaker();
  guide!: Guide;
  panelOpen = false;
  private buttonMeshes = new Map<Action, Mesh>();
  /** The hint each card was last painted with, so layout repaints only when one appears or goes. */
  private paintedHint = new Map<number, TrayId | 'review' | null>();
  /** Whether the Accept button currently reads 'It happened'. */
  private reviewShown = false;
  private opened: Rollover = { review: 0, released: 0 };
  /** Plan cards checked off tonight; an undo takes one back. */
  private checked = new Set<number>();
  private panelTargets: Object3D[] = [];
  private trayBoxes: Mesh[] = [];
  private rays = new WeakMap<Object3D, Object3D['raycast']>();

  private theme(surface: Surface): readonly [string, string, string] {
    return THEMES[this.prefs.contrast ? 'contrast' : 'soft'][surface];
  }

  /** Show or hide a mesh for eyes AND rays: a hidden button must not take a pinch. */
  private setLive(o: Object3D, on: boolean): void {
    o.visible = on;
    if (!on && o.raycast !== NO_RAY) {
      this.rays.set(o, o.raycast);
      o.raycast = NO_RAY;
    } else if (on && o.raycast === NO_RAY) {
      o.raycast = this.rays.get(o) ?? Mesh.prototype.raycast;
    }
  }

  private buttonLabel(action: Action): string {
    if (action.startsWith('pref:')) return this.prefs.label(action.slice(5) as PrefKey);
    if (action === 'close') return 'Close settings';
    // While yesterday's plan is on the desk, the suggestion button answers it instead.
    if (action === 'accept' && this.reviewShown) return 'It happened';
    return BUTTONS.find((b) => b.action === action)!.label;
  }

  private paintButton(action: Action): void {
    const m = this.buttonMeshes.get(action)!.material as MeshBasicMaterial;
    const [bg, fg, line] = this.theme('button');
    m.map?.dispose();
    m.map = textTexture(this.buttonLabel(action), bg, fg, 512, 192, line);
    m.needsUpdate = true;
  }

  private paintCard(id: number): void {
    const card = this.sort.get(id);
    const mesh = this.cardEntities.get(id)?.object3D as Mesh | undefined;
    if (!card || !mesh) return;
    const m = mesh.material as MeshBasicMaterial;
    const [bg, fg, line] = this.theme('card');
    const hint = card.tray === null && card.hint ? card.hint : null;
    const foot = card.review
      ? { text: "yesterday's plan - happened?", color: line ? '#ffe600' : REVIEW_COLOR }
      : hint
        ? { text: `suggest: ${TRAYS.find((t) => t.id === hint)!.label}`, color: line ? '#ffe600' : HINT_COLORS[hint] }
        : null;
    m.map?.dispose();
    m.map = textTexture(card.text, bg, fg, 512, 256, line, foot);
    m.needsUpdate = true;
    this.paintedHint.set(id, card.review ? 'review' : hint);
  }

  /** One setting changed, from any input: apply it everywhere and say so. */
  changePref(change: PrefChange): void {
    const said = this.prefs.apply(change);
    savePrefs(this.prefs, globalThis.localStorage);
    this.applyPrefs();
    this.say(said);
  }

  private applyPrefs(): void {
    this.gazeDwell = this.prefs.gaze;
    this.sounds.enabled = this.prefs.sound;
    if (this.dwell.seconds !== this.prefs.dwell) this.dwell = new Dwell(this.prefs.dwell);
    const { shift, gap } = trayLayout(this.prefs.hand);
    this.trayBoxes.forEach((box, i) => {
      box.position.x = (i - 1) * gap + shift;
      this.trayCentres[i].x = box.position.x;
    });
    // Rotating the root turns the whole desk around the viewer; drops are read in root space.
    this.root.object3D!.rotation.y = (-this.prefs.turn * Math.PI) / 180;
    this.sort.cards.forEach((c) => this.paintCard(c.id));
    ALL_BUTTONS.forEach((a) => this.paintButton(a));
    const text = this.captionText;
    this.captionText = '';
    if (text) this.say(text);
    this.layout();
  }

  setPanel(open: boolean): void {
    this.panelOpen = open;
    this.selected = null;
    this.panelTargets.forEach((o) => this.setLive(o, open));
    this.say(open ? 'Settings: pinch, look at, or say any of these.' : (this.guide.text ?? PROMPT));
    this.layout();
  }

  /** Tell the guide what just happened; it takes the caption while it is running. */
  private guideEvent(event: GuideEvent): void {
    if (!this.guide.on(event)) return;
    if (this.guide.active) this.say(this.guide.text!);
    else {
      this.prefs.guided = true;
      savePrefs(this.prefs, globalThis.localStorage);
    }
  }

  private note(s: string): void {
    this.trace.push(s);
    if (this.trace.length > 30) this.trace.shift();
  }

  init(): void {
    this.root = this.world.createTransformEntity();
    this.prefs = loadPrefs(globalThis.localStorage);
    this.guide = new Guide(this.prefs.guided ? GUIDE_STEPS.length : 0);
    TRAYS.forEach((tray, i) => {
      const x = (i - 1) * trayLayout('both').gap;
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
      const e = this.world.createTransformEntity(box, { parent: this.root });
      e.addComponent(TrayTag, { trayIndex: i });
      e.addComponent(RayInteractable);
      this.trayCentres.push({ id: tray.id, x, z: TRAY_Z });
      this.trayBoxes.push(box);
      this.gazeTargets.push(box);
      this.gazeKeys.set(box, `tray:${tray.id}`);
    });

    // Last evening's sort comes back; a first visit gets three example cards.
    const saved = loadSort(globalThis.localStorage);
    this.sort = saved ?? new Sort();
    // A new evening after a Done: yesterday's Tomorrow comes back to check off, let-go cards are gone.
    this.opened = this.sort.rollover(localDay());
    if (this.opened.review || this.opened.released) this.note(`rollover review=${this.opened.review} released=${this.opened.released}`);
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

    // Voice: the orb starts and stops a clip; the caption says what was heard (always
    // captioned, so voice is never the only channel - Accessibility Forward).
    this.orb = new Mesh(
      new SphereGeometry(0.045, 24, 16),
      new MeshStandardMaterial({ color: '#e8b04a', emissive: '#3a2a10', roughness: 0.4 }),
    );
    this.orb.position.set(...MIC_POS);
    const orbEntity = this.world.createTransformEntity(this.orb, { parent: this.root });
    orbEntity.addComponent(MicTag);
    orbEntity.addComponent(RayInteractable);
    this.gazeKeys.set(this.orb, 'mic');
    this.fixedTargets.push(this.orb);
    ALL_BUTTONS.forEach((action, i) => {
      const inPanel = i >= BUTTONS.length;
      const w = inPanel ? PANEL_W : 0.2;
      const mesh = new Mesh(new PlaneGeometry(w, (w * 192) / 512), new MeshBasicMaterial());
      if (inPanel) {
        const k = i - BUTTONS.length;
        mesh.position.set(((k % 3) - 1) * (PANEL_W + 0.03), 1.4 - Math.floor(k / 3) * 0.11, LOOSE_Z);
        this.panelTargets.push(mesh);
      } else {
        mesh.position.set(BUTTON_X, BUTTONS[i].y, TRAY_Z);
        mesh.rotation.y = 0.45;
        this.fixedTargets.push(mesh);
      }
      const e = this.world.createTransformEntity(mesh, { parent: this.root });
      e.addComponent(ButtonTag, { action: i });
      e.addComponent(RayInteractable);
      // Turning gaze off by gaze would strand a gaze-only user, so that one button takes no dwell.
      if (action !== 'pref:gaze') this.gazeKeys.set(mesh, `btn:${action}`);
      this.buttonMeshes.set(action, mesh);
      this.paintButton(action);
    });
    this.panelTargets.forEach((o) => this.setLive(o, false));
    this.queries.pressedButtons.subscribe('qualify', (entity) => {
      const action = ALL_BUTTONS[entity.getValue(ButtonTag, 'action') as number];
      this.note(`press btn ${action}`);
      this.press(action);
    });
    this.buildPlant();
    this.layout();
    this.caption = new Mesh(new PlaneGeometry(CAPTION_W, CAPTION_H), new MeshBasicMaterial({ transparent: true }));
    this.caption.position.set(0, CAPTION_Y, LOOSE_Z - 0.05);
    this.caption.raycast = () => {};
    this.world.createTransformEntity(this.caption, { parent: this.root });
    this.applyPrefs();
    this.say(this.guide.text ?? (this.opened.review ? REVIEW_PROMPT(this.opened.review) : PROMPT));
    this.mic = new Mic(
      (text, cards) => this.hear(text, cards),
      (state, detail) => this.micState(state, detail),
    );
    this.queries.pressedMic.subscribe('qualify', () => {
      this.note('press mic');
      this.mic.toggle();
    });

    // Pinch-drag path: a card released over a tray goes in it; anywhere else it floats back.
    this.queries.heldCards.subscribe('disqualify', (entity) => {
      const id = entity.getValue(CardTag, 'cardId') as number;
      // Root-local, like the tray centres and homes, so a lifted scene drops the same.
      this.root.object3D!.worldToLocal(entity.object3D!.getWorldPosition(this.tmp));
      this.note(`release ${id} ${this.tmp.x.toFixed(2)},${this.tmp.y.toFixed(2)},${this.tmp.z.toFixed(2)}`);
      // A pinch or click that barely moved the card is a select, not a drop.
      const home = this.home.get(id);
      if (home && home.distanceTo(this.tmp) < DRAG_MIN) {
        this.layout();
        return;
      }
      const tray = trayAt(this.tmp.x, this.tmp.z, this.trayCentres, TRAY_W / 2 + 0.03, TRAY_D / 2 + 0.08);
      this.selected = null;
      if (tray && Math.abs(this.tmp.y - TRAY_Y) < 0.3) this.send(id, tray);
      else this.layout();
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
        const id = this.selected;
        this.selected = null;
        this.send(id, tray);
      }
    });
  }

  /** Show a line on the caption strip (and speak it aloud when asked). */
  say(text: string, speak = false): void {
    if (text === this.captionText) return;
    this.captionText = text;
    const m = this.caption.material as MeshBasicMaterial;
    m.map?.dispose();
    const [bg, fg] = this.theme('caption');
    m.map = textTexture(text, bg, fg, 1024, 192);
    m.needsUpdate = true;
    // The browser's voice when it has one, else our Worker's (Quest Browser documents none).
    if (speak) void this.speaker.speak(text).then((r) => this.note(`speak ${r}`));
  }

  private micState(state: MicState, detail?: string): void {
    this.note(`mic ${state}`);
    const m = this.orb.material as MeshStandardMaterial;
    m.emissive.set(state === 'listening' ? '#c0392b' : state === 'thinking' ? '#5fa8d3' : '#3a2a10');
    if (state === 'listening') this.sounds.play('listen');
    else if (state === 'thinking') this.sounds.play('heard');
    if (state === 'listening') this.say('Listening... tap or look at the orb again when you are done.');
    else if (state === 'thinking') this.say('Writing that down...');
    else if (state === 'error') this.say(detail ?? 'Voice did not work - pinch or look instead.');
  }

  /** One transcript in: a command on the sort, or new cards. Same calls as hands and gaze. */
  hear(transcript: string, aiCards?: unknown): void {
    const u = parseUtterance(transcript, this.sort.cards, aiCards);
    this.note(`hear ${u.kind}`);
    const name = (id: number) => this.sort.get(id)?.text ?? '';
    switch (u.kind) {
      case 'undo':
      case 'done':
        this.act(u.kind);
        break;
      case 'select':
        this.select(u.cardId);
        this.say(this.sort.get(u.cardId)?.review ? `${name(u.cardId)} - did it happen?` : `${name(u.cardId)} - which tray?`);
        break;
      case 'move':
        this.selected = null;
        this.say(`${name(u.cardId)} -> ${TRAYS.find((t) => t.id === u.tray)!.label}`);
        this.send(u.cardId, u.tray);
        break;
      case 'tray': {
        const label = TRAYS.find((t) => t.id === u.tray)!.label;
        if (this.selected == null) {
          this.say(`Which card goes to ${label}? Say its name, look at it, or pinch it.`);
          break;
        }
        const id = this.selected;
        this.selected = null;
        this.say(`${name(id)} -> ${label}`);
        this.send(id, u.tray);
        break;
      }
      case 'capture': {
        u.cards.forEach((c) => this.addCard(c.text, c.trayHint));
        this.layout();
        const added = u.cards.length === 1 ? `Added: ${u.cards[0].text}.` : `Added ${u.cards.length} cards.`;
        const hinted = u.cards.filter((c) => c.trayHint).length;
        this.say(hinted ? `${added} I marked where ${hinted === 1 ? 'it' : 'they'} might go - say 'sort them for me' if that looks right.` : added);
        this.guideEvent('capture');
        break;
      }
      case 'accept':
        this.acceptHints();
        break;
      case 'checkoff':
        this.checkOff(u.cardId ?? this.selected);
        break;
      case 'pref':
        this.changePref(u.change);
        break;
      case 'settings':
        this.setPanel(u.open);
        break;
      case 'help':
        this.say(HELP);
        break;
      case 'skip':
        this.guide.skip();
        this.prefs.guided = true;
        savePrefs(this.prefs, globalThis.localStorage);
        this.say(PROMPT);
        break;
      default:
        this.say("Didn't catch that - try again.");
    }
  }

  /** Any button, from a pinch, a click or a gaze dwell. */
  press(action: Action): void {
    if (action === 'accept') {
      if (this.sort.reviewing.length) this.checkOff(this.selected);
      else this.acceptHints();
    } else if (action === 'undo' || action === 'done') this.act(action);
    else if (action === 'settings') this.setPanel(!this.panelOpen);
    else if (action === 'close') this.setPanel(false);
    else this.changePref({ key: action.slice(5) as PrefKey, cycle: true });
  }

  /** Undo and Done: the same call from voice, a pinch on the button, or a gaze dwell. */
  act(action: 'undo' | 'done'): void {
    if (action === 'undo') {
      const back = this.sort.undoAll();
      back.forEach((c) => this.checked.delete(c.id));
      this.layout();
      this.sounds.play(back.length ? 'undo' : 'nothing');
      this.say(back.length > 1 ? `Undone: ${back.length} cards are loose again.` : back[0] ? `Undone: ${back[0].text}` : 'Nothing to undo.');
      return;
    }
    // Done answers the plan too: whatever was not checked off stays on the desk.
    const carried = this.sort.endReview().length;
    this.sort.close(localDay());
    this.layout();
    const grew = this.garden.close(localDay());
    this.sounds.play('done');
    if (grew) this.sounds.play('leaf', 0.7);
    saveGarden(this.garden, globalThis.localStorage);
    this.showPlant();
    const t = this.sort.inTray('tomorrow').map((c) => c.text);
    const plan = t.length
      ? `Tomorrow: ${t.slice(0, 3).join(', ')}${t.length > 3 ? '...' : ''}.`
      : 'Nothing for tomorrow.';
    const kept = carried ? ` ${carried} from yesterday stay on the desk.` : '';
    this.say(`${plan}${kept} ${grew ? 'Your plant grew a leaf.' : 'Rest well.'}`, true);
    this.guideEvent('done');
  }

  /** A pot with every leaf built up front; showPlant reveals one per closed evening. */
  private buildPlant(): void {
    this.garden = loadGarden(globalThis.localStorage);
    const pot = new Mesh(
      new CylinderGeometry(0.05, 0.038, 0.07, 20),
      new MeshStandardMaterial({ color: '#b5653b', roughness: 0.9 }),
    );
    pot.position.set(...PLANT_POS);
    const stem = new Mesh(
      new CylinderGeometry(0.004, 0.005, 0.2, 6),
      new MeshStandardMaterial({ color: '#4f7a3a' }),
    );
    stem.position.y = 0.035;
    stem.geometry.translate(0, 0.1, 0);
    pot.add(stem);
    const leafMat = new MeshStandardMaterial({ color: '#6aa84f', roughness: 0.7 });
    for (let i = 0; i < MAX_LEAVES; i++) {
      const leaf = new Mesh(new SphereGeometry(0.022, 10, 6), leafMat);
      leaf.scale.set(1, 0.25, 0.55);
      const a = i * 2.4;
      const h = 0.05 + i * 0.014;
      leaf.position.set(Math.cos(a) * 0.024, h, Math.sin(a) * 0.024);
      leaf.rotation.y = -a;
      pot.add(leaf);
      this.leafMeshes.push(leaf);
    }
    this.flower = new Mesh(
      new SphereGeometry(0.016, 12, 8),
      new MeshStandardMaterial({ color: '#e8b04a', emissive: '#3a2a10' }),
    );
    this.flower.position.y = 0.24;
    pot.add(this.flower);
    pot.traverse((o) => (o.raycast = () => {}));
    this.world.createTransformEntity(pot, { parent: this.root });
    this.showPlant();
  }

  private showPlant(): void {
    this.leafMeshes.forEach((leaf, i) => (leaf.visible = i < this.garden.leaves));
    this.flower.visible = this.garden.flowering;
    // The stem reaches just past the newest leaf.
    const stem = this.flower.parent!.children[0];
    stem.scale.y = Math.max(0.15, (0.07 + this.garden.leaves * 0.014) / 0.2);
  }

  /** "It happened", from a pinch on the button, a look at it, or a phrase: the plan card leaves the desk. */
  checkOff(id: number | null): void {
    const card = id == null ? undefined : this.sort.checkOff(id);
    if (!card) {
      this.sounds.play('nothing');
      this.say(id == null ? "Pick one of yesterday's cards first - pinch it, look at it, or say its name." : "That one was not on yesterday's plan.");
      return;
    }
    this.selected = null;
    this.checked.add(card.id);
    this.layout();
    this.sounds.play('check');
    const left = this.sort.reviewing.length;
    this.say(
      left
        ? `Done: ${card.text}. ${left} more from yesterday.`
        : `Done: ${card.text}. That's yesterday answered - ${this.checked.size} happened. What's on your mind tonight?`,
    );
  }

  addCard(text: string, hint: TrayId | null = null): void {
    this.spawn(this.sort.add(text, hint));
  }

  /** The assistant proposes, the user disposes: one act (pinch, voice or a look) takes every suggestion, one Undo reverses it. */
  acceptHints(): void {
    const moved = this.sort.acceptHints();
    if (!moved.length) {
      this.sounds.play('nothing');
      this.say('No suggestions on the desk right now.');
      return;
    }
    this.selected = null;
    this.layout();
    this.sounds.play(moved[0].tray ?? 'loose');
    const counts = TRAYS.map((t) => [t.label, moved.filter((c) => c.tray === t.id).length] as const).filter(([, n]) => n);
    this.say(`Sorted ${counts.map(([label, n]) => `${n} to ${label}`).join(', ')}. Undo puts them back.`);
    this.guideEvent('send');
  }

  private spawn(card: Card): void {
    const mesh = new Mesh(new PlaneGeometry(CARD_W, CARD_H), new MeshBasicMaterial());
    const e = this.world.createTransformEntity(mesh, { parent: this.root });
    e.addComponent(CardTag, { cardId: card.id });
    e.addComponent(RayInteractable);
    // Ray grab only. With OneHandGrabbable as well, GrabSystem builds the proximity
    // handle first (pointerEventsType deny 'ray') and then skips the distance one, so a
    // pointed pinch never reached a card - only trays and buttons answered a hand ray.
    e.addComponent(DistanceGrabbable, {
      movementMode: MovementMode.MoveFromTarget,
      rotate: false,
      scale: false,
    });
    this.cardEntities.set(card.id, e);
    this.gazeKeys.set(mesh, `card:${card.id}`);
    this.paintCard(card.id);
  }

  select(id: number, by: 'gaze' | 'hand' = 'hand'): void {
    this.selected = by === 'hand' && this.selected === id ? null : id;
    this.selectedBy = by;
    this.selectedAt = this.now;
    this.layout();
    if (this.selected != null) {
      this.sounds.play('select');
      this.guideEvent('select');
    }
  }

  /** Seated layout, any viewer: lift the scene by head height - 1.2 m (HeightFit says when). */
  private fitHeight(inXR: boolean, delta: number): void {
    if (!inXR) {
      if (this.heightFit.lift) this.root.object3D!.position.y = 0;
      this.heightFit.reset();
      return;
    }
    this.camera.getWorldPosition(this.head);
    const lift = this.heightFit.update(delta, this.head.y, this.queries.heldCards.entities.size > 0);
    if (lift == null) return;
    this.root.object3D!.position.y = lift;
    this.note(`lift ${lift.toFixed(2)} head ${this.head.y.toFixed(2)}`);
  }

  update(delta: number): void {
    this.now += delta;
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.fitHeight(inXR, delta);
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
    if (kind === 'mic') {
      this.mic.toggle();
    } else if (kind === 'btn') {
      this.press(fired.slice(4) as Action);
    } else if (kind === 'card') {
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
    this.sounds.play(tray ?? 'loose');
    if (tray) this.guideEvent('send');
  }

  undo(): void {
    this.sort.undoAll();
    this.layout();
  }

  private remember(id: number, p: Vector3): void {
    const v = this.home.get(id);
    if (v) v.copy(p);
    else this.home.set(id, p.clone());
  }

  /** Put every card where the model says it lives, and keep what the evening sorted. */
  /** Scale every surface colour by the brightness setting; each material keeps its own base colour. */
  private dim(): void {
    const b = this.prefs.bright;
    this.root.object3D!.traverse((o) => {
      const mats = (o as Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        const c = (m as MeshBasicMaterial).color;
        if (!c) continue;
        const base = (m.userData.base ??= c.clone()) as typeof c;
        c.copy(base).multiplyScalar(b);
      }
    });
  }

  layout(): void {
    saveSort(this.sort, globalThis.localStorage);
    // A suggestion shows only while its card is loose.
    for (const c of this.sort.cards) {
      const want = c.review ? 'review' : c.tray === null ? c.hint : null;
      if ((this.paintedHint.get(c.id) ?? null) !== want) this.paintCard(c.id);
    }
    // A checked-off card keeps its entity (undo can bring it back) but leaves the scene.
    for (const [id, e] of this.cardEntities) {
      const here = this.sort.get(id) !== undefined;
      e.object3D!.visible = here;
      if (!here) this.setLive(e.object3D!, false);
    }
    const reviewing = this.sort.reviewing.length > 0;
    if (reviewing !== this.reviewShown && this.buttonMeshes.has('accept')) {
      this.reviewShown = reviewing;
      this.paintButton('accept');
    }
    // Only loose cards and the trays are gaze targets; a card already in a tray is done.
    this.gazeTargets.length = TRAYS.length;
    this.gazeTargets.push(...this.fixedTargets);
    // The open settings panel takes the loose cards' place (and their rays).
    if (this.panelOpen) this.gazeTargets.push(...this.panelTargets);
    const loose = this.sort.loose;
    for (const card of loose) {
      const o = this.cardEntities.get(card.id)!.object3D!;
      this.setLive(o, !this.panelOpen);
      if (!this.panelOpen) this.gazeTargets.push(o);
    }
    // Rows stacking upward, fewer per row as text grows, so a long ramble stays within arm's reach.
    const ts = this.prefs.text;
    const perRow = rowMax(ts);
    const rowH = CARD_H * ts + 0.03;
    // Big text starts lower so a second row stays near eye height for a seated viewer.
    const baseY = LOOSE_Y - (ts - 1) * 0.1;
    loose.forEach((card, i) => {
      const o = this.cardEntities.get(card.id)!.object3D!;
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, loose.length - row * perRow);
      const x = ((i % perRow) - (inRow - 1) / 2) * (CARD_W * ts + 0.03);
      const lift = card.id === this.selected ? 0.04 : 0;
      o.position.set(x, baseY + row * rowH + lift, LOOSE_Z + Math.abs(x) * 0.25);
      o.rotation.set(0, -x * 0.6, 0);
      o.scale.setScalar(ts * (card.id === this.selected ? 1.12 : 1));
      this.remember(card.id, o.position);
    });
    // The caption scales with the text and rides just above the top row.
    const rows = this.panelOpen ? 1 : Math.max(1, Math.ceil(loose.length / perRow));
    const top = baseY + (rows - 1) * rowH + (CARD_H * ts) / 2 + 0.07;
    if (this.caption) {
      this.caption.scale.setScalar(ts);
      this.caption.position.y = Math.max(CAPTION_Y, top + (CAPTION_H * ts) / 2);
    }
    TRAYS.forEach((tray, t) => {
      this.sort.inTray(tray.id).forEach((card, i) => {
        const o = this.cardEntities.get(card.id)!.object3D!;
        this.setLive(o, true);
        o.position.set(this.trayCentres[t].x, TRAY_Y + 0.02 + i * 0.006, TRAY_Z - 0.02 + i * 0.01);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.setScalar(0.9);
        this.remember(card.id, o.position);
      });
    });
    this.dim();
  }
}
