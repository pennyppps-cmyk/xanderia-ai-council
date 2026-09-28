import { config } from '../config.js';

/**
 * Word → PDF through a Gotenberg (LibreOffice) service on the server, when one is configured
 * (PDF_CONVERTER_URL). Without it the workspace produces Word documents.
 */
export const pdfAvailable = () => !!config.PDF_CONVERTER_URL;

export async function docxToPdf(docx: Buffer, name = 'document.docx'): Promise<Buffer> {
  if (!config.PDF_CONVERTER_URL) throw new Error('PDF conversion is not set up on this server');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(docx)]), name.endsWith('.docx') ? name : `${name}.docx`);
  const res = await fetch(`${config.PDF_CONVERTER_URL.replace(/\/+$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`PDF conversion failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
