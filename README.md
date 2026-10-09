# omp-cmd-z-undo

An [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) extension that makes
**Ctrl+Z undo what you typed in the prompt composer** instead of suspending the
process. **Cmd+Z** works too, when your terminal delivers it.

omp already has an undo stack in its editor, bound to `ctrl+-` / `ctrl+_`.
`ctrl+z` goes to `app.suspend`. This extension changes only that routing:

- adds `ctrl+z` and `super+z` to `tui.editor.undo`;
- removes `ctrl+z` from the composer actions that claimed it (`app.suspend` by
  default, or whatever you remapped it to);
- changes the keybindings **in memory**. It never writes `keybindings.yml`;
- lets the editor's own undo do the work. It keeps no second text stack and
  touches no private fields.

It does nothing outside the interactive TUI (print, RPC, ACP, subagents).

## Install

```sh
omp plugin install github:aryrabelo/omp-cmd-z-undo
```

Or link the single file into your extensions directory:

```sh
git clone https://github.com/aryrabelo/omp-cmd-z-undo
ln -s "$PWD/omp-cmd-z-undo/src/cmd-z-undo.ts" ~/.omp/agent/extensions/cmd-z-undo.ts
```

Named profiles have their own base: also link into
`~/.omp/profiles/<name>/agent/extensions/`.

## Cmd+Z and your terminal

Cmd+Z only reaches omp if the terminal sends it as `super+z` (Kitty keyboard
protocol), and many terminals keep the key for themselves. **Ghostty binds
`super+z` to its own undo (reopen closed tab/split) by default**, so the key
never arrives. The most portable fix is to make the terminal send the
`Ctrl+_` byte, which is undo in omp, Claude Code, and zsh/readline alike, and
works without the extension or Kitty protocol:

```
# ~/.config/ghostty/config
keybind = super+z=text:\x1f
```

The trade-off is losing Ghostty's own "undo close tab".

## Limits

- No redo: omp's editor has no redo API.
- Undo granularity is the editor's own.
- `setEditorComponent` is a single slot. This extension wraps the factory that
  was installed before it, but an extension loaded later that replaces the
  editor without reading `getEditorComponent()` wins.
- Keybindings are global per action name. If you had `ctrl+z` on
  `app.tools.expand`, `app.editor.external` or `app.message.copy`, it is also
  removed from the other surface that reuses that action.
- Extensions run in-process with omp's privileges. Read the source (one file,
  no dependencies) before installing.

The design notes, with sources, are in
[`docs/research.pt-BR.md`](docs/research.pt-BR.md) (Portuguese).

## Test

```sh
bun tests/cmd-z-undo-check.ts
```

## License

MIT
