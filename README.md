# omp-cmd-z-undo

Make **Ctrl+Z undo what you typed in the [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi)
prompt composer** instead of suspending the process. **Cmd+Z** works too, when
your terminal delivers it.

Since omp 19.2.0 this is two lines of `keybindings.yml`, not an extension.

## Install

Merge [`keybindings.yml`](keybindings.yml) into `~/.omp/agent/keybindings.yml`:

```yaml
app.suspend: []
tui.editor.undo: [Ctrl+-, Ctrl+_, Ctrl+Z, Super+Z]
```

- `app.suspend: []` frees Ctrl+Z; omp no longer suspends to the shell.
- `tui.editor.undo` keeps omp's default undo keys (`Ctrl+-`, `Ctrl+_`) and adds
  Ctrl+Z and Cmd+Z. The editor's own undo does the work, with its own
  granularity.
- Named profiles load the default profile's `keybindings.yml` first and override
  it action by action, so this file covers them unless a profile rebinds one of
  these two actions.
- If you bound Ctrl+Z to another `app.*` action, remove it there too: the
  composer checks app actions before editor undo.

## Why not an extension anymore

Versions up to 0.1.0 shipped an extension that swapped the editor through
`ctx.ui.setEditorComponent`. omp 19.2.0 removed that API; the extension now
fails to load with `ctx.ui.setEditorComponent is not a function`.

Its replacement, `ctx.ui.composer.addKeyHandler`, cannot take Ctrl+Z: omp's own
composer handler is registered first, matches `app.suspend` and suspends the
process before extension handlers run. The handler also gets no way to call the
editor's undo. Measured on omp 19.2.0 in a raw pty: a handler returning `true`
for `ctrl+z` never received the key, and the process stopped.

If you linked `src/cmd-z-undo.ts` into `~/.omp/agent/extensions/` (or a
profile's), remove that link.

## Cmd+Z and your terminal

Cmd+Z only reaches omp if the terminal sends it as `super+z` (Kitty keyboard
protocol), and many terminals keep the key for themselves. **Ghostty binds
`super+z` to its own undo (reopen closed tab/split) by default**, so the key
never arrives. The most portable fix is to make the terminal send the
`Ctrl+_` byte, which is undo in omp, Claude Code, and zsh/readline alike, and
works without Kitty protocol:

```
# ~/.config/ghostty/config
keybind = super+z=text:\x1f
```

The trade-off is losing Ghostty's own "undo close tab".

## Limits

- No redo: omp's editor has no redo binding.
- Ctrl+Z no longer suspends omp anywhere.

The design notes, with sources, are in
[`docs/research.pt-BR.md`](docs/research.pt-BR.md) (Portuguese).

## Test

Needs `omp` on `PATH`. Runs omp in a pty with a throwaway agent directory,
types, presses Ctrl+Z, and checks both the default (suspends) and this config
(undoes, keeps running):

```sh
python3 -I tests/ctrl-z-undo-e2e.py
```

## License

MIT
