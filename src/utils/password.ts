import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, SALT_ROUNDS);
}

export async function comparePassword(raw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(raw, hash);
}
