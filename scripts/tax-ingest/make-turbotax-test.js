#!/usr/bin/env node
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
const PDFDocument = (await import("pdfkit")).default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "test-turbotax.pdf");

await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const chunks = [];
  doc.on("data", c => chunks.push(c));
  doc.on("end", () => { fs.writeFileSync(out, Buffer.concat(chunks)); resolve(); });
  doc.on("error", reject);

  const row = (label, value) => {
    const y = doc.y;
    doc.font("Helvetica").fontSize(11).text(label, 50, y, { width: 340 });
    doc.font("Courier").text(value, 390, y, { width: 150, align: "right" });
    doc.moveDown(0.2);
  };

  doc.font("Helvetica-Bold").fontSize(13)
     .text("TurboTax — 2024 Federal Tax Return Summary", { align: "center" });
  doc.font("Helvetica").fontSize(10)
     .text("Form 1040 — U.S. Individual Income Tax Return", { align: "center" });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(11).text("Filing status: Married Filing Jointly");
  doc.moveDown();

  doc.font("Helvetica-Bold").fontSize(11).text("INCOME");
  row("Wages and salaries",                "$330,000");
  row("Ordinary dividends",                "$4,200");
  row("Long-term capital gains",           "$12,500");
  row("Short-term capital gains",          "$1,800");
  row("Total income",                      "$348,500");

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").text("ADJUSTMENTS");
  row("401(k) contributions",              "-$23,000");
  row("HSA deduction",                     "-$4,150");
  row("Adjusted Gross Income (AGI)",       "$321,350");

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").text("DEDUCTIONS");
  row("Itemized deductions",               "$44,800");
  row("  State and local taxes (SALT)",    "$10,000");
  row("  Home mortgage interest",          "$19,400");
  row("  Cash charitable contributions",   "$12,800");
  row("  Non-cash contributions",          "$2,600");
  row("Taxable income",                    "$276,550");

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").text("TAX COMPUTATION");
  row("Federal income tax",                "$62,450");
  row("Child Tax Credit (2 children)",     "-$4,000");
  row("Total payments (withheld)",         "-$68,000");
  row("Refund",                            "$9,550");

  doc.end();
});

console.log(`Created: ${out}`);
