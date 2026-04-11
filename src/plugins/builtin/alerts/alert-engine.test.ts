import { describe, expect, test } from "bun:test";
import { evaluateAlert, createAlert, formatAlertDescription, serializeAlerts, deserializeAlerts } from "./alert-engine";

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

describe("createAlert", () => {
  test("creates alert with active status", () => {
    const alert = createAlert("TSLA", "below", 100);
    expect(alert.symbol).toBe("TSLA");
    expect(alert.condition).toBe("below");
    expect(alert.targetPrice).toBe(100);
    expect(alert.status).toBe("active");
    expect(alert.id).toBeTruthy();
  });

  test("uppercases symbol", () => {
    expect(createAlert("aapl", "above", 200).symbol).toBe("AAPL");
  });
});

describe("formatAlertDescription", () => {
  test("formats above", () => {
    expect(formatAlertDescription(createAlert("AAPL", "above", 200))).toBe("AAPL > 200");
  });
  test("formats below", () => {
    expect(formatAlertDescription(createAlert("AAPL", "below", 150))).toBe("AAPL < 150");
  });
  test("formats crosses", () => {
    expect(formatAlertDescription(createAlert("AAPL", "crosses", 180))).toBe("AAPL ↕ 180");
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

  test("handles invalid JSON", () => {
    expect(deserializeAlerts("not json")).toEqual([]);
    expect(deserializeAlerts("null")).toEqual([]);
    expect(deserializeAlerts("[]")).toEqual([]);
  });

  test("filters invalid entries", () => {
    expect(deserializeAlerts('[{"bad": true}]')).toEqual([]);
  });
});
