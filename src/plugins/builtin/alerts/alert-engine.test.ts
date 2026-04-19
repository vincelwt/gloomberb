import { describe, expect, test } from "bun:test";
import { evaluateAlert, createAlert, serializeAlerts, deserializeAlerts } from "./alert-engine";

describe("evaluateAlert", () => {
  test("above: triggers when price exceeds target", () => {
    const alert = createAlert("AAPL", "above", 200);
    expect(evaluateAlert(alert, 199)).toBe(false);
    expect(evaluateAlert(alert, 200)).toBe(false);
    expect(evaluateAlert(alert, 201)).toBe(true);
  });

  test("below: triggers when price drops below target", () => {
    const alert = createAlert("AAPL", "below", 150);
    expect(evaluateAlert(alert, 151)).toBe(false);
    expect(evaluateAlert(alert, 150)).toBe(false);
    expect(evaluateAlert(alert, 149)).toBe(true);
  });

  test("crosses: triggers when price crosses target in either direction", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    expect(evaluateAlert(alert, 175)).toBe(false);
    alert.lastCheckedPrice = 175;
    expect(evaluateAlert(alert, 185)).toBe(true);
  });

  test("crosses: triggers downward crossing", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    alert.lastCheckedPrice = 185;
    expect(evaluateAlert(alert, 175)).toBe(true);
  });

  test("crosses: does not trigger without prior price", () => {
    const alert = createAlert("AAPL", "crosses", 180);
    expect(evaluateAlert(alert, 185)).toBe(false);
  });

  test("does not evaluate triggered alerts", () => {
    const alert = createAlert("AAPL", "above", 200);
    alert.status = "triggered";
    expect(evaluateAlert(alert, 999)).toBe(false);
  });
});

describe("serializeAlerts / deserializeAlerts", () => {
  test("roundtrips alerts", () => {
    const alerts = [createAlert("AAPL", "above", 200), createAlert("TSLA", "below", 100)];
    const json = serializeAlerts(alerts);
    const restored = deserializeAlerts(json);
    expect(restored).toHaveLength(2);
    expect(restored[0]!.symbol).toBe("AAPL");
    expect(restored[1]!.symbol).toBe("TSLA");
  });
});
