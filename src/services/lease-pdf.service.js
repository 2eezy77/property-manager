/**
 * lease-pdf.service.js
 * Generates a Virginia Residential Lease Agreement PDF matching the
 * Rocket Lawyer format used at 743 A Ave, Norfolk VA 23504.
 * Compliant with VRLTA (Chapter 12, Title 55.1, Code of Virginia).
 */

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

const DOCS_DIR = path.resolve(__dirname, '../../documents');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '_______________';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtDateShort(d) {
  if (!d) return '_______________';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function generateLeasePdf(data) {
  const filename = `lease-${data.leaseId}.pdf`;
  const filepath  = path.join(DOCS_DIR, filename);

  const nsfFee       = data.nsfFee != null ? data.nsfFee : 50;
  const earlyTermDays = data.earlyTermDays != null ? data.earlyTermDays : 30;
  const furnishings  = data.furnishings || [
    'Sofa', 'Bed', 'Kitchen Table', 'Dining Table', 'Television',
    'Refrigerator', 'Samsung TV', 'Washer & Dryer', 'Dishwasher'
  ];
  const damageCharges = data.damageCharges || [
    { item: 'Samsung TV',       amount: 1000 },
    { item: 'Refrigerator',     amount: 1200 },
    { item: 'Washer & Dryer',   amount: 1500 },
    { item: 'Dish Washer',      amount: 800  },
  ];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72, size: 'LETTER', bufferPages: true });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);

    const W    = doc.page.width - 144;
    const L    = 72;
    const GRAY  = '#555555';
    const DARK  = '#111111';
    const BLUE  = '#1e40af';
    const LBLUE = '#dbeafe';
    const LINE  = '#cccccc';

    function checkPageBreak(needed) {
      if (!needed) needed = 120;
      if (doc.y + needed > doc.page.height - 100) doc.addPage();
    }

    function section(num, title) {
      checkPageBreak(60);
      doc.moveDown(0.6);
      const y = doc.y;
      doc.rect(L, y, W, 20).fill(LBLUE);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE)
         .text('§' + num + '  ' + title.toUpperCase(), L + 8, y + 5, { width: W - 16 });
      doc.moveDown(1.1);
      doc.font('Helvetica').fontSize(9.5).fillColor(DARK);
    }

    function row(label, value, indent) {
      indent = indent || 0;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY)
         .text(label, L + indent, y, { width: 170, continued: false });
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
         .text(String(value != null ? value : '--'), L + indent + 175, y, { width: W - 175 - indent });
      doc.moveDown(0.35);
    }

    function para(text, opts) {
      if (!opts) opts = {};
      doc.font('Helvetica').fontSize(9.5).fillColor(DARK)
         .text(text, L, doc.y, Object.assign({ width: W, align: 'justify' }, opts));
      doc.moveDown(0.5);
    }

    function bullet(text) {
      doc.font('Helvetica').fontSize(9.5).fillColor(DARK)
         .text('• ' + text, L + 12, doc.y, { width: W - 12, align: 'left' });
      doc.moveDown(0.3);
    }

    // COVER HEADER
    doc.rect(L, 56, W, 3).fill(BLUE);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK)
       .text('VIRGINIA RESIDENTIAL LEASE AGREEMENT', L, 70, { align: 'center', width: W });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
       .text(
         'Pursuant to Chapter 12, Title 55.1, Code of Virginia (VRLTA)  ·  ' +
         'Generated ' + new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }),
         L, 92, { align: 'center', width: W }
       );
    doc.rect(L, 108, W, 3).fill(BLUE);
    doc.moveDown(2);

    // RECEIPT OF DEPOSIT BOX
    if (data.securityDeposit > 0) {
      const bY = doc.y;
      doc.rect(L, bY, W, 56).stroke(BLUE);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE)
         .text('RECEIPT OF SECURITY DEPOSIT', L + 10, bY + 8, { width: W - 20, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
         .text(
           'Landlord acknowledges receipt of $' + fmt(data.securityDeposit) + ' as a security deposit from Tenant. ' +
           'This deposit will be held and returned within 45 days after termination, per §55.1-1226, VRLTA.',
           L + 10, bY + 22, { width: W - 20 }
         );
      doc.y = bY + 64;
      doc.moveDown(0.5);
    }

    // S1 PARTIES
    section(1, 'Parties');
    para('This Virginia Residential Lease Agreement ("Agreement") is entered into on ' + fmtDate(data.startDate) + ', by and between:');
    row('Landlord:', data.landlordName || '_______________');
    if (data.coLandlordName) row('Co-Landlord:', data.coLandlordName);
    row('Landlord Address:', data.landlordAddress || '_______________');
    doc.moveDown(0.2);
    row('Tenant:', data.tenantName || '_______________');
    if (data.tenantEmail) row('Tenant Email:', data.tenantEmail);
    if (data.tenantPhone) row('Tenant Phone:', data.tenantPhone);
    doc.moveDown(0.2);
    if (data.propertyManagerName) {
      row('Property Manager:', data.propertyManagerName);
      if (data.propertyManagerPhone) row('PM Phone:', data.propertyManagerPhone);
      if (data.propertyManagerAddress) row('PM Address:', data.propertyManagerAddress);
    }

    // S2 PREMISES
    section(2, 'Premises');
    para('Landlord hereby leases to Tenant the following private room within the residential property:');
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
       .text(data.propertyAddress || '_______________', L + 20, doc.y, { width: W - 40, align: 'center' });
    doc.moveDown(0.5);
    if (data.roomDescription) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
         .text('Room: ' + data.roomDescription, L + 20, doc.y, { width: W - 40, align: 'center' });
      doc.moveDown(0.5);
    }
    para('Tenant has the right to occupy the above-described room ("Premises") and shared access to common areas including the kitchen, living room, and hallways. Tenant shall use the Premises solely for residential purposes. Tenant shall not sublet or assign the Premises or any part thereof without Landlord\'s prior written consent.');

    // S3 LEASE TERM
    section(3, 'Lease Term');
    row('Start Date:', fmtDate(data.startDate));
    row('End Date:', fmtDate(data.endDate));
    if (data.autoMonthToMonth) {
      para('This Agreement shall commence on the Start Date and continue through the End Date, after which it shall automatically convert to a month-to-month tenancy under the same terms and conditions, unless either party provides written notice of termination at least 30 days prior to the desired termination date.');
    } else {
      para('This Agreement shall commence on the Start Date and terminate on the End Date. This is a fixed-term tenancy. Unless a new agreement is signed, Tenant must vacate the Premises no later than the End Date.');
    }

    // S4 RENT
    section(4, 'Rent');
    row('Monthly Rent:', '$' + fmt(data.monthlyRent));
    row('Due Date:', '1st day of each month');
    row('Delinquent After:', '1st day (immediately upon due date)');
    row('Grace Period:', (data.gracePeriodDays || 5) + ' days');
    var lateFeeDesc = data.lateFeeType === 'percent'
      ? data.lateFeeAmount + '% of monthly rent'
      : '$' + fmt(data.lateFeeAmount || 0) + ' flat fee';
    row('Late Fee:', lateFeeDesc + ' (assessed after grace period)');
    row('NSF / Returned Check Fee:', '$' + fmt(nsfFee) + ' per occurrence');
    doc.moveDown(0.3);
    para('Rent is due on the 1st day of each month. A grace period of ' + (data.gracePeriodDays || 5) + ' days is provided; if rent remains unpaid after the grace period, a late fee of ' + lateFeeDesc + ' will be assessed. Three (3) returned checks shall constitute just cause for termination. NSF fee of $' + fmt(nsfFee) + ' applies to each returned check.');

    // S5 SECURITY DEPOSIT
    section(5, 'Security Deposit');
    row('Security Deposit:', '$' + fmt(data.securityDeposit || 0));
    if (data.securityDeposit > 0) {
      para('Tenant has deposited $' + fmt(data.securityDeposit) + ' as a security deposit. Per §55.1-1226 of the VRLTA, Landlord shall return the security deposit, with any deductions itemized in writing, within 45 days after termination of tenancy. Deductions may be made for unpaid rent, cleaning fees, and damages beyond normal wear and tear.');
    } else {
      para('No security deposit is required under this Agreement.');
    }

    // S6 UTILITIES
    section(6, 'Utilities');
    para('Tenant is responsible for paying all utilities directly, including but not limited to electricity, gas, water/sewer, trash, and internet. Utilities shared among multiple tenants shall be divided equally among all occupants unless otherwise agreed in writing.');

    // S7 FURNISHINGS
    section(7, 'Furnishings & Appliances');
    para('The following furnishings and appliances are included with the Premises:');
    var col = 0;
    var colW = Math.floor(W / 3);
    var rowStartY = doc.y;
    furnishings.forEach(function(item, i) {
      var x = L + (col * colW);
      if (col === 0 && i > 0) rowStartY = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
         .text('• ' + item, x, col === 0 ? doc.y : rowStartY, { width: colW - 10, continued: false });
      col++;
      if (col >= 3) { col = 0; doc.moveDown(0.1); }
    });
    if (col > 0) doc.moveDown(0.3);
    doc.moveDown(0.5);
    para('Tenant acknowledges the above furnishings are in good and working condition upon move-in. Tenant shall be responsible for any damage beyond normal wear and tear.');

    // S8 DAMAGE CHARGES
    section(8, 'Damage Charge Schedule');
    para('The following replacement cost schedule shall apply for damage beyond normal wear and tear:');
    checkPageBreak(damageCharges.length * 22 + 40);
    var tHdrY = doc.y;
    doc.rect(L, tHdrY, W, 18).fill(LBLUE);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE)
       .text('Item', L + 6, tHdrY + 4, { width: W * 0.65 })
       .text('Replacement Cost', L + W * 0.65, tHdrY + 4, { width: W * 0.35, align: 'right' });
    doc.y = tHdrY + 20;
    damageCharges.forEach(function(dc, i) {
      var rowY = doc.y;
      if (i % 2 === 1) doc.rect(L, rowY, W, 16).fill('#f8fafc');
      doc.font('Helvetica').fontSize(9).fillColor(DARK)
         .text(dc.item, L + 6, rowY + 2, { width: W * 0.65 })
         .text('$' + fmt(dc.amount), L + W * 0.65, rowY + 2, { width: W * 0.35 - 6, align: 'right' });
      doc.y = rowY + 18;
    });
    doc.moveDown(0.5);
    para('Actual replacement costs at time of damage may be used in lieu of the above schedule. Tenant will be billed for damage beyond normal wear and tear upon move-out.');

    // S9 TENANT RESPONSIBILITIES
    section(9, 'Tenant Responsibilities');
    para('Tenant shall be responsible for the following:');
    bullet('All interior fixtures, including light fixtures, faucets, and handles');
    bullet('Heating system filters -- must be replaced every 60 days');
    bullet('Sidewalk, driveway, and yard areas adjacent to the Premises');
    bullet('Vivent smart home appliances (cameras, locks, sensors, panel) -- Tenant responsible for battery replacements');
    bullet('Keeping the Premises and shared common areas clean and sanitary at all times');
    bullet('Reporting any damage, water leaks, or mold within 24 hours of discovery (per §55.1-1234, VRLTA)');
    bullet('Property cleanliness fees (professional cleaning) shall be divided equally among all tenants');
    doc.moveDown(0.3);
    para('Tenant shall NOT make any structural alterations, improvements, or installations without prior written consent of Landlord.');

    // S10 ENTRY BY LANDLORD
    section(10, 'Entry by Landlord');
    para('Per §55.1-1229 of the VRLTA, Landlord shall provide at least 48 hours advance notice before entering the Premises for inspection, repairs, or showing to prospective tenants or purchasers. In the event of an emergency, Landlord may enter without prior notice.');

    // S11 SMOKING, PARKING & STORAGE
    section(11, 'Smoking, Parking & Storage');
    bullet('Smoking of any substance is strictly prohibited anywhere on the Premises or property.');
    bullet('No parking of vehicles is permitted on the property without prior written consent of Landlord.');
    bullet('No storage of personal property in common areas (hallways, living room, kitchen).');
    bullet('No hazardous materials shall be kept on or about the Premises.');

    // S12 PETS
    section(12, 'Pets');
    para('No animals of any kind shall be kept on the Premises without the prior written consent of Landlord. Unauthorized pets are grounds for termination of this Agreement.');

    // S13 EARLY TERMINATION
    section(13, 'Early Termination');
    row('Notice Required:', earlyTermDays + ' days written notice');
    if (data.earlyTermFee) row('Early Termination Fee:', '$' + fmt(data.earlyTermFee));
    para('Tenant may terminate this Agreement early by providing ' + earlyTermDays + ' days advance written notice to Landlord' +
      (data.earlyTermFee ? ' and paying an early termination fee of $' + fmt(data.earlyTermFee) : '') +
      '. Tenant remains liable for rent through the notice period or until a new tenant is placed, whichever occurs first.');

    // S14 MILITARY TERMINATION
    section(14, 'Military Termination Clause');
    para('If Tenant is a member of the United States Armed Forces and receives orders for a permanent change of station (PCS) or deployment of not less than 90 days, Tenant may terminate this Agreement upon 30 days written notice, per the Servicemembers Civil Relief Act (SCRA) and §55.1-1253 of the VRLTA. Official orders must accompany the notice.');

    // S15 SUBLETTING
    section(15, 'Subletting & Assignment');
    para('Tenant shall not sublet the Premises or any portion thereof, nor assign this Agreement, without the prior written consent of Landlord. Any unauthorized subletting or assignment shall be grounds for immediate termination.');

    // S16 ESTOPPEL CERTIFICATE
    section(16, 'Estoppel Certificate');
    para('Upon request of Landlord, Tenant shall execute and deliver, within three (3) days, a written estoppel certificate certifying: (a) that this Agreement is unmodified and in full force; (b) the amount of monthly rent and date through which rent has been paid; (c) the amount of any security deposit; and (d) whether Tenant has any claims against Landlord.');

    // S17 SALE OF PROPERTY
    section(17, 'Sale of Property');
    para('In the event Landlord sells the property, Tenant shall be provided 30 days written notice of termination, or this Agreement shall transfer to the new owner in accordance with Virginia law.');

    // S18 RENTERS INSURANCE
    section(18, "Renter's Insurance");
    if (data.requiresRentersInsurance) {
      row('Required:', 'Yes');
      if (data.rentersInsuranceMinLiability) row('Minimum Liability Coverage:', '$' + fmt(data.rentersInsuranceMinLiability));
      para("Tenant is required to obtain and maintain renter's insurance with a minimum liability coverage of $" + fmt(data.rentersInsuranceMinLiability || 100000) + " throughout the term of this Agreement. Tenant shall provide proof of insurance to Landlord within 14 days of executing this Agreement.");
    } else {
      para("Renter's insurance is not required under this Agreement but is strongly recommended. Landlord's insurance does not cover Tenant's personal property.");
    }

    // S19 VRLTA
    section(19, 'Virginia Residential Landlord and Tenant Act');
    para('This Agreement is governed by the VRLTA, Chapter 12, Title 55.1, Code of Virginia. In the event of any conflict between this Agreement and the VRLTA, the VRLTA shall control. See: https://law.lis.virginia.gov/vacode/title55.1/chapter12/');

    // S20 GENERAL PROVISIONS
    section(20, 'General Provisions');
    bullet('Governing Law: Commonwealth of Virginia. Venue: City of Norfolk, Virginia.');
    bullet('Entire Agreement: This Agreement supersedes all prior oral and written negotiations. Modifications must be in writing and signed by both parties.');
    bullet('Severability: If any provision is unenforceable, the remainder shall remain in full force.');
    bullet('Waiver: Failure to enforce any provision shall not constitute a waiver of future enforcement.');
    bullet('Notices: All notices shall be in writing, delivered in person, by certified mail, or by email.');
    if (data.notes) {
      doc.moveDown(0.4);
      para('Additional Notes: ' + data.notes);
    }

    // S21 MOVE-IN INSPECTION CHECKLIST
    checkPageBreak(200);
    section(21, 'Move-In Inspection Checklist');
    para('Tenant and Landlord shall complete this checklist at move-in. Condition: G = Good, F = Fair, P = Poor.');

    var areas = [
      { area: 'Kitchen',     items: ['Countertops', 'Cabinets', 'Sink/Faucet', 'Refrigerator', 'Stove/Oven', 'Dishwasher', 'Microwave'] },
      { area: 'Living Room', items: ['Walls/Ceiling', 'Floors', 'Windows', 'Doors', 'Light Fixtures', 'TV'] },
      { area: 'Hallways',    items: ['Walls', 'Floors', 'Lighting'] },
      { area: 'Tenant Room', items: ['Walls/Ceiling', 'Floors', 'Windows', 'Door/Lock', 'Closet', 'Bed', 'Other Furniture'] },
      { area: 'Bathroom',    items: ['Toilet', 'Sink/Faucet', 'Shower/Tub', 'Mirror', 'Ventilation'] },
    ];

    var checkColW = W / 4;
    areas.forEach(function(areaObj) {
      checkPageBreak(areaObj.items.length * 18 + 30);
      var aY = doc.y;
      doc.rect(L, aY, W, 16).fill('#f1f5f9');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK)
         .text(areaObj.area, L + 6, aY + 3, { width: checkColW * 2 })
         .text('Move-In', L + checkColW * 2, aY + 3, { width: checkColW, align: 'center' })
         .text('Move-Out', L + checkColW * 3, aY + 3, { width: checkColW - 6, align: 'center' });
      doc.y = aY + 18;
      areaObj.items.forEach(function(item, i) {
        var rY = doc.y;
        if (i % 2 === 0) doc.rect(L, rY, W, 15).fill('#f8fafc');
        doc.rect(L, rY, W, 15).stroke(LINE);
        doc.font('Helvetica').fontSize(8).fillColor(DARK)
           .text(item, L + 6, rY + 3, { width: checkColW * 2 - 12 });
        doc.rect(L + checkColW * 2 + checkColW / 2 - 20, rY + 2, 40, 11).stroke(LINE);
        doc.rect(L + checkColW * 3 + checkColW / 2 - 20, rY + 2, 40, 11).stroke(LINE);
        doc.y = rY + 15;
      });
      doc.moveDown(0.4);
    });

    doc.moveDown(0.5);
    para('Additional notes on move-in condition:');
    doc.rect(L, doc.y, W, 36).stroke(LINE);
    doc.y += 40;

    // SIGNATURE PAGE
    checkPageBreak(220);
    doc.moveDown(0.8);
    var sigBarY = doc.y;
    doc.rect(L, sigBarY, W, 3).fill(BLUE);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK)
       .text('SIGNATURES', L, sigBarY + 10, { align: 'center', width: W });
    doc.moveDown(2);
    para('By signing below, both parties agree to the terms and conditions of this Agreement.');
    doc.moveDown(0.8);

    var halfW = (W - 48) / 2;

    function sigBlock(label, name, date, xOffset) {
      var x = L + xOffset;
      var startY = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text(label, x, startY, { width: halfW });
      doc.y = startY + 18;
      doc.rect(x, doc.y, halfW, 0.5).fill('#aaaaaa');
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(name || ' ', x, doc.y + 2, { width: halfW });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Signature', x, doc.y + 12, { width: halfW });
      doc.y += 30;
      doc.rect(x, doc.y, halfW, 0.5).fill('#aaaaaa');
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(name || ' ', x, doc.y + 2, { width: halfW });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Printed Name', x, doc.y + 12, { width: halfW });
      doc.y += 30;
      doc.rect(x, doc.y, halfW, 0.5).fill('#aaaaaa');
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(date ? fmtDateShort(date) : ' ', x, doc.y + 2, { width: halfW });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Date', x, doc.y + 12, { width: halfW });
      doc.y += 30;
    }

    var preY = doc.y;
    sigBlock('LANDLORD / AUTHORIZED AGENT', data.landlordName, data.startDate, 0);
    doc.y = preY;
    sigBlock('TENANT', data.tenantName, data.startDate, halfW + 48);

    if (data.propertyManagerName) {
      doc.moveDown(1.5);
      var pmY = doc.y;
      sigBlock('PROPERTY MANAGER', data.propertyManagerName, data.startDate, 0);
      doc.y = pmY;
      if (data.coLandlordName) {
        sigBlock('CO-LANDLORD', data.coLandlordName, data.startDate, halfW + 48);
      }
    }

    // FOOTER on each page
    var totalPages = doc.bufferedPageRange().count;
    for (var pi = 0; pi < totalPages; pi++) {
      doc.switchToPage(pi);
      var fY = doc.page.height - 40;
      doc.rect(L, fY - 6, W, 0.5).fill(BLUE);
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
         .text(
           '743 A Ave, Norfolk VA 23504  ·  Lease ID: ' + data.leaseId + '  ·  Page ' + (pi + 1) + ' of ' + totalPages + '  ·  VRLTA Compliant',
           L, fY, { align: 'center', width: W }
         );
    }

    doc.end();
  });
}

module.exports = { generateLeasePdf };
