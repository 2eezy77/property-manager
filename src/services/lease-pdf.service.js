/**
 * lease-pdf.service.js
 * Generates Montero Rentals Virginia room lease PDFs for 743 A Ave.
 */

const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const {
  LEASE_PARTIES,
  PROPERTY_ADDRESS,
  defaultTermsForRoomType,
} = require('./native-lease.constants');

const DOCS_DIR = path.resolve(__dirname, '../../documents');

const DEFAULT_FURNISHINGS = [
  'Bed frame and mattress, if supplied for the room',
  'Shared kitchen appliances',
  'Shared laundry appliances',
  'Shared living room furnishings',
  'Window coverings and installed fixtures',
];

const DEFAULT_DAMAGE_CHARGES = [
  { item: 'Lost key or lock replacement', amount: 125 },
  { item: 'Room repainting beyond normal wear', amount: 350 },
  { item: 'Mattress replacement', amount: 450 },
  { item: 'Shared appliance damage', amount: 800 },
  { item: 'Excess cleaning', amount: 250 },
];

function ensureDocumentsDir() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function safeFilePart(value) {
  return String(value || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function currency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return '_______________';
  if (value instanceof Date) {
    return value.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = parts
    ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateTime(value) {
  if (!value) return '_______________';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function leaseResult(filename, filepath) {
  return {
    filename,
    filepath,
    relativePath: `/documents/${filename}`,
  };
}

function normalizeLeaseData(data) {
  const roomDefaults = defaultTermsForRoomType(data.roomType || 'regular');
  return {
    ...roomDefaults,
    ...data,
    leaseId: data.leaseId || `draft-${Date.now()}`,
    roomType: String(data.roomType || roomDefaults.roomType).toLowerCase(),
    monthlyRent: data.monthlyRent ?? roomDefaults.monthlyRent,
    securityDeposit: data.securityDeposit ?? roomDefaults.securityDeposit,
    gracePeriodDays: data.gracePeriodDays ?? roomDefaults.gracePeriodDays,
    lateFeeAmount: data.lateFeeAmount ?? roomDefaults.lateFeeAmount,
    nsfFee: data.nsfFee ?? roomDefaults.nsfFee,
    houseRules: {
      smoking: false,
      pets: false,
      quietHours: '10pm-8am',
      guestNights: 7,
      ...(data.houseRules || {}),
    },
    furnishings: data.furnishings || DEFAULT_FURNISHINGS,
    damageCharges: data.damageCharges || DEFAULT_DAMAGE_CHARGES,
  };
}

async function writePdf(filepath, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 72, bufferPages: true });
    const stream = fs.createWriteStream(filepath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);
    draw(doc);
    doc.end();
  });
}

