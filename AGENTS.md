Stack: Bun + OpenTUI

Use tmux to test your changes (see the `tui-testing` skill). Always kill the tmux session when done.
Add mouse/cursor interactivity for everything interactive.
Never fix chart issues by disabling / turning off the kitty renderer; preserve kitty support and fix the root cause.
When adding new pane/plugin, read PLUGINS.md check how others are made first to keep UI consistent. Always prefer shared UI components and plugin APIs before rolling your own.
