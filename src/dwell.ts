// Head-gaze dwell: look at a thing long enough and it is "pressed". Pure logic,
// so the frame loop feeds it whatever the head ray hits and tests can pin it.

export class Dwell {
  private key: string | null = null;
  private held = 0;
  private fired = false;

  constructor(readonly seconds = 1.2) {}

  /** Progress toward firing on the current target, 0..1 (0 once it has fired). */
  get progress(): number {
    return this.fired || this.key == null ? 0 : Math.min(1, this.held / this.seconds);
  }

  get target(): string | null {
    return this.key;
  }

  /**
   * Feed the target under the head ray this frame. Returns the target's key on
   * the one frame its dwell completes; it will not fire again until the gaze
   * leaves it and comes back.
   */
  update(key: string | null, dt: number): string | null {
    if (key !== this.key) {
      this.key = key;
      this.held = 0;
      this.fired = false;
    }
    if (key == null || this.fired) return null;
    this.held += dt;
    if (this.held >= this.seconds) {
      this.fired = true;
      return key;
    }
    return null;
  }

  /** Forget the current target, e.g. after the scene changed under it. */
  reset(): void {
    this.key = null;
    this.held = 0;
    this.fired = false;
  }
}
