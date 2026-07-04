import { google } from 'googleapis';
import { env } from '../config/env';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
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
