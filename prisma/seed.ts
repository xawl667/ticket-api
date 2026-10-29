import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set in environment");
    process.exit(1);
  }

  if (password.length < 12) {
    console.error("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters");
    process.exit(1);
  }

  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
  });

  if (existingSuperAdmin) {
    console.log("Super Admin already exists, seed is idempotent - skipping creation");
    console.log(`Existing Super Admin: ${existingSuperAdmin.email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const superAdmin = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  console.log(`Super Admin created: ${superAdmin.email}`);
  console.log("IMPORTANT: Remove SEED_SUPER_ADMIN_PASSWORD from your .env after running seed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
