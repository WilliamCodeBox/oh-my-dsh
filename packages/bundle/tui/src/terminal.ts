/**
 * Terminal lifecycle for the TUI front door: raw-mode ownership, synchronous
 * restoration on exit and crash paths, and the Ctrl+C key state machine. All
 * terminal effects flow through an injectable device so unit tests run
 * without a TTY.
 * @module @deepseek-ai/dsh-tui/terminal
 */

/** Injectable terminal device (production: `process.stdin`). */
export interface TerminalDevice {
  readonly isTTY: boolean
  setRawMode(raw: boolean): void
}

/**
 * Owns raw-mode state and its synchronous restore. Raw mode turns Ctrl+C into
 * input byte 0x03 (cfmakeraw clears ISIG), so the launcher's SIGINT chain
 * never sees a user's Ctrl+C; this session is the TUI's own terminal handle.
 */
export class TerminalSession {
  private raw = false

  constructor(private readonly device: TerminalDevice) {}

  /** Enter raw mode; no-op when the device is not a TTY or already raw. */
  enter(): void {
    if (!this.device.isTTY || this.raw) return
    this.device.setRawMode(true)
    this.raw = true
  }

  /** Leave raw mode. Synchronous so crash and dispose paths can run it last. */
  restore(): void {
    if (!this.raw) return
    this.device.setRawMode(false)
    this.raw = false
  }

  /** Whether raw mode is currently active. */
  get active(): boolean {
    return this.raw
  }
}

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
 * - a press with an empty line while idle quits;
 * - a second empty-line press inside the window force-exits (the hang escape).
 *
 * The refined policy (cancel then graceful 130 quit) lands with the keymap in
 * a later milestone; the window semantics here are the skeleton.
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
 * Install a crash handler that synchronously restores the terminal before
 * reporting the failure. Without it an uncaught exception leaves termios in
 * raw mode and the user's shell unusable.
 * @param restore - synchronous terminal restoration.
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
