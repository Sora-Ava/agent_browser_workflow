export class RunControl {
  readonly controller = new AbortController();
  private requested = false;
  private wake: (() => void) | undefined;
  private refresh = false;
  status = "running";
  constructor(
    private readonly onState: (state: string) => void,
    private readonly onResume?: () => Promise<void>,
  ) {}
  get signal() {
    return this.controller.signal;
  }
  private publish(state: string) {
    this.status = state;
    this.onState(state);
  }
  pause() {
    if (!this.signal.aborted && !this.requested) {
      this.requested = true;
      this.publish("pausing");
    }
  }
  resume() {
    if (this.requested) {
      this.requested = false;
      this.refresh = true;
      this.wake?.();
      this.publish("running");
    }
  }
  cancel() {
    this.controller.abort();
    this.wake?.();
  }
  async checkpoint() {
    for (;;) {
      this.signal.throwIfAborted();
      while (this.requested) {
        this.publish("paused");
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
        this.signal.throwIfAborted();
      }
      if (this.refresh) {
        this.refresh = false;
        await this.onResume?.();
      }
      this.signal.throwIfAborted();
      if (!this.requested) return;
    }
  }
}
