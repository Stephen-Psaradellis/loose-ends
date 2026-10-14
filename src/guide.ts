// Loose Ends - the first-five-minutes guide. One short line at a time on the
// caption strip, each waiting for the viewer to actually do the thing (First
// Five Minutes: "teaches controller-free interaction without a wall of text").
// Pure logic; the scene reports what happened and shows what this returns.

export type GuideEvent = 'select' | 'send' | 'capture' | 'done';

export const GUIDE_STEPS: readonly { waitFor: GuideEvent; text: string }[] = [
  { waitFor: 'select', text: 'Welcome. Pick a card: pinch it, click it, or just look at it.' },
  { waitFor: 'send', text: 'Nice. Now look down at the three trays and pinch one, or look at it.' },
  { waitFor: 'capture', text: "Tap or look at the orb on your right, then say what's on your mind." },
  { waitFor: 'done', text: 'Sort the rest the same way. Finished? Done for tonight is on your left.' },
];

export class Guide {
  constructor(public step = 0) {}

  get active(): boolean {
    return this.step < GUIDE_STEPS.length;
  }

  /** The line to show now, or null once the guide is over. */
  get text(): string | null {
    return this.active ? GUIDE_STEPS[this.step].text : null;
  }

  /**
   * Report something the viewer did. Doing a later step early (dragging a card
   * straight into a tray) skips ahead past it. Returns true when the guide moved.
   */
  on(event: GuideEvent): boolean {
    if (!this.active) return false;
    for (let i = this.step; i < GUIDE_STEPS.length; i++) {
      if (GUIDE_STEPS[i].waitFor === event) {
        this.step = i + 1;
        return true;
      }
    }
    return false;
  }

  skip(): void {
    this.step = GUIDE_STEPS.length;
  }

  restart(): void {
    this.step = 0;
  }
}
