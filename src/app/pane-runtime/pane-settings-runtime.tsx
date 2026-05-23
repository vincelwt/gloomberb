import { useCallback, type Dispatch } from "react";
import {
  applyPaneSettingFieldValue as applyPaneSettingFieldValueShared,
} from "../../components/command-bar/workflow/workflow-ops";
import { PaneSettingsDialogContent } from "../../components/pane-settings-dialog";
import type { TickerRepository } from "../../data/ticker-repository";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppAction, AppState } from "../../state/app-context";
import type { LayoutConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { PaneSettingField } from "../../types/plugin";
import type { AlertContext, DialogApi } from "../../ui/dialog";

interface UseAppPaneSettingsRuntimeOptions {
  dataProvider: DataProvider;
  dialog: DialogApi;
  dispatch: Dispatch<AppAction>;
  persistLayout: (layout: LayoutConfig, options?: { pushHistory?: boolean }) => void;
  pluginRegistry: PluginRegistry;
  resolvePaneTarget: (paneId: string, layout?: LayoutConfig) => string | null;
  stateRef: { current: AppState };
  tickerRepository: TickerRepository;
}

export function useAppPaneSettingsRuntime({
  dataProvider,
  dialog,
  dispatch,
  persistLayout,
  pluginRegistry,
  resolvePaneTarget,
  stateRef,
  tickerRepository,
}: UseAppPaneSettingsRuntimeOptions) {
  const openPaneSettings = useCallback(async (paneId?: string) => {
    const targetPaneId = paneId
      ? resolvePaneTarget(paneId)
      : stateRef.current.focusedPaneId;
    if (!targetPaneId || !pluginRegistry.hasPaneSettings(targetPaneId)) return;

    let shouldPushHistory = true;
    const applyFieldValue = async (targetId: string, field: PaneSettingField, value: unknown) => {
      await applyPaneSettingFieldValueShared(targetId, field, value, {
        dataProvider,
        tickerRepository,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
        persistLayout,
      }, { pushHistory: shouldPushHistory });
      shouldPushHistory = false;
    };

    await dialog.alert({
      content: (ctx: AlertContext) => (
        <PaneSettingsDialogContent
          {...ctx}
          paneId={targetPaneId}
          pluginRegistry={pluginRegistry}
          applyFieldValue={applyFieldValue}
        />
      ),
    });
  }, [dataProvider, dialog, dispatch, persistLayout, pluginRegistry, resolvePaneTarget, stateRef, tickerRepository]);

  return { openPaneSettings };
}
