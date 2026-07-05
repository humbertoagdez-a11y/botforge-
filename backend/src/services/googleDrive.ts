import { google } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

interface StoredConnection {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}

/** Margen antes del vencimiento para refrescar proactivamente */
const REFRESH_MARGIN_MS = 60 * 1000;

/**
 * Devuelve un access token válido para la conexión: si expiresAt ya pasó
 * (o está por pasar), lo renueva con el refreshToken y persiste el nuevo
 * token + vencimiento en la BD. Nunca loguea los tokens.
 */
export async function getValidAccessToken(conn: StoredConnection): Promise<string> {
  const needsRefresh =
    conn.expiresAt !== null && conn.expiresAt.getTime() < Date.now() + REFRESH_MARGIN_MS;
  if (!needsRefresh) return conn.accessToken;

  const client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: conn.refreshToken });
  const { credentials } = await client.refreshAccessToken();

  const accessToken = credentials.access_token;
  if (!accessToken) {
    throw new Error('Google no devolvió un access token nuevo; reconectá Drive desde el panel');
  }

  await prisma.driveConnection.update({
    where: { id: conn.id },
    data: {
      accessToken,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
    },
  });

  return accessToken;
}

function getAuthClient(accessToken: string) {
  // Con client id/secret el cliente puede refrescar tokens cuando se
  // implemente el flujo OAuth2 completo (hoy usa el access token directo)
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function driveClient(accessToken: string) {
  return google.drive({ version: 'v3', auth: getAuthClient(accessToken) });
}

export async function getFilesFromFolder(
  accessToken: string,
  folderName = 'catálogo',
): Promise<DriveFile[]> {
  const drive = driveClient(accessToken);

  const escaped = folderName.replace(/'/g, "\\'");
  const folderRes = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1,
  });
  const folder = folderRes.data.files?.[0];
  if (!folder?.id) {
    throw new Error(`Carpeta '${folderName}' no encontrada en Drive`);
  }

  const filesRes = await drive.files.list({
    q: `'${folder.id}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 50,
  });
  return (filesRes.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
  }));
}

/** Búsqueda fuzzy por nombre dentro de la carpeta configurada. */
export async function searchFileByName(
  accessToken: string,
  folderName: string,
  searchQuery: string,
): Promise<DriveFile | null> {
  const files = await getFilesFromFolder(accessToken, folderName);
  const query = searchQuery.toLowerCase();

  const match = files.find(
    (f) =>
      f.name.toLowerCase().includes(query) ||
      query.split(' ').some((word) => word.length > 3 && f.name.toLowerCase().includes(word)),
  );

  return match ?? null;
}

export async function downloadFileAsBase64(
  accessToken: string,
  fileId: string,
): Promise<{ data: string; mimeType: string }> {
  const drive = driveClient(accessToken);

  const metaRes = await drive.files.get({ fileId, fields: 'mimeType,name' });
  const mimeType = metaRes.data.mimeType ?? 'image/jpeg';

  const fileRes = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  const data = Buffer.from(fileRes.data as ArrayBuffer).toString('base64');

  return { data, mimeType };
}
