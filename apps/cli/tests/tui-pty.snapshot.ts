/**
 * The `omd --profile tui` PTY case: boots the real profile composition (base +
 * tui bundle) under a POSIX pseudo-terminal, drives raw keys through the
 * presenter, and asserts the terminal journey — typed input rendered, a
 * keyless follow-up turn, the /ledger record view with its detail overlay
 * (open, tab-switch, close), clean Ctrl+C quit, and alternate-screen restore.
 * Runs in the keyless snapshot gate; the POSIX python driver self-allocates
 * the PTY (CI has no TTY of its own).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@williamcodebox/omd-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * POSIX PTY driver: forks the app into a pty, collects its output, sends each
 * action's payload after its marker renders (or its delay elapses), and
 * reports the collected output plus the app's exit code. Exit-code and
 * marker-completion mismatches fail the driver so the test asserts on real
 * process behavior, not a timeout kill.
 */
const POSIX_TUI_PTY_DRIVER = String.raw`
import errno, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time
node, launch_args_json, launch_env_json, cwd, actions_json, expected_exit, timeout_seconds = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(launch_env_json))
env.update({"COLUMNS": "100", "LINES": "30"})
# A developer shell's COLORTERM=truecolor changes pi-tui rendering (truecolor
# SGR vs palette fallback); pin the palette for stable assertions.
env.pop("COLORTERM", None)
actions = json.loads(actions_json)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(launch_args_json)], env)

# The themed presenter wraps styled cells in per-character SGR, so a literal
# waitFor like the editor border never appears as raw bytes; match markers
# against the ANSI-stripped transcript, keep the raw stream for byte asserts.
ansi_re = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
output = bytearray()
deadline = time.monotonic() + float(timeout_seconds)
status = None
for action in actions:
    if "waitFor" in action:
        while time.monotonic() < deadline and action["waitFor"].encode() not in ansi_re.sub("", output.decode("utf-8", "replace")).encode():
            ready, _, _ = select.select([fd], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if chunk:
                    output.extend(chunk)
            waited, candidate = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                status = candidate
                break
        if action["waitFor"].encode() not in ansi_re.sub("", output.decode("utf-8", "replace")).encode():
            sys.stderr.write(f"marker {action['waitFor']!r} never appeared\n")
            sys.exit(124)
    if "resize" in action:
        size = action["resize"]
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", size["rows"], size["cols"], 0, 0))
        os.kill(pid, signal.SIGWINCH)
    if "delayMs" in action:
        deadline_slice = time.monotonic() + action["delayMs"] / 1000
        while time.monotonic() < deadline_slice:
            ready, _, _ = select.select([fd], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if chunk:
                    output.extend(chunk)
            waited, candidate = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                status = candidate
                break
        if status is not None:
            break
    if "send" in action and status is None:
        os.write(fd, action["send"].encode())

while status is None and time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    sys.stderr.write("app did not exit before the deadline\n")
    sys.exit(126)
sys.stdout.buffer.write(output)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != int(expected_exit):
    sys.stderr.write(f"expected exit {expected_exit}, got {actual_exit}\n")
    sys.exit(125)
`

interface TuiPtyAction {
  /** Send `send` after this text renders. */
  readonly waitFor?: string
  /** Resize the pty and signal SIGWINCH. */
  readonly resize?: { readonly cols: number; readonly rows: number }
  /** Send `send` after this many milliseconds instead of a marker. */
  readonly delayMs?: number
  readonly send?: string
}

