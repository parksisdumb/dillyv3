import path from "node:path";
import type { PersonaKey } from "../../../scripts/e2e/seed";

export const AUTH_DIR = path.resolve(__dirname, "../.auth");
export const authFile = (p: PersonaKey) => path.join(AUTH_DIR, `${p}.json`);
