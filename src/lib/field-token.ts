import { createHash, randomBytes } from "crypto";

const SALT = process.env.FIELD_TOKEN_SALT ?? process.env.NEXTAUTH_SECRET ?? "dev-field-salt";

export function createFieldToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(`${SALT}:${token}`).digest("hex");
}
