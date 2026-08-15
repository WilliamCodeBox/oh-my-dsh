/**
 * Terminal lifecycle for the TUI front door: the Ctrl+C key state machine and
 * the crash-restore handler. Raw-mode and alternate-screen ownership moved to
 * the pi-tui presenter with the renderer milestone; these helpers drive the
 * presenter's stop path and classify user Ctrl+C presses.
 * @module @deepseek-ai/dsh-tui/terminal
 */

/** Ctrl+C press outcomes from {@link CtrlCController.press}. */
export type CtrlCAction = 'hard-exit' | 'cancel' | 'clear-input' | 'quit'

/**
 * The Ctrl+C key state machine. In raw mode Ctrl+C is input byte 0x03, never
 * a signal, so the launcher's "second Ctrl+C force-exits" chain is a cooked
 * window and external-signal safety net only; this machine is the TUI's own
 * escape hatch:
 *
 * - a press with a non-empty input line clears the line and does NOT arm the
 *   force-exit window (typing is not a hang);
 * - a press with an empty line cancels a running turn;
 * - a press with an empty line while idle quits gracefully — the runner exits
 *   130, the SIGINT convention code, through the normal shutdown path
 *   (presenter stop, flush, terminal restore), never the crash hard-exit;
 * - a second empty-line press inside the window force-exits (the hang escape).
 */
export class CtrlCController {
  private lastPress = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 2000,
  ) {}

  /**
   * Classify one Ctrl+C press.
   * @param turnRunning - whether the agent has an active turn.
   * @param inputEmpty - whether the input line is empty.
   * @returns the action the caller should take.
   */
  press(turnRunning: boolean, inputEmpty: boolean): CtrlCAction {
    const t = this.now()
    if (!inputEmpty) {
      // Typing is not a hang: clear the line and disarm any armed window.
      this.lastPress = 0
      return 'clear-input'
    }
    const withinWindow = this.lastPress !== 0 && t - this.lastPress <= this.windowMs
    this.lastPress = t
    if (withinWindow) return 'hard-exit'
    if (turnRunning) return 'cancel'
    return 'quit'
  }
}

/** An emitter that can host the crash handler (production: `process`). */
export interface CrashEmitter {
  on(event: 'uncaughtException', listener: (error: unknown) => void): unknown
  off(event: 'uncaughtException', listener: (error: unknown) => void): unknown
}

/**
 * Install a crash handler that synchronously stops the presenter (restoring
 * raw mode and the alternate screen) before reporting the failure. Without it
 * an uncaught exception leaves the user's shell unusable.
 * @param restore - synchronous presenter stop; must be safe to call when no
 *   presenter is active.
 * @param crash - process-level failure reporting (forced exit).
 * @param emitter - host emitter; defaults to `process`.
 * @returns the disposer that removes the handler.
 */
export function installCrashRestore(
  restore: () => void,
  crash: (code: number) => void,
  emitter: CrashEmitter = process,
): () => void {
  const handler = (): void => {
    restore()
    crash(1)
  }
  emitter.on('uncaughtException', handler)
  return () => emitter.off('uncaughtException', handler)
}
