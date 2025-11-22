// Reference: blueprint:javascript_object_storage
import { File } from "@google-cloud/storage";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export enum ObjectAccessGroupType {
  VEHICLE_OWNER = "VEHICLE_OWNER",
  STAFF_ROLE = "STAFF_ROLE",
}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

class VehicleOwnerAccessGroup extends BaseObjectAccessGroup {
  constructor(vehicleId: string) {
    super(ObjectAccessGroupType.VEHICLE_OWNER, vehicleId);
  }

  async hasMember(userId: string): Promise<boolean> {
    const { db } = await import("./db");
    const { vehicles } = await import("../shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const vehicle = await db.query.vehicles.findFirst({
      where: eq(vehicles.id, this.id),
    });
    
    return vehicle?.customerId === userId;
  }
}

class StaffRoleAccessGroup extends BaseObjectAccessGroup {
  constructor(roleName: string) {
    super(ObjectAccessGroupType.STAFF_ROLE, roleName);
  }

  async hasMember(userId: string): Promise<boolean> {
    const { db } = await import("./db");
    const { users } = await import("../shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    const allowedRoles = ["admin", "manager", "mechanic", "receptionist"];
    return user?.role ? allowedRoles.includes(user.role) : false;
  }
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    case ObjectAccessGroupType.VEHICLE_OWNER:
      return new VehicleOwnerAccessGroup(group.id);
    case ObjectAccessGroupType.STAFF_ROLE:
      return new StaffRoleAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
