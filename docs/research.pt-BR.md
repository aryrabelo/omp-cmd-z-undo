# Pesquisa: undo do composer do OMP

**Escopo.** O objetivo é desfazer texto apagado enquanto o usuário edita o prompt interativo (composer), com `Ctrl+Z` e `Cmd+Z` (`super+z`). Isto não é undo de arquivo, worktree ou sessão. Também não é redo: o editor do OMP expõe o binding `tui.editor.undo`, mas não há binding ou API `redo` na superfície atual.

## Evidência oficial do runtime

- A documentação de extensões define uma factory default export, recebe `ExtensionAPI` e pode registrar eventos e ações. A API de UI documenta `ctx.ui.setEditorComponent(factory)`; a factory recebe `(tui, theme, keybindings)` e deve devolver um `CustomEditor`.
  - [Authoring Extensions](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md)
  - [Extension API, `setEditorComponent`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)
  - [Extension runtime docs](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
- A implementação de `InteractiveMode.setEditorComponent` chama a factory com o TUI, tema e `KeybindingsManager`; se não há factory, constrói o `CustomEditor` integrado. Ela instala o editor no composer e reconfigura os handlers interativos.
  - [InteractiveMode](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/modes/interactive-mode.ts)
- O manager público de bindings fornece `getUserBindings()` e `setUserBindings()`. O remapeamento escolhido usa essa superfície em memória, copiando o mapa existente: preserva bindings do usuário e altera somente as claims necessárias para `app.suspend` e `tui.editor.undo`.
  - [TUI `KeybindingsManager`](https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/keybindings.ts)

## O que acontece com as teclas

1. **Undo nativo.** O código upstream consultado define `tui.editor.undo` com `ctrl+-` e `ctrl+_`; o runtime OMP-family ativo observado (`@earendil-works/pi-tui` 0.84.4) usa `ctrl+-`. Em ambos os casos, esses são defaults do binding de undo, não `ctrl+z`.
2. **Conflito atual.** `app.suspend` tem default `ctrl+z`; por isso `Ctrl+Z` chega ao suspend em vez do editor.
3. **Remap local escolhido.** A factory do plugin remove somente `ctrl+z` das teclas resolvidas de `app.suspend` e adiciona `ctrl+z` e `super+z` às teclas resolvidas de `tui.editor.undo`. O mapa é instalado apenas no `KeybindingsManager` usado pela factory ativa; não grava `keybindings.yml` nem muda configuração persistida.
4. **O editor recebe o evento.** Em vez de copiar snapshots ou chamar `setEditorText`, o plugin deixa o `CustomEditor` base processar o binding `tui.editor.undo`. No upstream atual isso passa por `kb.matchesCanonical(...)` e `#applyUndo()`; no runtime OMP-family ativo, o equivalente usa `kb.matches(...)` e `undo()`. Ambos restauram estado de cursor e texto da pilha privada do editor, mantendo a semântica nativa.
   - [Defaults do TUI](https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/keybindings.ts)
   - [Dispatch e pilha privada do editor](https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/components/editor.ts)
   - [Defaults de `app.suspend`](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/config/keybindings.ts)

A extensão não usa `registerShortcut("ctrl+z")`: a documentação de authoring lista `ctrl+z` entre os atalhos reservados, junto com outros chords de propriedade do app. Portanto, registrar esse chord como shortcut de extensão é rejeitado/ignorado pelo contrato do runtime; não é uma forma válida de roubar a tecla do suspend.

## Cmd (`super`) e o terminal

`super` representa a tecla Command no macOS. O protocolo de teclado Kitty define `super` como bit próprio (máscara `8`) e descreve Command como o equivalente macOS dessa tecla. O OMP consulta `CSI ?u`; quando o terminal responde, ativa o protocolo Kitty para receber sequências de teclas modificadas. Sem essa negociação, terminais legados podem não emitir uma sequência distinguível para `Cmd+Z`, então `super+z` não é uma garantia universal. O remap continua seguro: em terminais que não entregam esse evento, nenhum undo será disparado por esse chord.

- [Especificação Kitty: modifiers e `super`](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#modifiers)
- [Parser de teclas do OMP](https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/keys.ts)
- [Negociação do protocolo no OMP](https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/terminal.ts)

## Preservação de factory e limites

O plugin deve envolver a factory customizada já exposta pelo runtime, quando houver uma, para não substituir silenciosamente outro editor. Quando o runtime não expuser uma factory reaproveitável, a alternativa é construir o `pi.pi.CustomEditor` injetado pelo OMP com os argumentos fornecidos pela factory (`tui`, `theme`, `keybindings`). A extensão é um no-op fora de TUI; em print, RPC, ACP e subagentes não há composer interativo a remapear.

O plugin garante apenas:

- remap em memória, restrito à instância/factory ativa;
- `Ctrl+Z` e, quando o terminal entregar a sequência, `Cmd+Z` encaminhados para o undo nativo do editor;
- demais bindings existentes preservados, salvo a remoção intencional de `ctrl+z` (comparado sem diferenciar maiúsculas/minúsculas, igual ao `matchesKey` do runtime) das ações efetivamente despachadas pelo `CustomEditor` do composer — o conjunto finito registrado via `.onAction(...)` em `interactive-mode.js:2302-2320` mais os dois casos especiais (`app.interrupt`, `app.exit`) e o `app.clipboard.pasteImage` sempre checado — não só `app.suspend` default, mas qualquer remapeamento do usuário para outra ação DESSE conjunto. Ações `app.*` de componentes não relacionados (`app.tree.*`, `app.session.togglePath`/`toggleSort`/`rename`/`delete*`, `app.models.*`, ver `core/keybindings.js:81-169`) nunca são tocadas, mesmo que o usuário tenha `ctrl+z` remapeado para elas — o composer nunca despacha essas ações, então remover ali quebraria um binding alheio sem ganho nenhum de undo.

O plugin não garante:

- que a remoção de `ctrl+z` fique restrita ao composer: o keybindings manager indexa por nome de ação, não por par `(ação, componente)`. Três das ações da lista finita são reaproveitadas por outra superfície: `app.tools.expand` (também `extension-selector.js`), `app.editor.external` (também `extension-editor.js`) e `app.message.copy` (também o "copy" do `tree-selector.js`, linha ~876). Um usuário com `ctrl+z` mapeado numa dessas três ações perde o chord também nessa outra superfície — é limitação do modelo de keybinding global do runtime, não algo que este plugin possa restringir mais;

- redo, porque não existe API de redo no editor atual;
- funcionamento de `Cmd+Z` em terminal que não negocie/entregue `super` pelo protocolo Kitty;
- undo de arquivos, sessões ou histórico de conversas;
- preservação de uma factory cujo runtime não a torna observável;
- persistência da alteração em arquivo de configuração;
- sobrevivência do remap se uma extensão carregada DEPOIS desta chamar `setEditorComponent` sem antes ler `ctx.ui.getEditorComponent()`. `setEditorComponent` é um slot único no runtime: quem chama por último decide o editor ativo. Esta extensão preserva a factory que já estava instalada quando ela roda, mas não tem como obrigar uma extensão posterior a fazer o mesmo — é limitação da API do runtime, não deste plugin.

## Prior art

- **[Baylar55/omp-undo-redo](https://github.com/Baylar55/omp-undo-redo)** — extensão MIT (`[LICENSE](https://github.com/Baylar55/omp-undo-redo/blob/main/LICENSE)`) para `/undo` e `/redo` de sessão e arquivo. O README descreve snapshots Git e repositório privado para workspaces sem Git. É relevante como contraste, mas não atende ao alvo: seu domínio é navegação/restauração de sessão e worktree, não o buffer do composer.
- **[0xKahi/pi-vim-keys](https://github.com/0xKahi/pi-vim-keys)** — extensão MIT (`[LICENSE](https://github.com/0xKahi/pi-vim-keys/blob/main/LICENSE)`) que substitui o editor por um `VimModalEditor` via `setEditorComponent`, com modos e bindings próprios. É prior art para a seam da factory, mas a estratégia é ampla: um editor customizado inteiro aumenta o acoplamento a APIs e detalhes internos de Editor/TUI e não é necessário para este objetivo estreito.
- **Candidatos não verificados.** Nenhum outro pacote é usado como evidência ou dependência desta decisão. Menções externas sem fonte primária verificável devem ser tratadas como não verificadas, não como suporte a undo do composer.

## Segurança e versões observadas

Extensões OMP rodam **no mesmo processo e sem isolamento/sandbox**. A documentação alerta que exceções em callbacks podem derrubar a sessão inteira; portanto instalar uma extensão de terceiro é código com os privilégios do processo OMP e merece revisão de origem, permissões e manutenção.

- [Aviso oficial de execução in-process](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md#background-work-ctxsetinterval--ctxsettimeout)

**Medição local, não afirmação de release (2026-09-16):** `command -v omp` apontou para `~/.local/bin/omp`; `omp --version` reportou `omp/18.2.1`. O `bun` do PATH foi `~/.bun/bin/bun`, versão `1.4.2`. Separadamente, o `package.json` da branch `main` consultada declara `@oh-my-pi/pi-coding-agent` `18.2.2` e requisito `bun >=1.3.14`; isso é metadado da fonte consultada, não a versão instalada acima.

## Decisão

Implementar `cmd-z-undo.ts` como uma extensão first-party fina: detectar TUI, preservar a factory customizada quando o runtime a oferecer, copiar e remapear apenas os bindings públicos necessários, e delegar o undo ao `CustomEditor`/`Editor` nativo. Nenhuma pilha paralela, snapshot de texto, acesso a campos privados, pacote de terceiro, mudança no core, arquivo de configuração ou mecanismo de redo faz parte da solução.
