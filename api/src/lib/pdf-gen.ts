import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawInvoice, InvoiceData, PdfFonts, PdfAssets } from './invoice-template';

const R2_IMAGE_PATHS = {
  logo: 'images/header-logo.png',
  signatureStamp: 'images/signature-stamp.png',
  companyChop: 'images/company-chop.png',
};

function tenantKey(userId: string, key: string) {
  return `tenants/${userId}/${key}`;
}

async function loadFromR2(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  } catch {
    return null;
  }
}

async function embedFonts(pdfDoc: PDFDocument): Promise<PdfFonts> {
  return {
    arial: await pdfDoc.embedFont(StandardFonts.Helvetica),
    tnr: await pdfDoc.embedFont(StandardFonts.TimesRoman),
  };
}

async function embedImages(pdfDoc: PDFDocument, bucket: R2Bucket, userId?: string): Promise<PdfAssets> {
  const images: PdfAssets = {};

  for (const [name, globalKey] of Object.entries(R2_IMAGE_PATHS)) {
    let bytes: Uint8Array | null = null;
    if (userId) bytes = await loadFromR2(bucket, tenantKey(userId, globalKey));
    if (!bytes) bytes = await loadFromR2(bucket, globalKey);
    if (!bytes) continue;
    if (name === 'logo') images.logoImage = await pdfDoc.embedPng(bytes);
    else if (name === 'signatureStamp') images.signatureStampImage = await pdfDoc.embedPng(bytes);
    else if (name === 'companyChop') images.companyChopImage = await pdfDoc.embedPng(bytes);
  }

  return images;
}

export async function generateInvoicePDF(bucket: R2Bucket, data: InvoiceData, userId?: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedFonts(pdfDoc);
  const images = await embedImages(pdfDoc, bucket, userId);
  drawInvoice(pdfDoc, data, fonts, images);
  return pdfDoc.save();
}