function buildLeaseLayout(doc, lease) {
  const left = 72;
  const width = doc.page.width - 144;
  const dark = '#111827';
  const muted = '#4b5563';
  const blue = '#1e40af';
  const lightBlue = '#dbeafe';
  const line = '#d1d5db';
  const roomDescription = `${titleCase(lease.roomType)} room${lease.unitNumber ? ` ${lease.unitNumber}` : ''}`;
  const landlordNames = LEASE_PARTIES.landlords.map((party) => party.name).join(' and ');
  const propertyManager = LEASE_PARTIES.propertyManager;

  function pageBreak(needed = 100) {
    if (doc.y + needed > doc.page.height - 72) doc.addPage();
  }

  function paragraph(text, options = {}) {
    pageBreak(options.needed || 70);
    doc.font('Helvetica').fontSize(9.5).fillColor(dark)
      .text(text, left, doc.y, { width, align: 'left', lineGap: 2, ...options });
    doc.moveDown(0.65);
  }

  function bullet(text) {
    pageBreak(30);
    doc.font('Helvetica').fontSize(9.5).fillColor(dark)
      .text(`- ${text}`, left + 14, doc.y, { width: width - 14, lineGap: 2 });
    doc.moveDown(0.35);
  }

  function row(label, value) {
    pageBreak(24);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted)
      .text(label, left, y, { width: 150 });
    doc.font('Helvetica').fontSize(9).fillColor(dark)
      .text(String(value ?? ''), left + 155, y, { width: width - 155 });
    doc.moveDown(0.45);
  }

  function section(number, title) {
    pageBreak(72);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(left, y, width, 22).fill(lightBlue);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(blue)
      .text(`${number}. ${title.toUpperCase()}`, left + 8, y + 6, { width: width - 16 });
    doc.y = y + 32;
  }

  function signatureBlock(label, name, x, y) {
    const blockWidth = (width - 36) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted)
      .text(label, x, y, { width: blockWidth });
    doc.rect(x, y + 34, blockWidth, 0.5).fill(line);
    doc.font('Helvetica').fontSize(9).fillColor(dark)
      .text(name || '', x, y + 38, { width: blockWidth });
    doc.font('Helvetica').fontSize(7.5).fillColor(muted)
      .text('Signature', x, y + 51, { width: blockWidth });
    doc.rect(x, y + 82, blockWidth, 0.5).fill(line);
    doc.font('Helvetica').fontSize(9).fillColor(dark)
      .text(name || '', x, y + 86, { width: blockWidth });
    doc.font('Helvetica').fontSize(7.5).fillColor(muted)
      .text('Printed Name', x, y + 99, { width: blockWidth });
    doc.rect(x, y + 130, blockWidth, 0.5).fill(line);
    doc.font('Helvetica').fontSize(7.5).fillColor(muted)
      .text('Date', x, y + 134, { width: blockWidth });
  }

  doc.rect(left, 56, width, 3).fill(blue);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(dark)
    .text('MONTERO RENTALS VIRGINIA ROOM LEASE', left, 72, { width, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(muted)
    .text(`Generated for ${PROPERTY_ADDRESS.full}`, left, 96, { width, align: 'center' });
  doc.rect(left, 112, width, 3).fill(blue);
  doc.y = 140;

  section(1, 'Parties');
  paragraph('This Virginia room lease agreement is entered into by the Landlord, the Property Manager acting as agent for Landlord, and the Tenant identified below.');
  row('Landlord:', landlordNames);
  row('Property Manager:', `${propertyManager.name}, ${propertyManager.title}`);
  row('Tenant:', lease.tenantName || '_______________');

  section(2, 'Property and Room');
  row('Property:', PROPERTY_ADDRESS.full);
  row('Room:', roomDescription);
  paragraph(`Landlord leases to Tenant the private ${roomDescription} at ${PROPERTY_ADDRESS.full}, together with shared use of common areas including the kitchen, bathrooms, laundry area, living areas, hallways, and other common areas designated by Landlord or Property Manager.`);
  paragraph('Tenant shall use the room and shared areas only as a residence. Tenant may not assign this Agreement or sublet the room without prior written consent from Landlord or Property Manager.');

  section(3, 'Term');
  row('Start Date:', formatDate(lease.startDate));
  row('End Date:', formatDate(lease.endDate));
  paragraph('The lease term begins on the start date and ends on the end date listed above unless renewed or terminated earlier according to this Agreement and applicable Virginia law.');

  section(4, 'Rent and Payment');
  row('Monthly Rent:', `$${currency(lease.monthlyRent)}`);
  row('Rent Due:', '1st day of each month');
  row('Grace Period:', `${lease.gracePeriodDays} day${lease.gracePeriodDays === 1 ? '' : 's'}`);
  row('Late Fee:', `$${currency(lease.lateFeeAmount)} flat fee`);
  row('NSF / Returned Payment Fee:', `$${currency(lease.nsfFee)} per occurrence`);
  paragraph(`Tenant shall pay monthly rent of $${currency(lease.monthlyRent)} through the Montero tenant portal. Accepted portal payment methods are card, ACH, and Cash App Pay. Rent is due on the 1st day of each month.`);
  paragraph(`If rent is not received after the ${lease.gracePeriodDays}-day grace period, Tenant owes a late fee of $${currency(lease.lateFeeAmount)}. Returned or rejected payments incur an NSF fee of $${currency(lease.nsfFee)} per occurrence.`);

  section(5, 'Security Deposit');
  row('Security Deposit:', `$${currency(lease.securityDeposit)}`);
  paragraph(`Tenant shall pay a security deposit of $${currency(lease.securityDeposit)}. Landlord will hold and return the deposit, less lawful deductions, according to the Virginia Residential Landlord and Tenant Act.`);

  section(6, 'Utilities');
  paragraph('Utilities are shared for the property. Tenant is responsible for the assigned share of utilities and must review, receive, and pay utility charges through the Montero tenant portal unless Property Manager provides written instructions otherwise.');
  paragraph('Utility allocations may include electricity, water, sewer, gas, internet, trash, or other shared services serving the property.');

  section(7, 'Entry');
  paragraph('Landlord or Property Manager may enter the room or shared areas as allowed by Virginia law, including for inspection, repairs, maintenance, services, showings, emergencies, or other lawful purposes. Except in emergencies or as otherwise allowed by law, reasonable notice will be provided before entry into the tenant room.');

  section(8, 'House Rules');
  bullet(`Smoking permitted: ${lease.houseRules.smoking ? 'Yes' : 'No'}.`);
  bullet(`Pets permitted: ${lease.houseRules.pets ? 'Yes' : 'No'}.`);
  bullet(`Quiet hours: ${lease.houseRules.quietHours}.`);
  bullet(`Guest overnight limit: ${lease.houseRules.guestNights} night${lease.houseRules.guestNights === 1 ? '' : 's'} unless Property Manager approves otherwise in writing.`);
  bullet('Tenant shall keep the room clean, protect shared spaces, promptly report maintenance issues, and avoid disturbing other occupants.');

  section(9, 'Furnishings and Damage Schedule');
  paragraph('The following furnishings, fixtures, or shared items may be supplied for the room or common areas:');
  lease.furnishings.forEach((item) => bullet(item));
  paragraph('Tenant is responsible for damage beyond ordinary wear and tear. The following default damage schedule may be used unless actual repair or replacement costs differ:');
  pageBreak(lease.damageCharges.length * 22 + 40);
  const tableY = doc.y;
  doc.rect(left, tableY, width, 18).fill(lightBlue);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(blue)
    .text('Item', left + 6, tableY + 4, { width: width * 0.65 })
    .text('Charge', left + width * 0.65, tableY + 4, { width: width * 0.35 - 6, align: 'right' });
  doc.y = tableY + 22;
  lease.damageCharges.forEach((charge, index) => {
    const rowY = doc.y;
    if (index % 2 === 1) doc.rect(left, rowY - 2, width, 18).fill('#f8fafc');
    doc.font('Helvetica').fontSize(9).fillColor(dark)
      .text(charge.item, left + 6, rowY, { width: width * 0.65 })
      .text(`$${currency(charge.amount)}`, left + width * 0.65, rowY, { width: width * 0.35 - 6, align: 'right' });
    doc.y = rowY + 18;
  });

  section(10, 'Governing Law');
  paragraph('This Agreement is governed by the laws of the Commonwealth of Virginia, including the Virginia Residential Landlord and Tenant Act (VRLTA), Chapter 12 of Title 55.1 of the Code of Virginia, to the extent applicable.');
  paragraph('Venue for disputes concerning the property is the appropriate court serving Norfolk, Virginia.');

  section(11, 'Signature Blocks');
  paragraph('By signing below, Tenant and Property Manager acting as agent for Landlord agree to the terms of this Montero Rentals Virginia room lease.');
  pageBreak(180);
  const sigY = doc.y + 12;
  signatureBlock('TENANT', lease.tenantName || '', left, sigY);
  signatureBlock('PROPERTY MANAGER AS AGENT', propertyManager.name, left + ((width - 36) / 2) + 36, sigY);
  doc.y = sigY + 166;

  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 42;
    doc.rect(left, footerY - 6, width, 0.5).fill(blue);
    doc.font('Helvetica').fontSize(7.5).fillColor(muted)
      .text(
        `${PROPERTY_ADDRESS.full} - Lease ID: ${lease.leaseId} - Page ${i + 1} of ${totalPages} - VRLTA`,
        left,
        footerY,
        { width, align: 'center' },
      );
  }
}

