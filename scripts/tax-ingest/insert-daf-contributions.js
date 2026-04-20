import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const rows = [
  {
    donation_date: "2026-03-18", tax_year: 2026,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "zakat",
    zakat_asset_type: "stock",
    amount: 15407.37,
    fair_market_value: 15407.37,
    notes: "GOOG (Alphabet Inc) stock contribution to DAF",
    is_tax_deductible: true, islamic_year: 1447,
  },
  {
    donation_date: "2026-03-17", tax_year: 2026,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "zakat",
    zakat_asset_type: "stock",
    amount: 307.20,
    fair_market_value: 307.20,
    notes: "GOOG (Alphabet Inc) stock contribution to DAF",
    is_tax_deductible: true, islamic_year: 1447,
  },
  {
    donation_date: "2025-09-04", tax_year: 2025,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "zakat",
    zakat_asset_type: "stock",
    amount: 10339.42,
    fair_market_value: 10339.42,
    notes: "GOOG (Alphabet Inc) stock contribution to DAF",
    is_tax_deductible: true, islamic_year: 1447,
  },
  {
    donation_date: "2025-08-12", tax_year: 2025,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "zakat",
    zakat_asset_type: "stock",
    amount: 9146.92,
    fair_market_value: 9146.92,
    notes: "GOOG (Alphabet Inc) stock contribution to DAF",
    is_tax_deductible: true, islamic_year: 1447,
  },
  {
    donation_date: "2025-06-10", tax_year: 2025,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "sadaqa",
    zakat_asset_type: "cash",
    amount: 2493.46,
    fair_market_value: 2493.46,
    notes: "Cash contribution to DAF",
    is_tax_deductible: true, islamic_year: 1446,
  },
  {
    donation_date: "2024-04-29", tax_year: 2024,
    charity_name: "DAF – Fidelity Charitable",
    donation_type: "daf_contribution",
    giving_category: "sadaqa",
    zakat_asset_type: "stock",
    amount: 25383.00,
    fair_market_value: 25383.00,
    notes: "GOOG (Alphabet Inc.) stock contribution to DAF",
    is_tax_deductible: true, islamic_year: 1445,
  },
];

const { data, error } = await db.from("finance_donations").insert(rows).select("id");
if (error) {
  console.error("Error:", error.message, error.details);
} else {
  console.log(`✅ Inserted ${data.length} DAF contributions\n`);

  const byYear = {};
  for (const r of rows) {
    byYear[r.tax_year] = (byYear[r.tax_year] || 0) + r.amount;
  }
  for (const [yr, total] of Object.entries(byYear).sort()) {
    console.log(`  ${yr}: $${total.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
  }
  const grand = rows.reduce((s, r) => s + r.amount, 0);
  console.log(`  ─────────────────`);
  console.log(`  Total: $${grand.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
}
