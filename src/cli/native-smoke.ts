export const OPEN_TUI_NATIVE_SMOKE_COMMAND = "__gloomberb-smoke-opentui-native";

export async function smokeOpenTuiNative(): Promise<void> {
  await import("../renderers/opentui/native-smoke");
}
