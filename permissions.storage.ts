/**
 * Permissions Storage Module
 * Handles all RBAC (Role-Based Access Control) operations:
 * - Permissions CRUD
 * - Roles CRUD
 * - Role permissions management
 * - User permission overrides
 * - Permission audit logging
 */

import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  permissions,
  type Permission,
  roles,
  type Role,
  rolePermissions,
  type RolePermission,
  userPermissionOverrides,
  type UserPermissionOverride,
  permissionAuditLog,
  type PermissionAuditLog,
  users,
} from "./base";

class PermissionsStorage {
  // ============================================================
  // PERMISSIONS MANAGEMENT
  // ============================================================

  async getAllPermissions() {
    return await db.select().from(permissions).orderBy(permissions.category, permissions.code);
  }

  async getPermissionById(id: string) {
    const result = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
    return result[0];
  }

  async getPermissionByCode(code: string) {
    const result = await db.select().from(permissions).where(eq(permissions.code, code)).limit(1);
    return result[0];
  }

  async getPermissionsByCategory(category: string) {
    return await db.select().from(permissions).where(eq(permissions.category, category));
  }

  async createPermission(data: typeof permissions.$inferInsert) {
    const result = await db.insert(permissions).values(data).returning();
    return result[0];
  }

  async updatePermission(id: string, data: Partial<typeof permissions.$inferInsert>) {
    const result = await db.update(permissions).set(data).where(eq(permissions.id, id)).returning();
    return result[0];
  }

  async deletePermission(id: string) {
    await db.delete(permissions).where(eq(permissions.id, id));
  }

  // ============================================================
  // ROLES MANAGEMENT
  // ============================================================

  async getAllRoles() {
    return await db.select().from(roles).orderBy(roles.name);
  }

  async getActiveRoles() {
    return await db.select().from(roles).where(eq(roles.isActive, true)).orderBy(roles.name);
  }

  async getRoleById(id: string) {
    const result = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return result[0];
  }

  async getRoleByName(name: string) {
    const result = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
    return result[0];
  }

  async createRole(data: typeof roles.$inferInsert) {
    const result = await db.insert(roles).values(data).returning();
    return result[0];
  }

  async updateRole(id: string, data: Partial<typeof roles.$inferInsert>) {
    const result = await db.update(roles).set(data).where(eq(roles.id, id)).returning();
    return result[0];
  }

  async deleteRole(id: string) {
    await db.delete(roles).where(eq(roles.id, id));
  }

  // Check if any users are assigned to this role
  async countUsersWithRole(roleName: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, roleName));
    return Number(result[0]?.count || 0);
  }

  // ============================================================
  // ROLE PERMISSIONS MANAGEMENT
  // ============================================================

  async getRolePermissions(roleId: string) {
    return await db
      .select({
        id: rolePermissions.id,
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
        permissionCode: permissions.code,
        permissionName: permissions.name,
        permissionDescription: permissions.description,
        permissionCategory: permissions.category,
        grantedBy: rolePermissions.grantedBy,
        grantedAt: rolePermissions.grantedAt,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
  }

  async addRolePermission(data: typeof rolePermissions.$inferInsert) {
    const result = await db.insert(rolePermissions).values(data).returning();
    return result[0];
  }

  async removeRolePermission(roleId: string, permissionId: string) {
    await db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)));
  }

  async removeAllRolePermissions(roleId: string) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  }

  async bulkAddRolePermissions(roleId: string, permissionIds: string[], grantedBy?: string) {
    const values = permissionIds.map(permissionId => ({
      roleId,
      permissionId,
      grantedBy,
    }));
    if (values.length > 0) {
      await db.insert(rolePermissions).values(values);
    }
  }

  // Set all permissions for a role (replaces existing)
  async setRolePermissions(roleId: string, permissionIds: string[], grantedBy?: string) {
    // Delete existing permissions
    await this.removeAllRolePermissions(roleId);
    // Add new permissions
    await this.bulkAddRolePermissions(roleId, permissionIds, grantedBy);
  }

  // ============================================================
  // USER PERMISSION OVERRIDES
  // ============================================================

  async getUserPermissionOverrides(userId: string) {
    return await db
      .select({
        id: userPermissionOverrides.id,
        userId: userPermissionOverrides.userId,
        permissionId: userPermissionOverrides.permissionId,
        permissionCode: permissions.code,
        permissionName: permissions.name,
        permissionDescription: permissions.description,
        permissionCategory: permissions.category,
        granted: userPermissionOverrides.granted,
        reason: userPermissionOverrides.reason,
        expiresAt: userPermissionOverrides.expiresAt,
        grantedBy: userPermissionOverrides.grantedBy,
        createdAt: userPermissionOverrides.createdAt,
      })
      .from(userPermissionOverrides)
      .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
      .where(eq(userPermissionOverrides.userId, userId));
  }

  async addUserPermissionOverride(data: typeof userPermissionOverrides.$inferInsert) {
    const result = await db.insert(userPermissionOverrides).values(data).returning();
    return result[0];
  }

  async updateUserPermissionOverride(id: string, data: Partial<typeof userPermissionOverrides.$inferInsert>) {
    const result = await db.update(userPermissionOverrides).set(data).where(eq(userPermissionOverrides.id, id)).returning();
    return result[0];
  }

  async removeUserPermissionOverride(userId: string, permissionId: string) {
    await db
      .delete(userPermissionOverrides)
      .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.permissionId, permissionId)));
  }

  async removeAllUserPermissionOverrides(userId: string) {
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, userId));
  }

  // ============================================================
  // PERMISSION AUDIT LOG
  // ============================================================

  async createPermissionAuditLog(data: typeof permissionAuditLog.$inferInsert) {
    const result = await db.insert(permissionAuditLog).values(data).returning();
    return result[0];
  }

  async getPermissionAuditLogs(options?: { entityType?: string; entityId?: string; limit?: number }) {
    let query = db.select().from(permissionAuditLog).orderBy(desc(permissionAuditLog.createdAt));

    if (options?.entityType && options?.entityId) {
      query = query.where(
        and(eq(permissionAuditLog.entityType, options.entityType), eq(permissionAuditLog.entityId, options.entityId))
      ) as any;
    } else if (options?.entityType) {
      query = query.where(eq(permissionAuditLog.entityType, options.entityType)) as any;
    } else if (options?.entityId) {
      query = query.where(eq(permissionAuditLog.entityId, options.entityId)) as any;
    }

    if (options?.limit) {
      query = query.limit(options.limit) as any;
    }

    return await query;
  }

  async getUserAuditLogs(userId: string, limit = 50) {
    return await this.getPermissionAuditLogs({ entityType: 'user', entityId: userId, limit });
  }

  async getRoleAuditLogs(roleId: string, limit = 50) {
    return await this.getPermissionAuditLogs({ entityType: 'role', entityId: roleId, limit });
  }
}

// Export singleton instance
export const permissionsStorage = new PermissionsStorage();
