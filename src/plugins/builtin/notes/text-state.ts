import { useCallback, useRef, useState } from "react";

export function useSyncedText(initialValue = "") {
  const [text, setTextState] = useState(initialValue);
  const textRef = useRef(initialValue);
  const setText = useCallback((nextText: string) => {
    textRef.current = nextText;
    setTextState(nextText);
  }, []);
  return { text, textRef, setText };
}
