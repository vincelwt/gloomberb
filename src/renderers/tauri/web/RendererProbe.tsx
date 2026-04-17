import { useState } from "react";
import { Box, Button, Text, useRendererHost } from "../../../ui";
import { useShortcut, useViewport } from "../../../react/input";

export function RendererProbe() {
  const viewport = useViewport();
  const renderer = useRendererHost();
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("Ready");

  useShortcut((event) => {
    if (event.key === "escape") {
      event.preventDefault();
      renderer.requestExit();
    }
    if (event.key === "return") {
      event.preventDefault();
      setCount((value) => value + 1);
    }
  });

  return (
    <Box
      style={{
        minHeight: "100vh",
        padding: 24,
        gap: 16,
        backgroundColor: "#101417",
        color: "#f1f5f9",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <Text bold style={{ fontSize: 22 }}>Gloomberb Renderer Probe</Text>
      <Text dim>
        {`Viewport ${viewport.width}x${viewport.height}`}
      </Text>
      <Text>
        This shell is intentionally small. It proves the shared UI host can mount outside OpenTUI.
      </Text>
      <Box flexDirection="row" style={{ gap: 10 }}>
        <Button onPress={() => setCount((value) => value + 1)}>
          Increment
        </Button>
        <Button
          onPress={async () => {
            await renderer.copyText(`gloomberb-renderer-probe:${count}`);
            setMessage("Copied probe token");
          }}
        >
          Copy Token
        </Button>
      </Box>
      <Text>{`Count ${count}`}</Text>
      <Text dim>{message}</Text>
      <Text dim>Enter increments. Escape requests exit.</Text>
    </Box>
  );
}
