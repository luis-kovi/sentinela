import { headers } from "next/headers";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/errors";
import { hasRole } from "@/lib/rbac";

export async function requireUser(): Promise<User> {
  const headerList = headers();
  const userId = headerList.get("x-user-id");

  if (!userId) {
    throw new ApiError(401, "Missing x-user-id header");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || !user.isActive) {
    throw new ApiError(401, "Invalid or inactive user");
  }

  return user;
}

export function requireRole(user: User, requiredRole: Role): void {
  if (!hasRole(user.role, requiredRole)) {
    throw new ApiError(403, "Forbidden");
  }
}

export function requireSupplier(user: User): void {
  if (user.role !== "SUPPLIER") {
    throw new ApiError(403, "Forbidden");
  }

  if (!user.supplierCompanyId) {
    throw new ApiError(400, "Supplier user missing supplierCompanyId");
  }
}
