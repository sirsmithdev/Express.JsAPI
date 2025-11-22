import { Storage, File } from "@google-cloud/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Response } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream, createWriteStream } from "fs";

// Storage adapter interface
export interface IStorageAdapter {
  getPublicUploadURL(filename: string): Promise<{ uploadURL: string; publicPath: string; publicUrl: string }>;
  getPrivateUploadURL(): Promise<string>;
  downloadFile(filePath: string, res: Response): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  getFileUrl(filePath: string): string;
}

// Replit GCS Storage Adapter (current implementation)
export class ReplitGCSAdapter implements IStorageAdapter {
  private client: Storage;
  private sidecarEndpoint = "http://127.0.0.1:1106";

  constructor() {
    this.client = new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${this.sidecarEndpoint}/token`,
        type: "external_account",
        credential_source: {
          url: `${this.sidecarEndpoint}/credential`,
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

  private getPublicSearchPaths(): string[] {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    return pathsStr.split(",").map(p => p.trim()).filter(p => p.length > 0);
  }

  private getPrivateDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "";
  }

  private parseObjectPath(objectPath: string): { bucketName: string; objectName: string } {
    if (!objectPath.startsWith("/")) {
      objectPath = `/${objectPath}`;
    }
    const parts = objectPath.split("/");
    if (parts.length < 3) {
      throw new Error("Invalid object path");
    }
    return {
      bucketName: parts[1],
      objectName: parts.slice(2).join("/"),
    };
  }

  private async signObjectURL(bucketName: string, objectName: string, method: string, ttlSec: number): Promise<string> {
    const request = {
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
    const response = await fetch(`${this.sidecarEndpoint}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`Failed to sign object URL: ${response.status}`);
    }
    const { signed_url } = await response.json();
    return signed_url;
  }

  async getPublicUploadURL(filename: string): Promise<{ uploadURL: string; publicPath: string; publicUrl: string }> {
    const publicPaths = this.getPublicSearchPaths();
    if (publicPaths.length === 0) {
      throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set");
    }

    const publicBasePath = publicPaths[0];
    const objectId = randomUUID();
    const extension = filename.includes('.') ? filename.split('.').pop() : '';
    const objectFilename = extension ? `${objectId}.${extension}` : objectId;
    const fullPath = `${publicBasePath}/${objectFilename}`;
    const { bucketName, objectName } = this.parseObjectPath(fullPath);

    const uploadURL = await this.signObjectURL(bucketName, objectName, "PUT", 900);
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;

    return {
      uploadURL,
      publicPath: `/${objectFilename}`,
      publicUrl,
    };
  }

  async getPrivateUploadURL(): Promise<string> {
    const privateDir = this.getPrivateDir();
    if (!privateDir) {
      throw new Error("PRIVATE_OBJECT_DIR not set");
    }

    const objectId = randomUUID();
    const fullPath = `${privateDir}/uploads/${objectId}`;
    const { bucketName, objectName } = this.parseObjectPath(fullPath);

    return this.signObjectURL(bucketName, objectName, "PUT", 900);
  }

  async downloadFile(filePath: string, res: Response): Promise<void> {
    const { bucketName, objectName } = this.parseObjectPath(filePath);
    const bucket = this.client.bucket(bucketName);
    const file = bucket.file(objectName);

    const [metadata] = await file.getMetadata();
    res.set({
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Content-Length": metadata.size,
      "Cache-Control": "public, max-age=3600",
    });

    file.createReadStream().pipe(res);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const { bucketName, objectName } = this.parseObjectPath(filePath);
      const bucket = this.client.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      return exists;
    } catch {
      return false;
    }
  }

  getFileUrl(filePath: string): string {
    const { bucketName, objectName } = this.parseObjectPath(filePath);
    return `https://storage.googleapis.com/${bucketName}/${objectName}`;
  }
}

// AWS S3 Storage Adapter for Railway
export class S3StorageAdapter implements IStorageAdapter {
  private client: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || "us-east-1";
    this.bucketName = process.env.AWS_BUCKET_NAME || "";

    if (!this.bucketName) {
      throw new Error("AWS_BUCKET_NAME environment variable is required for S3 storage");
    }

    const config: any = {
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    };

    // Support for S3-compatible services (DigitalOcean Spaces, Cloudflare R2, etc.)
    if (process.env.AWS_ENDPOINT) {
      config.endpoint = process.env.AWS_ENDPOINT;
      config.forcePathStyle = true; // Required for some S3-compatible services
    }

