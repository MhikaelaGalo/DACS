/**
 * Seed the two client-approved order forms (Parent Stock + F1) into the
 * forms table — the content the admin mock previously shipped in
 * MOCK_FORMS. Goes through the real API as the Owner so validation and
 * activity logging apply. Skips itself when any active form already
 * exists (idempotent).
 *
 * Run with the backend up: npx tsx scripts/seed-demo-forms.ts
 */
import "dotenv/config";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const CREDENTIALS_FILE =
  "C:/Users/Ella Ignacio/DACS-secrets/admin-staff-credentials.txt";
const PROJECT_ID = "dacs-8f430";
const OWNER_EMAIL = "erwinjoseph.cruz@dominantasia.com";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DEMO_FORMS = [
  {
    name: "Parent Stocks (PS) Order Form",
    description:
      "Order form for Dominant Cz Parent Stock breed lines — sets, female/male quantities, and delivery scheduling.",
    fields: [
      { type: "title", label: "READ BEFORE ORDERING" },
      {
        type: "paragraph",
        label:
          "Parent Stock is released only to farmers who completed Seminar Modules 1-3. Released at 1-3 days old, vaccinated against HVT, ND, IBD at day 1.",
      },
      { type: "checkbox", label: "D109 + 102" },
      { type: "number", label: "Sets" },
      {
        type: "dropdown",
        label: "When do you need your PS chicks?",
        options: MONTHS,
      },
      { type: "button", label: "Submit Registration" },
    ],
  },
  {
    name: "First Filial Generation (F1) Order Form",
    description:
      "Order form for F1 Layer, Inasal Meat, and Artisan Egger lines with per-head pricing tiers.",
    fields: [
      { type: "title", label: "READ BEFORE ORDERING" },
      { type: "title", label: "For F1 Layer Type:" },
      {
        type: "paragraph",
        label:
          "For table egg production, pre-selected females. Start of egg production at approximately 4.5 months, 290-300 eggs per cycle. P140/head (100 heads or more), P160/head (50-99 heads).",
      },
      { type: "checkbox", label: "Layer Type" },
      { type: "conditional", label: "Amount" },
      { type: "title", label: "For F1 Inasal Meat Type:" },
      {
        type: "paragraph",
        label:
          "For chicken meat production, pre-selected males. 1.4-1.6 kg live weight at 70 days. P65/head (100 heads or more), P75/head (50-99 heads).",
      },
      { type: "checkbox", label: "Inasal Type" },
      { type: "conditional", label: "Amount" },
      { type: "title", label: 'F1 Artisan Eggers "Rainbow Eggs":' },
      {
        type: "paragraph",
        label:
          "For specialty egg production — dark brown, green, olive green & specialty egg colors. P220/head, minimum order 65 heads. First come, first served.",
      },
      { type: "checkbox", label: "Artisan Line" },
      { type: "conditional", label: "Amount" },
      {
        type: "dropdown",
        label: "When do you need your F1 chicks?",
        options: [...MONTHS, "Other"],
      },
      { type: "short-answer", label: "Other / Multiple Order Schedule" },
      { type: "button", label: "Submit Registration" },
    ],
  },
];

function loadPassword(email: string): string {
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (match && match[1].toLowerCase() === email.toLowerCase()) return match[2];
  }
  throw new Error(`No password for ${email}`);
}

async function getWebApiKey(): Promise<string> {
  if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
  const credential = applicationDefault();
  const accessToken = await credential.getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken.access_token}` };
  const apps = (await (
    await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps`,
      { headers }
    )
  ).json()) as { apps?: Array<{ name: string }> };
  const first = apps.apps?.[0];
  if (!first) throw new Error("No Firebase web app registered.");
  const config = (await (
    await fetch(`https://firebase.googleapis.com/v1beta1/${first.name}/config`, {
      headers,
    })
  ).json()) as { apiKey?: string };
  if (!config.apiKey) throw new Error("No apiKey in web app config.");
  return config.apiKey;
}

async function main() {
  const apiKey = await getWebApiKey();
  const signIn = (await (
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: loadPassword(OWNER_EMAIL),
          returnSecureToken: true,
        }),
      }
    )
  ).json()) as { idToken?: string };
  if (!signIn.idToken) throw new Error("Owner sign-in failed.");
  const headers = {
    Authorization: `Bearer ${signIn.idToken}`,
    "Content-Type": "application/json",
  };

  const list = (await (
    await fetch(`${BASE_URL}/api/forms`, { headers })
  ).json()) as { data?: Array<{ id: string }> };
  if ((list.data ?? []).length > 0) {
    console.log(`Skipped — ${list.data!.length} active form(s) already exist.`);
    return;
  }

  for (const form of DEMO_FORMS) {
    const created = (await (
      await fetch(`${BASE_URL}/api/forms`, {
        method: "POST",
        headers,
        body: JSON.stringify(form),
      })
    ).json()) as { success?: boolean; data?: { id: string }; message?: string };
    if (!created.success || !created.data) {
      throw new Error(`Create failed for "${form.name}": ${created.message}`);
    }
    const published = (await (
      await fetch(`${BASE_URL}/api/forms/${created.data.id}/publish`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isPublished: true }),
      })
    ).json()) as { success?: boolean; message?: string };
    console.log(
      `Seeded "${form.name}" (${form.fields.length} fields) — published: ${published.success}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
