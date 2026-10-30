import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
// Hash factice bcrypt cost 12 pour anti-énumération (même temps de comparaison)
const DUMMY_HASH = "$2a$12$dummyhashdummyhashdummyhashdummyhashdummy";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getDummyHash(): string {
  return DUMMY_HASH;
}
