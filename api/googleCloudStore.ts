import { readFileSync } from 'node:fs'
import { GoogleAuth } from 'google-auth-library'

declare const process: {
  env: Record<string, string | undefined>
}

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | undefined
let serviceAccountCache: ServiceAccountCredential | undefined
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] })

type ServiceAccountCredential = {
  projectId: string
  clientEmail: string
  privateKey: string
}

export function hasGoogleCloudDb() {
  const credential = getServiceAccountCredential()
  return Boolean(getProjectId() && (shouldUseApplicationDefaultCredentials() || (credential.clientEmail && credential.privateKey)))
}

export function googlePersistenceLabel() {
  return hasGoogleCloudDb() ? 'google-cloud-firestore' : 'serverless-memory'
}

export async function readGoogleJson<T>(documentId: string, fallback: T): Promise<T> {
  if (!hasGoogleCloudDb()) return fallback

  const response = await fetch(documentUrl(documentId), {
    headers: { authorization: `Bearer ${await getAccessToken()}` },
  })

  if (response.status === 404) return fallback
  const payload = await response.json() as { fields?: { payload?: { stringValue?: string } }; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `Firestore returned ${response.status}`)

  const stored = payload.fields?.payload?.stringValue
  return stored ? JSON.parse(stored) as T : fallback
}

export async function writeGoogleJson(documentId: string, value: unknown): Promise<void> {
  if (!hasGoogleCloudDb()) return

  const response = await fetch(`${documentUrl(documentId)}?updateMask.fieldPaths=payload&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${await getAccessToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        payload: { stringValue: JSON.stringify(value) },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(payload.error?.message ?? `Firestore returned ${response.status}`)
  }
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (tokenCache && tokenCache.expiresAt - 60 > now) return tokenCache.accessToken

  if (shouldUseApplicationDefaultCredentials()) {
    const client = await googleAuth.getClient()
    const result = await client.getAccessToken()
    const accessToken = typeof result === 'string' ? result : result.token
    if (!accessToken) throw new Error('Google Application Default Credentials returned no access token')
    tokenCache = { accessToken, expiresAt: now + 3000 }
    return accessToken
  }

  const assertion = await signJwt(now)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? `Google OAuth returned ${response.status}`)
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600),
  }
  return tokenCache.accessToken
}

async function signJwt(now: number) {
  const { clientEmail, privateKey } = getServiceAccountCredential()
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const unsigned = `${header}.${claim}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64Url(signature)}`
}

function documentUrl(documentId: string) {
  const projectId = encodeURIComponent(getProjectId())
  const database = encodeURIComponent(process.env.GOOGLE_FIRESTORE_DATABASE ?? '(default)')
  const collection = encodeURIComponent(process.env.ABBY_FIRESTORE_COLLECTION ?? 'abby_app_state')
  const document = encodeURIComponent(documentId)
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/${collection}/${document}`
}

function getProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCP_PROJECT_ID
    ?? getServiceAccountCredential().projectId
}

function shouldUseApplicationDefaultCredentials() {
  return process.env.GOOGLE_USE_ADC === 'true'
}

function getServiceAccountCredential(): ServiceAccountCredential {
  if (serviceAccountCache) return serviceAccountCache

  const envCredential = {
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID ?? '',
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL ?? '',
    privateKey: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY ?? ''),
  }
  if (envCredential.clientEmail && envCredential.privateKey) {
    serviceAccountCache = envCredential
    return envCredential
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialPath) return envCredential
  try {
    const file = JSON.parse(readFileSync(credentialPath, 'utf8')) as {
      project_id?: string
      client_email?: string
      private_key?: string
    }
    serviceAccountCache = {
      projectId: file.project_id ?? envCredential.projectId,
      clientEmail: file.client_email ?? '',
      privateKey: normalizePrivateKey(file.private_key ?? ''),
    }
    return serviceAccountCache
  } catch {
    return envCredential
  }
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n')
}

function pemToArrayBuffer(value: string) {
  const base64 = value
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function base64Url(value: string | ArrayBuffer) {
  const binary = typeof value === 'string'
    ? value
    : String.fromCharCode(...new Uint8Array(value))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
