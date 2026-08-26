import { enrollRequestSchema, enrollSuccessResponseSchema, PROTOCOL_VERSION } from "@hemlogik/connect-protocol";
import { config } from "./config";
import { saveCredential, type StoredCredential } from "./credential-store";
import { getHaConfig } from "./supervisor-client";
import { logger } from "./logger";

/**
 * Submits the configured enrollment key to the Connect Gateway's one unauthenticated endpoint
 * (the key itself is the credential - AGENTS spec s7). On success, persists the returned
 * connector credential and never touches the enrollment key again.
 */
export async function enroll(): Promise<StoredCredential> {
  if (!config.enrollmentKey) {
    throw new Error("No enrollment key configured - enter the connection key from the Hemlogik portal in this App's configuration.");
  }

  const haConfig = await getHaConfig().catch(() => null);
  const body = enrollRequestSchema.parse({
    protocol_version: PROTOCOL_VERSION,
    enrollment_key: config.enrollmentKey,
    device_info: {
      ha_core_version: haConfig?.version,
      agent_version: config.agentVersion,
      arch: process.arch,
    },
  });

  const res = await fetch(`${config.gatewayHttpUrl}/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Enrollment failed: ${errBody.error ?? `HTTP ${res.status}`}`);
  }

  const parsed = enrollSuccessResponseSchema.parse(await res.json());
  const credential: StoredCredential = {
    connectorId: parsed.connector_id,
    credential: parsed.connector_credential,
    credentialVersion: 1,
  };
  await saveCredential(credential);
  logger.info(`Enrollment successful - paired with connector ${parsed.connector_id}`);
  return credential;
}
