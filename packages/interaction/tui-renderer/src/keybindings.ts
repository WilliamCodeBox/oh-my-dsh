/**
 * Keybinding registry for the omd TUI: named bindings map raw key data
 * (as delivered by the presenter's input listener) to handlers, with a
 * description for help surfaces. The runner registers its bindings once and
 * dispatches every raw key through the registry, instead of growing nested
 * escape-sequence comparisons in the input loop.
 *
 * @module @williamcodebox/omd-tui-renderer
 */

/** One registered keybinding. */
export interface Keybinding {
  /** Raw key data that triggers the binding (e.g. `\x1b[5~` for PgUp). */
  readonly key: string
  /** Short human-readable description shown in the help overlay. */
  readonly description: string
  /** Runs when the key is pressed; return false to let later bindings see it. */
  readonly handler: () => boolean | void
}

/** Ordered keybinding registry with dispatch and help listing. */
export class KeybindingRegistry {
  private readonly bindings: Keybinding[] = []

  /** Register one binding; later registrations of the same key win. */
  register(binding: Keybinding): void {
    this.bindings.push(binding)
  }

  /** Registered bindings in registration order, for the help overlay. */
  list(): readonly Keybinding[] {
    return this.bindings
  }

  /**
   * Dispatch one raw key to matching bindings (last registered first).
   * @param data - the raw key string from the presenter input listener.
   * @returns true when a binding consumed the key.
   */
  dispatch(data: string): boolean {
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const binding = this.bindings[i]!
      if (binding.key !== data) continue
      if (binding.handler() !== false) return true
    }
    return false
  }
}
