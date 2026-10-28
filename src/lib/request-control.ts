/** Per-component request lifecycle: obsolete results can never replace current data. */
export function createRequestGate() {
  let active: AbortController | null = null;
  return {
    start(background = false) {
      if (background && active) return null;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      return {
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted,
        finish() {
          if (active === controller) active = null;
        },
      };
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}

/** Group related row events without postponing updates indefinitely during a busy import. */
export function createRefreshBatcher(refresh: () => void, delay = 150) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, delay);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
