#!/usr/bin/env node
// Creates a realistic test PDF with SSN, EIN, PTIN embedded — used to verify redact-pdf.js
import { fileURLToPath } from "url";
import path from "path";
const PDFDocument = (await import("pdfkit")).default;
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "test-input.pdf");

await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const chunks = [];
  doc.on("data", c => chunks.push(c));
  doc.on("end", () => {
    fs.writeFileSync(outPath, Buffer.concat(chunks));
    console.log(`Created: ${outPath}`);
    resolve();
  });
  doc.on("error", reject);

  doc.font("Helvetica-Bold").fontSize(14).text("2025 W-2 Wage and Tax Statement", { align: "center" });
  doc.moveDown();
  doc.font("Helvetica").fontSize(11);
  doc.text("a  Employee's social security number");
  doc.font("Courier").text("   123-45-6789");
  doc.moveDown(0.5);
  doc.font("Helvetica").text("b  Employer identification number (EIN)");
  doc.font("Courier").text("   61-1234567");
  doc.moveDown(0.5);
  doc.font("Helvetica").text("c  Employer's name, address, and ZIP code");
  doc.font("Courier").text("   Google LLC\n   1600 Amphitheatre Pkwy\n   Mountain View, CA 94043");
  doc.moveDown(0.5);
  doc.font("Helvetica").text("1  Wages, tips, other compensation    2  Federal income tax withheld");
  doc.font("Courier").text("   285,000.00                              62,450.00");
  doc.moveDown(0.5);
  doc.font("Helvetica").text("12a  Code D (401k)");
  doc.font("Courier").text("   23,500.00");
  doc.moveDown();
  doc.font("Helvetica").text("Paid preparer use only");
  doc.font("Courier").text("   PTIN: P98765432");
  doc.moveDown();
  doc.font("Helvetica").text("Also, spouse SSN on file: 987-65-4321");
  doc.moveDown();
  doc.font("Helvetica").text("ITIN on record: 912-70-1234");
  doc.end();
});
