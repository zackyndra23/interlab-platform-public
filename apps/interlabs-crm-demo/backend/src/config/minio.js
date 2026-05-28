'use strict';

const { Client } = require('minio');

const env = require('./env');

// Lazily-constructed MinIO clients. Keeping them lazy means the API can boot
// (and /health responds) even when MinIO credentials are absent in dev — any
// file route still fails clearly the first time it tries to use a client.
//
// Two clients exist:
//
//   getClient()       — internal client. Used for server-side operations
//                       (putObject on upload, deleteObject, etc.) that run
//                       from inside the Docker network, where MINIO_ENDPOINT
//                       resolves (e.g. `minio:9000`).
//
//   getPublicClient() — browser-facing client. Used only to generate
//                       presigned GET URLs returned to the frontend. When
//                       MINIO_PUBLIC_URL is set, this client is bound to the
//                       public hostname so the SigV4 signature is computed
//                       against the host the browser will actually dial.
//                       (The signature is part of the canonical request,
//                       which includes the Host header — rewriting the host
//                       on an already-signed URL would invalidate it, so we
//                       must sign against the public host from the start.)
//                       When MINIO_PUBLIC_URL is empty (local dev), this
//                       falls back to the internal client; in that case
//                       MINIO_ENDPOINT is expected to be reachable from the
//                       browser (typically `localhost:9000`).

let internalClient = null;
let publicClient = null;

function getClient() {
    if (internalClient) return internalClient;
    if (!env.minio.endpoint || !env.minio.accessKey || !env.minio.secretKey) {
        throw new Error(
            'MinIO is not configured: set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY',
        );
    }
    internalClient = new Client({
        endPoint: env.minio.endpoint,
        port: env.minio.port,
        useSSL: env.minio.useSsl,
        accessKey: env.minio.accessKey,
        secretKey: env.minio.secretKey,
    });
    return internalClient;
}

function getPublicClient() {
    if (publicClient) return publicClient;
    const raw = env.minio.publicUrl;
    if (!raw) {
        // No public URL configured — fall back to the internal client. Fine
        // for local dev where MINIO_ENDPOINT is browser-reachable.
        return getClient();
    }
    let host;
    let port;
    let useSSL;
    try {
        const u = new URL(raw);
        host = u.hostname;
        useSSL = u.protocol === 'https:';
        port = u.port ? Number(u.port) : (useSSL ? 443 : 80);
    } catch {
        throw new Error(`MINIO_PUBLIC_URL is not a valid URL: ${raw}`);
    }
    if (!env.minio.accessKey || !env.minio.secretKey) {
        throw new Error(
            'MinIO is not configured: set MINIO_ACCESS_KEY, MINIO_SECRET_KEY',
        );
    }
    publicClient = new Client({
        endPoint: host,
        port,
        useSSL,
        accessKey: env.minio.accessKey,
        secretKey: env.minio.secretKey,
    });
    return publicClient;
}

module.exports = {
    getClient,
    getPublicClient,
    bucketAttachments: env.minio.bucketAttachments,
    bucketAvatars: env.minio.bucketAvatars,
};
