import {PrismaClient} from "./generated/prisma/client.js";
import {PrismaPg} from "@prisma/adapter-pg"

export { SessionStatus } from "./generated/prisma/enums.js";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const adapter = new PrismaPg({connectionString: process.env.DATABASE_URL})
    _prisma = new PrismaClient({adapter})
  }
  return _prisma
}
