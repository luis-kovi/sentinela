import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "@/lib/errors";

const endpoint = process.env.STORAGE_ENDPOINT;
const bucket = process.env.STORAGE_BUCKET;
const accessKeyId = process.env.STORAGE_ACCESS_KEY;
const secretAccessKey = process.env.STORAGE_SECRET_KEY;
const region = process.env.STORAGE_REGION || "us-east-1";
const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL;

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new ApiError(501, "Storage not configured");
  }

  if (!cachedClient) {
    cachedClient = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  return cachedClient;
}

export async function createUploadUrl(params: {
  key: string;
  contentType: string;
}): Promise<{ uploadUrl: string; headers: Record<string, string>; publicUrl?: string }> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\\/$/, "")}/${params.key}`
    : undefined;
  return { uploadUrl, headers: { "Content-Type": params.contentType }, publicUrl };
}
