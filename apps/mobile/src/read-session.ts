// Reading is opt-in. A blur/cancel invalidates pending native callbacks before cleanup.
export function createReadSession(options: {
  read(): Promise<string>;
  cancel(): Promise<void>;
  onUrl(url: string): void;
  onError(error: unknown): void;
  onReading(reading: boolean): void;
}) {
  let active = false;
  let reading = false;
  let generation = 0;
  let pending: Promise<void> | undefined;
  function cancel() {
    generation++;
    reading = false;
    options.onReading(false);
    void options.cancel().catch(() => undefined);
  }
  return {
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      cancel();
    },
    cancel,
    async start() {
      if (!active || reading) return;
      const current = ++generation;
      reading = true;
      options.onReading(true);
      const previous = pending;
      const task = (async () => {
        try {
          // A cancelled native read must finish its finally/cleanup before a retry starts.
          if (previous) await previous;
          if (!active || current !== generation) return;
          const url = await options.read();
          if (active && current === generation) options.onUrl(url);
        } catch (error) {
          if (active && current === generation) options.onError(error);
        } finally {
          if (current === generation) {
            reading = false;
            options.onReading(false);
          }
        }
      })();
      pending = task;
      await task;
      if (pending === task) pending = undefined;
    },
  };
}
