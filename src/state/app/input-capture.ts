import { useEffect } from "react";
import { useAppDispatch } from "./context";

export function useAppInputCapture(captured: boolean) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!captured) return;
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    return () => dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [captured, dispatch]);
}