    this.client = new S3Client(config);
  }

  async getPublicUploadURL(filename: string): Promise<{ uploadURL: string; publicPath: string; publicUrl: string }> {
    const objectId = randomUUID();
    const extension = filename.includes('.') ? filename.split('.').pop() : '';
    const objectKey = extension ? `public/${objectId}.${extension}` : `public/${objectId}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: this.getContentType(filename),
    });

    const uploadURL = await getSignedUrl(this.client, command, { expiresIn: 900 });
    const publicUrl = this.getFileUrl(objectKey);

    return {
      uploadURL,
      publicPath: `/${objectKey}`,
      publicUrl,
    };
  }

  async getPrivateUploadURL(): Promise<string> {
    const objectId = randomUUID();
    const objectKey = `private/uploads/${objectId}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  async downloadFile(filePath: string, res: Response): Promise<void> {
    const objectKey = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });

      const response = await this.client.send(command);

      res.set({
        "Content-Type": response.ContentType || "application/octet-stream",
        "Content-Length": response.ContentLength?.toString() || "",
        "Cache-Control": "public, max-age=3600",
      });

      if (response.Body) {
        // @ts-ignore - Body is a stream
        response.Body.pipe(res);
      }
    } catch (error) {
      console.error("S3 download error:", error);
      throw error;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const objectKey = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  getFileUrl(filePath: string): string {
    const objectKey = filePath.startsWith('/') ? filePath.slice(1) : filePath;

    if (process.env.AWS_ENDPOINT) {
      // S3-compatible service
      const endpoint = process.env.AWS_ENDPOINT.replace(/\/$/, '');
      return `${endpoint}/${this.bucketName}/${objectKey}`;
    } else {
      // AWS S3
      return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${objectKey}`;
    }
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}

// Local Filesystem Storage Adapter for Railway Volumes
export class LocalStorageAdapter implements IStorageAdapter {
  private uploadDir: string;
  private baseUrl: string;

  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || "/app/uploads";
    this.baseUrl = process.env.APP_URL || "http://localhost:5000";

    // Ensure upload directory exists
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, "public"), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, "private"), { recursive: true });
    } catch (error) {
      console.error("Error creating upload directories:", error);
    }
  }

  async getPublicUploadURL(filename: string): Promise<{ uploadURL: string; publicPath: string; publicUrl: string }> {
    const objectId = randomUUID();
    const extension = filename.includes('.') ? filename.split('.').pop() : '';
    const objectFilename = extension ? `${objectId}.${extension}` : objectId;
    const relativePath = `public/${objectFilename}`;

    // For local storage, we return a path that the frontend can use to upload
    // The actual upload will be handled by a multipart form endpoint
    return {
      uploadURL: `/api/upload/public/${objectFilename}`,
      publicPath: `/${relativePath}`,
      publicUrl: `${this.baseUrl}/uploads/${relativePath}`,
    };
  }

  async getPrivateUploadURL(): Promise<string> {
    const objectId = randomUUID();
    return `/api/upload/private/${objectId}`;
  }

  async downloadFile(filePath: string, res: Response): Promise<void> {
    const safePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const fullPath = path.join(this.uploadDir, safePath);

    try {
      const stats = await fs.stat(fullPath);
      const ext = path.extname(fullPath).toLowerCase();

      res.set({
        "Content-Type": this.getContentType(ext),
        "Content-Length": stats.size.toString(),
        "Cache-Control": "public, max-age=3600",
      });

      const stream = createReadStream(fullPath);
      stream.pipe(res);
    } catch (error) {
      console.error("Local download error:", error);
      throw error;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const safePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const fullPath = path.join(this.uploadDir, safePath);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getFileUrl(filePath: string): string {
    const safePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `${this.baseUrl}/uploads/${safePath}`;
  }

  private getContentType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  // Helper method to save uploaded file
  async saveUploadedFile(filePath: string, buffer: Buffer): Promise<void> {
    const safePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const fullPath = path.join(this.uploadDir, safePath);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }
}

// Storage factory - creates appropriate adapter based on environment
export function createStorageAdapter(): IStorageAdapter {
  const storageType = process.env.STORAGE_TYPE || 'replit-gcs';

  console.log(`[Storage] Initializing storage adapter: ${storageType}`);

  switch (storageType) {
    case 's3':
      console.log('[Storage] Using S3 storage adapter');
      return new S3StorageAdapter();

    case 'local':
      console.log('[Storage] Using local filesystem storage adapter');
      return new LocalStorageAdapter();

    case 'replit-gcs':
    default:
      console.log('[Storage] Using Replit GCS storage adapter');
      return new ReplitGCSAdapter();
  }
}

// Singleton instance
let storageAdapterInstance: IStorageAdapter | null = null;

export function getStorageAdapter(): IStorageAdapter {
  if (!storageAdapterInstance) {
    storageAdapterInstance = createStorageAdapter();
  }
  return storageAdapterInstance;
}
