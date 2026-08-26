import { STREAMED_STATE_DOMAINS } from "@hemlogik/connect-protocol";

const STREAMED_DOMAIN_SET = new Set<string>(STREAMED_STATE_DOMAINS);

/**
 * Filters HA's state_changed firehose down to what's worth forwarding (AGENTS spec s22/s43) -
 * filtering happens HERE, in the agent, not on the Gateway, so unwanted traffic never even leaves
 * the customer's network. Two conditions: the domain is one of the ones worth a live dashboard
 * update (excludes camera entirely, excludes chatty domains like update/persistent_notification
 * even though they're still inventoried), AND the entity is already known from the last inventory
 * sync (a brand-new entity HA just discovered gets picked up on the next refresh_inventory, not
 * streamed ad hoc - keeps this a pure filter with no side effects on inventory state).
 */
export function shouldForwardStateEvent(entityId: string, knownEntityIds: ReadonlySet<string>): boolean {
  const domain = entityId.split(".")[0];
  return Boolean(domain) && STREAMED_DOMAIN_SET.has(domain!) && knownEntityIds.has(entityId);
}
