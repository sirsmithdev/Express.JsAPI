// Environment-aware object storage with multi-adapter support
import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import { getStorageAdapter, ReplitGCSAdapter } from "./storageAdapters";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Legacy GCS client - only used for Replit-specific ACL operations
let _legacyGCSClient: Storage | null = null;

function getLegacyGCSClient(): Storage {
  if (!_legacyGCSClient) {
    _legacyGCSClient = new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
  }
  return _legacyGCSClient;
}

// For backwards compatibility
export const objectStorageClient = getLegacyGCSClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private adapter = getStorageAdapter();
  private isReplitGCS = this.adapter instanceof ReplitGCSAdapter;

  constructor() {}

  // Legacy method - only used for Replit GCS with ACL
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0 && this.isReplitGCS) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Legacy method - only used for Replit GCS with ACL
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir && this.isReplitGCS) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    // Only used for Replit GCS
    if (!this.isReplitGCS) {
      console.warn("searchPublicObject is only supported on Replit GCS");
      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = getLegacyGCSClient().bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    // This method is only for GCS File instances
    // Non-GCS adapters should use downloadObjectByPath instead
    if (!this.isReplitGCS) {
      throw new Error("downloadObject with File parameter is only supported on Replit GCS. Use downloadObjectByPath instead.");
    }

    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async downloadObjectByPath(objectPath: string, res: Response, cacheTtlSec: number = 3600) {
    // Universal download method that works with all storage adapters
    try {
      if (this.isReplitGCS) {
        // For Replit GCS, use the existing downloadObject method
        const file = await this.getObjectEntityFile(objectPath);
        return this.downloadObject(file, res, cacheTtlSec);
      }

      // For non-GCS adapters, translate path and use adapter's downloadFile method
      const actualKey = this.getActualStorageKey(objectPath);
      await this.adapter.downloadFile(actualKey, res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    // Use adapter for all storage types
    return this.adapter.getPrivateUploadURL();
  }

  async getPublicUploadURL(filename: string): Promise<{ uploadURL: string; publicPath: string; publicUrl: string }> {
    // Use adapter for all storage types
    return this.adapter.getPublicUploadURL(filename);
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    // This method is only for Replit GCS
    if (!this.isReplitGCS) {
      throw new Error("getObjectEntityFile is only supported on Replit GCS. Use downloadObjectByPath instead.");
    }

    // Replit GCS specific logic
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = getLegacyGCSClient().bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  getActualStorageKey(objectPath: string): string {
    // Translate virtual /objects/:id path to actual storage key
    if (!objectPath.startsWith("/objects/")) {
      return objectPath;
    }

    if (this.isReplitGCS) {
      // GCS uses getObjectEntityFile to resolve the path
      return objectPath;
    }

    // For S3/local: /objects/:id → private/uploads/:id
    const entityId = objectPath.slice("/objects/".length);
    return `private/uploads/${entityId}`;
  }

  async checkObjectEntityExists(objectPath: string): Promise<boolean> {
    // Universal method to check if object exists
    if (!objectPath.startsWith("/objects/")) {
      return false;
    }

    if (this.isReplitGCS) {
      try {
        await this.getObjectEntityFile(objectPath);
        return true;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return false;
        }
        throw error;
      }
    }

    // For non-GCS adapters, translate path and check file existence
    const actualKey = this.getActualStorageKey(objectPath);
    return await this.adapter.fileExists(actualKey);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Normalize upload URLs to virtual /objects/:id format for all adapter types
    
    // Already normalized
    if (rawPath.startsWith("/objects/")) {
      return rawPath;
    }

    // For Replit GCS: Extract from https://storage.googleapis.com/...
    if (this.isReplitGCS) {
      if (!rawPath.startsWith("https://storage.googleapis.com/")) {
        return rawPath;
      }

      const url = new URL(rawPath);
      let rawObjectPath = url.pathname;
      
      // Normalize: ensure no leading slash for comparison
      if (rawObjectPath.startsWith("/")) {
        rawObjectPath = rawObjectPath.slice(1);
      }

      let objectEntityDir = this.getPrivateObjectDir();
      // Normalize: ensure no leading or trailing slash
      if (objectEntityDir.startsWith("/")) {
        objectEntityDir = objectEntityDir.slice(1);
      }
      if (!objectEntityDir.endsWith("/")) {
        objectEntityDir = `${objectEntityDir}/`;
      }

      if (!rawObjectPath.startsWith(objectEntityDir)) {
        return `/${rawObjectPath}`;
      }

      const entityId = rawObjectPath.slice(objectEntityDir.length);
      return `/objects/${entityId}`;
    }

    // For S3/Local: Extract from presigned URL
    // Expected format: https://bucket.s3.amazonaws.com/private/uploads/:id
    // Or for local: http://localhost:5000/uploads/private/uploads/:id
    try {
      const url = new URL(rawPath);
      const pathname = url.pathname;
      
      // Extract entity ID from path like /private/uploads/:id or /uploads/private/uploads/:id
      const privateUploadsMatch = pathname.match(/private\/uploads\/([^/]+)/);
      if (privateUploadsMatch) {
        const entityId = privateUploadsMatch[1];
        return `/objects/${entityId}`;
      }

      // If pattern doesn't match, return as-is (might be already normalized)
      return rawPath;
    } catch (error) {
      // Not a valid URL, return as-is
      return rawPath;
    }
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    // ACL is only supported on Replit GCS
    if (!this.isReplitGCS) {
      console.warn("ACL not supported on non-Replit storage adapters");
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    // ACL is only supported on Replit GCS
    if (!this.isReplitGCS) {
      // For non-GCS storage, allow all access (implement your own ACL logic if needed)
      return true;
    }

    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
