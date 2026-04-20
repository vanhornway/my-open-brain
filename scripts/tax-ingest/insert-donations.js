import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const donations = [
  { donation_date: "2025-12-25", tax_year: 2025, charity_name: "Islamic Schools League of America", amount: 5000, giving_category: "zakat" },
  { donation_date: "2025-03-23", tax_year: 2025, charity_name: "Council on American-Islamic Relations", amount: 5000, giving_category: "zakat" },
  { donation_date: "2026-02-09", tax_year: 2026, charity_name: "iCodeGuru", amount: 2000, giving_category: "zakat" },
  { donation_date: "2025-09-04", tax_year: 2025, charity_name: "Heroic Hearts", amount: 2000, giving_category: "zakat" },
  { donation_date: "2026-02-20", tax_year: 2026, charity_name: "Zakat Foundation", amount: 100, giving_category: "zakat" },
  { donation_date: "2026-03-10", tax_year: 2026, charity_name: "Qalam", amount: 2500, giving_category: "zakat" },
  { donation_date: "2026-02-20", tax_year: 2026, charity_name: "Ehsas Foundation / Feeling Blessed", amount: 103, giving_category: "zakat" },
  { donation_date: "2026-02-20", tax_year: 2026, charity_name: "Sadaqaat-USA / Feeling Blessed", amount: 102, giving_category: "zakat" },
  { donation_date: "2026-01-16", tax_year: 2026, charity_name: "Africa Relief / Feeling Blessed", amount: 102, giving_category: "zakat" },
  { donation_date: "2025-09-10", tax_year: 2025, charity_name: "Edhi / Feeling Blessed", amount: 52, giving_category: "zakat" },
  { donation_date: "2025-09-04", tax_year: 2025, charity_name: "Edhi / Feeling Blessed", amount: 103, giving_category: "zakat" },
  { donation_date: "2025-12-31", tax_year: 2025, charity_name: "SBIA / Feeling Blessed", amount: 38.5, giving_category: "zakat", notes: "Various dates throughout year; date is approximate year-end" },
  { donation_date: "2025-09-05", tax_year: 2025, charity_name: "Zakat Foundation", amount: 100, giving_category: "zakat" },
  { donation_date: "2025-11-15", tax_year: 2025, charity_name: "Unity Productions Foundation", amount: 500, giving_category: "zakat" },
  { donation_date: "2025-12-31", tax_year: 2025, charity_name: "Various", amount: 4155, giving_category: "zakat", notes: "Multiple small donations across 2025; date is approximate year-end" },
  { donation_date: "2026-03-17", tax_year: 2026, charity_name: "Children of Heaven", amount: 500, giving_category: "zakat" },
  { donation_date: "2026-03-16", tax_year: 2026, charity_name: "Evergreen Islamic Center", amount: 7500, giving_category: "zakat" },
  { donation_date: "2026-03-15", tax_year: 2026, charity_name: "Khalil Foundation", amount: 2500, giving_category: "zakat" },
  { donation_date: "2026-03-13", tax_year: 2026, charity_name: "Palestine Children's Relief Fund", amount: 500, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Evergreen Islamic Center (EIC)", amount: 2500, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Akhuwat", amount: 600, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Zakat Foundation", amount: 5000, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Qalam", amount: 2500, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Council on American-Islamic Relations", amount: 1000, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Akhuwat", amount: 400, giving_category: "zakat" },
  { donation_date: "2026-03-19", tax_year: 2026, charity_name: "Rahima Foundation", amount: 500, giving_category: "zakat" },
];

// Add common fields
const rows = donations.map(d => ({
  ...d,
  donation_type: "cash",
  is_tax_deductible: true,
  islamic_year: d.tax_year === 2025 ? 1447 : 1447, // 1447 spans 2025-2026
}));

const { data, error } = await db.from("finance_donations").insert(rows).select("id");
if (error) {
  console.error("Error:", error.message);
  console.error(error.details);
} else {
  console.log(`✅ Inserted ${data.length} donations`);
  
  // Print summary by year
  const by2025 = rows.filter(r => r.tax_year === 2025);
  const by2026 = rows.filter(r => r.tax_year === 2026);
  const total2025 = by2025.reduce((s, r) => s + r.amount, 0);
  const total2026 = by2026.reduce((s, r) => s + r.amount, 0);
  console.log(`\n2025: ${by2025.length} donations = $${total2025.toLocaleString()}`);
  console.log(`2026: ${by2026.length} donations = $${total2026.toLocaleString()}`);
  console.log(`Total: $${(total2025 + total2026).toLocaleString()}`);
}
