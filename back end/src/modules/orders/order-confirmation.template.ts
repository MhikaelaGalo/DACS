import type { Order, OrderItem } from "../../../generated/prisma/client";

type ReceiptOrder = Pick<Order,
  "orderNumber" | "createdAt" | "status" | "orderType" | "subtotal" | "feeTotal" | "totalAmount"
> & {
  items: Pick<OrderItem, "productNameSnapshot" | "quantity" | "unitPriceSnapshot" | "lineTotal">[];
};

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const orderDate = new Intl.DateTimeFormat("en-PH", {
  month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila",
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const peso = (amount: Order["totalAmount"]) => currency.format(amount.toNumber());
const brand = "Dominant Asia Poultry Genetics";

export function buildOrderConfirmation(order: ReceiptOrder, customerName: string) {
  const gcashName = process.env.ORDER_GCASH_NAME?.trim() || "DACS Poultry Payments";
  const gcashNumber = process.env.ORDER_GCASH_NUMBER?.trim() || "0000 000 0000";
  const bank = process.env.ORDER_BANK_NAME?.trim() || "BDO Unibank";
  const bankAccount = process.env.ORDER_BANK_ACCOUNT_NAME?.trim() || brand;
  const bankNumber = process.env.ORDER_BANK_ACCOUNT_NUMBER?.trim() || "0000 0000 0000";
  const inbox = process.env.ORDER_PAYMENT_PROOF_EMAIL?.trim() || "payments@dacs.example";
  const paymentSubject = `Payment Confirmation – ${order.orderNumber}`;
  const amountDue = peso(order.totalAmount);
  const seminar = order.orderType === "SEMINAR";

  const html: string[] = [];
  const text: string[] = [];
  function paragraph(value: string) {
    html.push(`<p>${escapeHtml(value)}</p>`);
    text.push(value);
  }
  function heading(value: string) {
    html.push(`<h2 style="font-size:17px;color:#971c20;margin:26px 0 10px">${escapeHtml(value)}</h2>`);
    text.push(value);
  }
  function details(entries: [string, string][]) {
    html.push("<p>" + entries.map(([label, value]) =>
      `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`
    ).join("<br>") + "</p>");
    text.push(entries.map(([label, value]) => `${label}: ${value}`).join("\n"));
  }

  html.push(`<div style="font:16px/1.5 Arial,sans-serif;color:#242424;max-width:640px;margin:auto;padding:18px">
    <strong style="color:#971c20">${brand.toUpperCase()}</strong><h1>Thank You for Your Order!</h1>`);
  text.push(brand.toUpperCase(), "Thank You for Your Order!");
  paragraph(`Dear ${customerName},`);
  paragraph(`Thank you for placing your order with ${brand}!`);
  paragraph("We have received your order. Below is a summary of your purchase and instructions on how to complete your payment.");

  heading("ORDER DETAILS");
  details([
    ["Order Number", order.orderNumber],
    ["Order Date", orderDate.format(order.createdAt)],
    ["Order Status", order.status === "PENDING" ? "Pending Payment" : order.status.replaceAll("_", " ")],
  ]);
  heading("YOUR ORDER SUMMARY");
  const columns = ["Product", "Quantity", "Unit Price", "Total"];
  const rows = order.items.map(item => [
    item.productNameSnapshot, String(item.quantity), peso(item.unitPriceSnapshot), peso(item.lineTotal),
  ]);
  const cellStyle = 'style="padding:8px 4px;border-bottom:1px solid #ddd"';
  html.push(`<table width="100%" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    <thead><tr>${columns.map((label, i) => `<th scope="col" align="${i ? "right" : "left"}" ${cellStyle}>${label}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => "<tr>" + row.map((value, i) =>
      `<td align="${i ? "right" : "left"}" ${cellStyle}>${escapeHtml(value)}</td>`
    ).join("") + "</tr>").join("")}</tbody></table>`);
  text.push([columns, ...rows].map(row => row.join(" | ")).join("\n"));
  details([["Subtotal", peso(order.subtotal)], ["Delivery Fee", peso(order.feeTotal)]]);
  html.push(`<p><strong>TOTAL AMOUNT DUE: ${amountDue}</strong></p><hr>`);
  text.push(`TOTAL AMOUNT DUE: ${amountDue}`);

  heading("PAYMENT INSTRUCTIONS");
  if (/^[0\s-]+$/.test(gcashNumber) || /^[0\s-]+$/.test(bankNumber) || /\.example$/i.test(inbox)) {
    paragraph("These are sample payment details. Please wait for confirmed payment instructions from DACS before sending money or a receipt.");
  } else {
    paragraph("Once our team confirms your quotation, please send your payment using one of the following methods.");
  }
  heading("Option 1: GCash");
  details([["Account Name", gcashName], ["GCash Number", gcashNumber]]);
  heading("Option 2: Bank Transfer");
  details([["Bank Name", bank], ["Account Name", bankAccount], ["Account Number", bankNumber]]);
  details([["Amount to Pay", amountDue]]);

  heading("PAYMENT CONFIRMATION");
  paragraph("After completing your payment, please send a screenshot or photo of your payment receipt to:");
  const mailto = `mailto:${encodeURIComponent(inbox).replace("%40", "@")}?subject=${encodeURIComponent(paymentSubject)}`;
  html.push(`<p><strong>Email:</strong> <a href="${escapeHtml(mailto)}">${escapeHtml(inbox)}</a></p>`);
  text.push(`Email: ${inbox}`);
  details([["Subject", paymentSubject]]);
  paragraph("Please include your order number so our team can verify your payment.");
  heading("WHAT HAPPENS NEXT?");
  paragraph("Once your payment has been verified, we will update your order status and proceed with processing your purchase.");
  paragraph(seminar
    ? "You can then access your purchased modules on the Seminars page."
    : "You will be notified when your order is ready for delivery or collection.");
  paragraph(`Thank you for choosing ${brand}!`);
  const tagline = "Quality Poultry Genetics, Trusted Service.";
  const footer = "This is an automated order confirmation email. Your order is not yet marked as paid.";
  html.push(`<p><strong>${brand}</strong><br><em>${tagline}</em></p><p><small><em>${footer}</em></small></p></div>`);
  text.push(brand, tagline, footer);

  return { subject: `Order Confirmation – ${order.orderNumber}`, html: html.join("\n"), text: text.join("\n\n") };
}
