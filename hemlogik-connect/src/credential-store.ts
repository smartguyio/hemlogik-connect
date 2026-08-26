import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * The ONLY place the connector credential and Cloudflare tunnel token persist on-device
 * (AGENTS spec s7/s10/s25) - inside this App's own /data directory, which Home Assistant
 * guarantees survives App restarts/updates/host reboots and is never shared with any other App.
 */
export interface StoredCredential {
  connectorId: string;
  credential: string;
  credentialVersion: number;
}

const CREDENTIAL_PATH = () => path.join(config.dataDir, "connector-credential.json");
const TUNNEL_TOKEN_PATH = () => path.join(config.dataDir, "tunnel-token");

export async function loadCredential(): Promise<StoredCredential | null> {
  try {
    const raw = await readFile(CREDENTIAL_PATH(), "utf8");
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

export async function saveCredential(credential: StoredCredential): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(CREDENTIAL_PATH(), JSON.stringify(credential, null, 2), { mode: 0o600 });
}

/** Deletes the stored pairing - the App's own "reset"/"forget this installation" action would call this, allowing a fresh enrollment. */
export async function clearCredential(): Promise<void> {
  try {
    await writeFile(CREDENTIAL_PATH(), "");
  } catch {
    // nothing to clear
  }
}

export function hasTunnelToken(): boolean {
  return existsSync(TUNNEL_TOKEN_PATH());
}

export async function saveTunnelToken(token: string): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(TUNNEL_TOKEN_PATH(), token, { mode: 0o600 });
}
