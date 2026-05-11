import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawInvoice, InvoiceData, PdfFonts, PdfAssets } from './invoice-template';

const R2_IMAGE_PATHS = {
  logo: 'images/header-logo.png',
  signatureStamp: 'images/signature-stamp.png',
  companyChop: 'images/company-chop.png',
};

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

async function embedImages(pdfDoc: PDFDocument, bucket: R2Bucket): Promise<PdfAssets> {
  const images: PdfAssets = {};

  const logoBytes = await loadFromR2(bucket, R2_IMAGE_PATHS.logo);
  if (logoBytes) images.logoImage = await pdfDoc.embedPng(logoBytes);

  const sigBytes = await loadFromR2(bucket, R2_IMAGE_PATHS.signatureStamp);
  if (sigBytes) images.signatureStampImage = await pdfDoc.embedPng(sigBytes);

  const chopBytes = await loadFromR2(bucket, R2_IMAGE_PATHS.companyChop);
  if (chopBytes) images.companyChopImage = await pdfDoc.embedPng(chopBytes);

  return images;
}

export async function generateInvoicePDF(bucket: R2Bucket, data: InvoiceData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedFonts(pdfDoc);
  const images = await embedImages(pdfDoc, bucket);
  drawInvoice(pdfDoc, data, fonts, images);
  return pdfDoc.save();
}
