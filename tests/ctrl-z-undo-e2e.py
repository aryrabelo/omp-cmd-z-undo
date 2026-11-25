"""End-to-end check against the installed omp, in a real pty.

Starts omp twice with a throwaway agent directory (default profile, setup
wizard skipped with Esc), types "hello world" and presses Ctrl+Z:

- control, no keybindings.yml: omp must suspend itself (state T);
- with this repo's keybindings.yml: omp must keep running and the draft
  must shrink (undo), as seen by tests/observer.ts.

Run: python3 -I tests/ctrl-z-undo-e2e.py
"""

import fcntl
import json
import os
import pty
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBSERVER = os.path.join(REPO, "tests", "observer.ts")
TYPED = "hello world"


def drain(fd: int, seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                os.read(fd, 65536)
            except OSError:
                return


def state(pid: int) -> str:
    return subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()


def run(with_keybindings: bool) -> tuple[str, list[dict[str, str]]]:
    work = tempfile.mkdtemp(prefix="cmdz-e2e-")
    agent = os.path.join(work, "agent")
    os.mkdir(agent)
    if with_keybindings:
        shutil.copy(os.path.join(REPO, "keybindings.yml"), agent)
    log = os.path.join(work, "observer.log")
    open(log, "w").close()
    env = {**os.environ, "OMP_PROFILE": "", "PI_PROFILE": "", "PI_CODING_AGENT_DIR": agent, "CMDZ_OBSERVER_LOG": log}
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(work)
        os.execvpe("omp", ["omp", "--no-extensions", "-e", OBSERVER], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 160, 0, 0))
    try:
        drain(fd, 12)
        for _ in range(8):
            os.write(fd, b"\x1b")
            drain(fd, 1.5)
        os.write(fd, TYPED.encode())
        drain(fd, 1.5)
        os.write(fd, b"\x1a")
        drain(fd, 2)
        after = state(pid)
        if "T" not in after:
            os.write(fd, b"Q")
            drain(fd, 1.5)
        with open(log) as handle:
            keys = [json.loads(line) for line in handle if line.strip()]
        return after, keys
    finally:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        shutil.rmtree(work, ignore_errors=True)


failures = 0


def ck(name: str, ok: bool) -> None:
    global failures
    if not ok:
        failures += 1
    print(f"{'  ok  ' if ok else '  FAIL'} {name}")


control_state, _ = run(with_keybindings=False)
ck(f"control: default omp suspends on Ctrl+Z (state {control_state!r})", "T" in control_state)

fixed_state, keys = run(with_keybindings=True)
ck(f"keybindings.yml: omp keeps running after Ctrl+Z (state {fixed_state!r})", fixed_state != "" and "T" not in fixed_state)
ids = [key["id"] for key in keys]
ck("keybindings.yml: Ctrl+Z reaches the composer", "ctrl+z" in ids)
if "ctrl+z" in ids:
    index = ids.index("ctrl+z")
    before = keys[index]["text"]
    after = keys[index + 1]["text"] if index + 1 < len(keys) else None
    print(f"         draft before Ctrl+Z: {before!r}, after: {after!r}")
    ck("keybindings.yml: draft before Ctrl+Z is what was typed", before == TYPED)
    ck("keybindings.yml: Ctrl+Z undid part of the draft", after is not None and after != TYPED and TYPED.startswith(after))

print("ALL OK" if failures == 0 else f"{failures} FAILURE(S)")
sys.exit(0 if failures == 0 else 1)