async function generateRoomLeasePdf(data) {
  ensureDocumentsDir();
  const lease = normalizeLeaseData(data || {});
  const filename = `lease-${safeFilePart(lease.leaseId)}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  await writePdf(filepath, (doc) => buildLeaseLayout(doc, lease));
  return leaseResult(filename, filepath);
}

function imageBufferFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}

async function embedSignatureImage(pdfDoc, imageDataUrl) {
  const parsed = imageBufferFromDataUrl(imageDataUrl);
  if (!parsed) return null;
  if (parsed.mime === 'png') {
    return pdfDoc.embedPng(parsed.buffer);
  }
  return pdfDoc.embedJpg(parsed.buffer);
}

async function buildSignaturePage(pdfDoc, sourcePath, signatures) {
  const page = pdfDoc.addPage([612, 792]);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 72;
  const contentWidth = width - margin * 2;
  const dark = rgb(0.07, 0.09, 0.15);
  const blue = rgb(0.12, 0.25, 0.69);
  const muted = rgb(0.29, 0.34, 0.39);
  const lightBlue = rgb(0.82, 0.88, 0.98);

  page.drawRectangle({
    x: margin,
    y: height - margin - 3,
    width: contentWidth,
    height: 3,
    color: blue,
  });

  let y = height - margin - 24;
  page.drawText('MONTERO RENTALS LEASE SIGNATURE PAGE', {
    x: margin,
    y,
    size: 16,
    font: helveticaBold,
    color: dark,
  });
  y -= 26;
  page.drawText(`Source document: ${path.basename(sourcePath)}`, {
    x: margin,
    y,
    size: 9,
    font: helvetica,
    color: muted,
  });
  y -= 14;
  page.drawText(PROPERTY_ADDRESS.full, {
    x: margin,
    y,
    size: 9,
    font: helvetica,
    color: muted,
  });
  y -= 20;
  page.drawRectangle({
    x: margin,
    y: y - 1,
    width: contentWidth,
    height: 1,
    color: lightBlue,
  });
  y -= 28;

  const rows = Array.isArray(signatures) ? signatures : [];
  if (rows.length === 0) {
    page.drawText('No signatures were provided.', {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: dark,
    });
    return;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const signature = rows[index];

    page.drawText(`${index + 1}. ${signature.role || 'Signer'}`, {
      x: margin,
      y,
      size: 11,
      font: helveticaBold,
      color: dark,
    });
    y -= 18;
    page.drawText(`Name: ${signature.name || ''}`, {
      x: margin + 20,
      y,
      size: 10,
      font: helvetica,
      color: dark,
    });
    y -= 16;
    page.drawText(`Signed at: ${formatDateTime(signature.signedAt)}`, {
      x: margin + 20,
      y,
      size: 10,
      font: helvetica,
      color: dark,
    });
    y -= 16;

    if (signature.imageDataUrl) {
      const image = await embedSignatureImage(pdfDoc, signature.imageDataUrl);
      if (image) {
        const maxWidth = 180;
        const maxHeight = 48;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        page.drawImage(image, {
          x: margin + 20,
          y: y - drawHeight,
          width: drawWidth,
          height: drawHeight,
        });
        y -= drawHeight + 12;
      } else {
        page.drawText('Signature image: invalid or unsupported format', {
          x: margin + 20,
          y,
          size: 8,
          font: helvetica,
          color: muted,
        });
        y -= 14;
      }
    } else {
      page.drawText('Signature: typed / electronic acknowledgment', {
        x: margin + 20,
        y,
        size: 8,
        font: helvetica,
        color: muted,
      });
      y -= 14;
    }

    y -= 20;
  }
}

async function flattenSignaturesOntoPdf({ sourcePath, outputFilename, signatures }) {
  if (!sourcePath) {
    throw new Error('sourcePath is required');
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source PDF not found: ${sourcePath}`);
  }

  ensureDocumentsDir();
  const sourceBase = path.basename(sourcePath, '.pdf');
  const filename = path.basename(outputFilename || `${sourceBase}-signed.pdf`);
  const filepath = path.join(DOCS_DIR, filename);

  const sourceBuffer = fs.readFileSync(sourcePath);
  const pdfDoc = await PdfLibDocument.load(sourceBuffer);
  await buildSignaturePage(pdfDoc, sourcePath, signatures);
  const signedBuffer = await pdfDoc.save();
  fs.writeFileSync(filepath, signedBuffer);

  return leaseResult(filename, filepath);
}

module.exports = {
  generateRoomLeasePdf,
  generateLeasePdf: generateRoomLeasePdf,
  flattenSignaturesOntoPdf,
  // Pure helpers exported for unit tests (PDF generation behavior unchanged).
  normalizeLeaseData,
  safeFilePart,
  formatDate,
};
