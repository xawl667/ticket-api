import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
// Hash factice bcrypt cost 12 valide pour anti-�num�ration (m�me temps de comparaison)
const DUMMY_HASH = "$2a$12$rPWr06v9PVcVRup.EXwqBORhumzhTkafmnuo9ZnqEAt8NabuGg.Sa";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function getDummyHash(): string {
  return DUMMY_HASH;
}
