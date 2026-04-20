import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const rows = [
  // 2026
  { donation_date: "2026-03-20", tax_year: 2026, charity_name: "Rahima International Foundation",             amount: 500,  islamic_year: 1447 },
  { donation_date: "2026-03-20", tax_year: 2026, charity_name: "Akhuwat USA",                                 amount: 400,  islamic_year: 1447 },
  { donation_date: "2026-03-20", tax_year: 2026, charity_name: "Council on American-Islamic Relations",       amount: 1000, islamic_year: 1447 },
  { donation_date: "2026-03-20", tax_year: 2026, charity_name: "Qalam Seminary Inc",                         amount: 2500, islamic_year: 1447 },
  { donation_date: "2026-03-20", tax_year: 2026, charity_name: "Zakat Foundation of America",                amount: 5000, islamic_year: 1447 },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Akhuwat USA",                                 amount: 600,  islamic_year: 1447 },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Evergreen Islamic Center",                   amount: 2500, islamic_year: 1447 },
  { donation_date: "2026-03-17", tax_year: 2026, charity_name: "Children of Heaven Inc",                     amount: 500,  islamic_year: 1447 },
  { donation_date: "2026-03-16", tax_year: 2026, charity_name: "Evergreen Islamic Center",                   amount: 7500, islamic_year: 1447, notes: "Status: Approved" },
  { donation_date: "2026-03-15", tax_year: 2026, charity_name: "Khalil Foundation",                          amount: 2500, islamic_year: 1447 },
  { donation_date: "2026-03-13", tax_year: 2026, charity_name: "Palestine Children's Relief Fund",           amount: 500,  islamic_year: 1447 },
  { donation_date: "2026-03-10", tax_year: 2026, charity_name: "Qalam Seminary Inc",                         amount: 2500, islamic_year: 1447 },
  { donation_date: "2026-02-09", tax_year: 2026, charity_name: "iCodeGuru",                                   amount: 2000, islamic_year: 1447 },
  // 2025
  { donation_date: "2025-12-25", tax_year: 2025, charity_name: "Islamic Schools League of America",          amount: 5000, islamic_year: 1447 },
  { donation_date: "2025-12-08", tax_year: 2025, charity_name: "Evergreen Islamic Center",                   amount: 5000, islamic_year: 1447 },
  { donation_date: "2025-11-15", tax_year: 2025, charity_name: "Unity Productions Foundation",               amount: 500,  islamic_year: 1447 },
  { donation_date: "2025-11-08", tax_year: 2025, charity_name: "FFEC USA",                                    amount: 500,  islamic_year: 1447 },
  { donation_date: "2025-10-05", tax_year: 2025, charity_name: "Human Development Fund",                     amount: 1000, islamic_year: 1447 },
  { donation_date: "2025-10-05", tax_year: 2025, charity_name: "Muslim Community Association of SF Bay Area", amount: 1000, islamic_year: 1447 },
  { donation_date: "2025-09-04", tax_year: 2025, charity_name: "Heroic Hearts Organization NFP",             amount: 2000, islamic_year: 1447 },
  { donation_date: "2025-04-03", tax_year: 2025, charity_name: "MATW Project USA",                           amount: 1000, islamic_year: 1446 },
  { donation_date: "2025-03-27", tax_year: 2025, charity_name: "Akhuwat USA",                                 amount: 1000, islamic_year: 1446 },
  { donation_date: "2025-03-23", tax_year: 2025, charity_name: "Council on American-Islamic Relations",       amount: 5000, islamic_year: 1446 },
  { donation_date: "2025-03-09", tax_year: 2025, charity_name: "Evergreen Islamic Center",                   amount: 6000, islamic_year: 1446 },
  { donation_date: "2025-02-04", tax_year: 2025, charity_name: "Nueces Mosque",                               amount: 500,  islamic_year: 1446 },
  { donation_date: "2025-01-31", tax_year: 2025, charity_name: "IQA Foundation",                             amount: 500,  islamic_year: 1446 },
  // 2024
  { donation_date: "2024-12-31", tax_year: 2024, charity_name: "Rahima International Foundation",           amount: 2000, islamic_year: 1446 },
  { donation_date: "2024-12-31", tax_year: 2024, charity_name: "Islamic Relief USA",                        amount: 5000, islamic_year: 1446 },
  { donation_date: "2024-11-21", tax_year: 2024, charity_name: "iCodeGuru",                                  amount: 1000, islamic_year: 1446 },
  { donation_date: "2024-10-22", tax_year: 2024, charity_name: "Evergreen Islamic Center",                  amount: 1000, islamic_year: 1445 },
  { donation_date: "2024-09-25", tax_year: 2024, charity_name: "Evergreen Islamic Center",                  amount: 100,  islamic_year: 1445 },
];

// Apply common fields
const data_rows = rows.map(r => ({
  ...r,
  donation_type: "daf_grant",
  giving_category: "zakat",
  is_tax_deductible: false,  // grants from DAF are NOT separately deductible (deduction taken at contribution)
  daf_account: "Fidelity Charitable",
}));

const { data, error } = await db.from("finance_donations").insert(data_rows).select("id");
if (error) {
  console.error("Error:", error.message, error.details);
  process.exit(1);
}

console.log(`✅ Inserted ${data.length} DAF grants\n`);

const byYear = {};
for (const r of data_rows) {
  byYear[r.tax_year] = (byYear[r.tax_year] || 0) + r.amount;
}
for (const [yr, total] of Object.entries(byYear).sort()) {
  const count = data_rows.filter(r => r.tax_year === Number(yr)).length;
  console.log(`  ${yr}: ${count} grants = $${total.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
}
const grand = data_rows.reduce((s, r) => s + r.amount, 0);
console.log(`  ──────────────────────────`);
console.log(`  Total granted: $${grand.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
