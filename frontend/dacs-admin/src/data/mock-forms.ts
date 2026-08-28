import type { FormDefinition } from "@/types/admin";

/*
 * The two order forms from the mockups. Submissions of these forms
 * become orders in the backend (client-confirmed) — the builder edits
 * the content customers see.
 */
export const MOCK_FORMS: FormDefinition[] = [
  {
    id: "form-ps",
    name: "Parent Stocks (PS) Order Form",
    description:
      "Order form for Dominant Cz Parent Stock breed lines — sets, female/male quantities, and delivery scheduling.",
    isPublished: true,
    blocks: [
      { id: "ps-1", type: "title", label: "READ BEFORE ORDERING" },
      {
        id: "ps-2",
        type: "paragraph",
        label:
          "Parent Stock is released only to farmers who completed Seminar Modules 1-3. Released at 1-3 days old, vaccinated against HVT, ND, IBD at day 1.",
      },
      { id: "ps-3", type: "checkbox", label: "D109 + 102" },
      { id: "ps-4", type: "number", label: "Sets" },
      {
        id: "ps-5",
        type: "dropdown",
        label: "When do you need your PS chicks?",
        options: [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December",
        ],
      },
      { id: "ps-6", type: "button", label: "Submit Registration" },
    ],
  },
  {
    id: "form-f1",
    name: "First Filial Generation (F1) Order Form",
    description:
      "Order form for F1 Layer, Inasal Meat, and Artisan Egger lines with per-head pricing tiers.",
    isPublished: true,
    blocks: [
      { id: "f1-1", type: "title", label: "READ BEFORE ORDERING" },
      { id: "f1-2", type: "title", label: "For F1 Layer Type:" },
      {
        id: "f1-3",
        type: "paragraph",
        label:
          "For table egg production, pre-selected females. Start of egg production at approximately 4.5 months, 290-300 eggs per cycle. P140/head (100 heads or more), P160/head (50-99 heads).",
      },
      { id: "f1-4", type: "checkbox", label: "Layer Type" },
      { id: "f1-5", type: "conditional", label: "Amount" },
      { id: "f1-6", type: "title", label: "For F1 Inasal Meat Type:" },
      {
        id: "f1-7",
        type: "paragraph",
        label:
          "For chicken meat production, pre-selected males. 1.4-1.6 kg live weight at 70 days. P65/head (100 heads or more), P75/head (50-99 heads).",
      },
      { id: "f1-8", type: "checkbox", label: "Inasal Type" },
      { id: "f1-9", type: "conditional", label: "Amount" },
      { id: "f1-10", type: "title", label: 'F1 Artisan Eggers "Rainbow Eggs":' },
      {
        id: "f1-11",
        type: "paragraph",
        label:
          "For specialty egg production — dark brown, green, olive green & specialty egg colors. P220/head, minimum order 65 heads. First come, first served.",
      },
      { id: "f1-12", type: "checkbox", label: "Artisan Line" },
      { id: "f1-13", type: "conditional", label: "Amount" },
      {
        id: "f1-14",
        type: "dropdown",
        label: "When do you need your F1 chicks?",
        options: [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December", "Other",
        ],
      },
      { id: "f1-15", type: "short-answer", label: "Other / Multiple Order Schedule" },
      { id: "f1-16", type: "button", label: "Submit Registration" },
    ],
  },
];
