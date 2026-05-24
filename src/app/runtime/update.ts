import { useCallback, useEffect, type Dispatch } from "react";
import type { AppAction } from "../../state/app/context";
import {
  canSelfUpdate,
  checkForUpdateDetailed,
  performUpdate,
  type ReleaseInfo,
} from "../../updater";
import { VERSION } from "../../version";

export function useAppUpdateRuntime({
  dispatch,
  isDetachedWindow,
  updateAvailable,
  updateCheckInProgress,
  updateProgress,
}: {
  dispatch: Dispatch<AppAction>;
  isDetachedWindow: boolean;
  updateAvailable: ReleaseInfo | null;
  updateCheckInProgress: boolean;
  updateProgress: unknown;
}): {
  runUpdateCheck: (manual?: boolean) => Promise<void>;
  startUpdate: (release: ReleaseInfo) => void;
} {
  const startUpdate = useCallback((release: ReleaseInfo) => {
    dispatch({ type: "SET_UPDATE_PROGRESS", progress: { phase: "downloading", percent: 0 } });
    void performUpdate(release, (progress) => {
      dispatch({ type: "SET_UPDATE_PROGRESS", progress });
    });
  }, [dispatch]);

  const runUpdateCheck = useCallback(async (manual = false) => {
    if (manual) {
      dispatch({ type: "SET_UPDATE_CHECK_IN_PROGRESS", checking: true });
      dispatch({ type: "SET_UPDATE_NOTICE", notice: null });
    }

    const result = await checkForUpdateDetailed(VERSION);

    if (!manual) {
      if (result.kind === "available") {
        dispatch({ type: "SET_UPDATE_AVAILABLE", release: result.release });
      }
      return;
    }

    dispatch({ type: "SET_UPDATE_CHECK_IN_PROGRESS", checking: false });

    if (result.kind === "available") {
      dispatch({ type: "SET_UPDATE_AVAILABLE", release: result.release });
      return;
    }

    if (result.kind === "current") {
      dispatch({ type: "SET_UPDATE_AVAILABLE", release: null });
      dispatch({ type: "SET_UPDATE_NOTICE", notice: `Already on v${VERSION}` });
      return;
    }

    if (result.kind === "disabled") {
      dispatch({ type: "SET_UPDATE_NOTICE", notice: "Update checks are unavailable in source mode" });
      return;
    }

    dispatch({ type: "SET_UPDATE_NOTICE", notice: `Update check failed: ${result.error}` });
  }, [dispatch]);

  useEffect(() => {
    if (isDetachedWindow) return;
    void runUpdateCheck(false);
  }, [isDetachedWindow, runUpdateCheck]);

  useEffect(() => {
    if (isDetachedWindow) return;
    if (!updateAvailable || updateProgress || updateCheckInProgress) return;
    if (!canSelfUpdate(updateAvailable)) return;
    startUpdate(updateAvailable);
  }, [isDetachedWindow, startUpdate, updateAvailable, updateCheckInProgress, updateProgress]);

  return {
    runUpdateCheck,
    startUpdate,
  };
}
