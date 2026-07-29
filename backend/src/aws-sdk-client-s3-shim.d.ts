declare module '@aws-sdk/client-s3' {
  export interface S3ClientConfig {
    region?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  }

  export class S3Client {
    constructor(config?: S3ClientConfig);
    send(command: unknown): Promise<unknown>;
  }

  export class PutObjectCommand {
    constructor(input?: unknown);
  }

  export class ListObjectsV2Command {
    constructor(input?: unknown);
  }

  export class DeleteObjectCommand {
    constructor(input?: unknown);
  }
}
