import { describe, it, expect } from "vitest";
import { shouldForwardStateEvent } from "./events";

/**
 * This filter runs on every single HA state_changed event, in the agent, before anything is sent
 * to the Gateway (AGENTS spec s22/s43 - deliberately NOT filtered server-side, so unwanted traffic
 * never even leaves the customer's network). Getting this wrong either floods the Gateway with
 * noise or silently drops updates the portal is supposed to show live.
 */
describe("shouldForwardStateEvent", () => {
  const known = new Set(["light.kitchen", "switch.heater", "camera.front_door", "update.core"]);

  it("forwards a known entity in an allowed domain", () => {
    expect(shouldForwardStateEvent("light.kitchen", known)).toBe(true);
  });

  it("never forwards a camera entity, even if it's a known inventory entity", () => {
    expect(shouldForwardStateEvent("camera.front_door", known)).toBe(false);
  });

  it("never forwards a chatty domain like update, even if known", () => {
    expect(shouldForwardStateEvent("update.core", known)).toBe(false);
  });

  it("does not forward an entity HA just discovered that isn't in the last synced inventory yet", () => {
    expect(shouldForwardStateEvent("light.new_bulb", known)).toBe(false);
  });

  it("handles a malformed entity id without throwing", () => {
    expect(shouldForwardStateEvent("not-a-valid-entity-id", known)).toBe(false);
  });
});
