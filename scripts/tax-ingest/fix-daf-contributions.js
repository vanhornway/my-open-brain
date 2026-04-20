import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://epckjiufeimydxmcrfus.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwY2tqaXVmZWlteWR4bWNyZnVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc4MTA3NCwiZXhwIjoyMDg5MzU3MDc0fQ.5KG6i-1Y9Z1bn0pSoGz2aanEIyQwRsLzyHc9tqffl5A";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

// Clear giving_category on all daf_contribution rows — DAF is a vehicle, not a giving type
const { data, error } = await db
  .from("finance_donations")
  .update({ giving_category: null })
  .eq("donation_type", "daf_contribution")
  .select("id, donation_date, charity_name, amount");

if (error) {
  console.error("Error:", error.message);
} else {
  console.log(`✅ Cleared giving_category on ${data.length} DAF contribution records:`);
  for (const r of data) {
    console.log(`   ${r.donation_date}  ${r.charity_name}  $${r.amount}`);
  }
}
