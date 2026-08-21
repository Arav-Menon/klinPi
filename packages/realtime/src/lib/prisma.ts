import { getPrisma } from "@klinpi/prisma";
import type { PrismaClient } from "../../../../platform/prisma/dist/generated/prisma/client.js";

const prisma = getPrisma;

export const db: PrismaClient = prisma();