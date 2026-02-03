import type { Role } from "@prisma/client";

const roleOrder: Role[] = ["SUPPLIER", "KOVI", "ADMIN"];

export function hasRole(userRole: Role, required: Role): boolean {
  return roleOrder.indexOf(userRole) >= roleOrder.indexOf(required);
}

export function isSupplier(userRole: Role): boolean {
  return userRole === "SUPPLIER";
}

export function isKovi(userRole: Role): boolean {
  return userRole === "KOVI";
}

export function isAdmin(userRole: Role): boolean {
  return userRole === "ADMIN";
}
