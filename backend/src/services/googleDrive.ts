import { google } from 'googleapis';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

function driveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth });
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
  });
  const folder = folderRes.data.files?.[0];
  if (!folder?.id) {
    throw new Error(`Carpeta '${folderName}' no encontrada en Drive`);
  }

  const filesRes = await drive.files.list({
    q: `'${folder.id}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
  });
  return (filesRes.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
  }));
}

export async function downloadFileAsBase64(
  accessToken: string,
  fileId: string,
): Promise<{ data: string; mimeType: string }> {
  const drive = driveClient(accessToken);

  const metaRes = await drive.files.get({ fileId, fields: 'mimeType' });
  const mimeType = metaRes.data.mimeType ?? 'image/jpeg';

  const fileRes = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  const data = Buffer.from(fileRes.data as ArrayBuffer).toString('base64');

  return { data, mimeType };
}