/** Run the tui profile under a PTY and return its collected output. */
async function runTuiPtySmoke(
  actions: readonly TuiPtyAction[],
  expectedExitCode: number,
  timeoutMs = LOADER_SMOKE_TEST_TIMEOUT_MS,
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tui-pty-smoke-'))
  try {
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['--profile', 'tui'],
      tsconfigPath,
      env: {
        // The boot never calls the model: the smoke types, submits a keyless
        // follow-up whose turn fails fast, then quits. The key satisfies any
        // provider config that insists on its presence.
        DEEPSEEK_API_KEY: 'keyless-tui-smoke',
        DSH_HOME: join(cwd, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    const result = await execa('python3', [
      '-c',
      POSIX_TUI_PTY_DRIVER,
      launch.command,
      JSON.stringify(launch.args),
      JSON.stringify(launch.env),
      cwd,
      JSON.stringify(actions),
      String(expectedExitCode),
      String(timeoutMs / 1000),
    ], {
      stdin: 'ignore',
      timeout: timeoutMs + 10_000,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) {
      throw new Error(`tui PTY driver did not exit. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    if (result.failed) {
      throw new Error(`tui PTY driver exited ${String(result.exitCode)}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    return result.stdout
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('tui profile PTY case (real Loader tree in a PTY)', () => {
  it(
    'boots the presenter, renders typed input, survives a keyless turn, and quits with the terminal restored',
    async () => {
      const output = await runTuiPtySmoke([
        // The editor's top border renders once the presenter owns the screen.
        { waitFor: '──', send: 'hello' },
        // The editor renders the typed line; Enter submits the follow-up.
        { waitFor: 'hello', send: '\r' },
        // A terminal resize must re-layout without corrupting the surface.
        { resize: { cols: 120, rows: 40 } },
        // Give the keyless turn time to fail fast and settle, then quit on an
        // empty, idle prompt. Idle Ctrl+C confirms on the first press and
        // quits on the second (exit 130, SIGINT convention) through the
        // normal shutdown path.
        { delayMs: 9000, send: '\x03' },
        { send: '\x03' },
      ], 130, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)
      // Source-mode boots of the full base+tui tree are slow on developer
      // machines (tsx import graph), so the PTY driver gets double the default
      // process budget before its marker/deadline logic trips.
      expect(output).toContain('hello')
      // The alternate screen was restored on quit.
      expect(output).toContain('\u001b[?1049l')
      // No fatal load or runner error text reached the terminal.
      expect(output).not.toContain('omd: ')
    },
    2 * LOADER_SMOKE_TEST_TIMEOUT_MS,
  )

  it(
    'opens the ledger from /ledger, shows a cell detail overlay, switches tabs, and Escs back to the editor',
    async () => {
      const output = await runTuiPtySmoke([
        // The editor's top border renders once the presenter owns the screen.
        { waitFor: '──', send: 'hello' },
        // The editor renders the typed line; Enter submits the keyless turn.
        { waitFor: 'hello', send: '\r' },
        // Give the keyless turn time to fail fast and settle, then open the
        // ledger; the submitted user message folded into the first user row.
        { delayMs: 9000, send: '/ledger\r' },
        // The ledger header renders with its record count; Enter opens the
        // focused user cell's detail overlay.
        { waitFor: 'ledger · ', send: '\r' },
        // The overlay title names the cell; Tab switches to the next tab.
        { waitFor: 'User #1', send: '\t' },
        // The active-tab marker moved; Esc closes the overlay, then the
        // ledger. Space the Esc presses so the terminal parser delivers two
        // distinct keys and each close settles before the next action.
        { waitFor: '▸Preview', send: '\x1b' },
        { delayMs: 500, send: '\x1b' },
        // Back on the idle editor: confirm the quit, then quit (exit 130).
        { delayMs: 500, send: '\x03' },
        { send: '\x03' },
      ], 130, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)
      // The ledger opened with the submitted user message as the focused row.
      expect(output).toContain('ledger · ')
      // Enter opened the detail overlay over that row.
      expect(output).toContain('User #1')
      // Tab switched the active tab to Preview.
      expect(output).toContain('▸Preview')
      // The alternate screen was restored on quit.
      expect(output).toContain('\u001b[?1049l')
      // No fatal load or runner error text reached the terminal.
      expect(output).not.toContain('omd: ')
    },
    2 * LOADER_SMOKE_TEST_TIMEOUT_MS,
  )
})
