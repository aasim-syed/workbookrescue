import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Neon Object Storage: S3-compatible, path-style only. Credentials, endpoint and region come from the injected AWS_* env vars.
const BUCKET = process.env.NEON_BUCKET ?? "assets";
let client: S3Client | undefined;

export const storageEnabled = () => !!(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const s3 = () => (client ??= new S3Client({ forcePathStyle: true }));

export const objectKey = (projectId: string, artifactId: string, filename: string) =>
  `${projectId}/${artifactId}/${filename.replace(/[^\w.\-]+/g, "_")}`;

export async function putOriginal(key: string, bytes: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: contentType }));
}

/** Short-lived signed URL: the bucket is private, so the browser never sees credentials. */
export const downloadUrl = (key: string, filename: string) =>
  getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` }), { expiresIn: 300 });

export async function deleteOriginal(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function deletePrefix(prefix: string) {
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
