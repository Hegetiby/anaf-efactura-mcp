#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = join(__dirname, "..", ".env");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { connectTransport } from "../shared/transport.js";

const ENV = process.env.ANAF_ENV === "production" ? "prod" : "test";
const BASE = ENV === "prod"
  ? "https://api.anaf.ro/prod/FCTEL/rest"
  : "https://api.anaf.ro/test/FCTEL/rest";
const OAUTH_BASE = "https://logincert.anaf.ro/anaf-oauth2/v1";
const CONFIG_DIR = process.env.ANAF_CONFIG_DIR || join(process.env.HOME || "/tmp", ".anaf-efactura-mcp");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

function loadToken() {
  try { if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")); } catch {}
  return null;
}
function saveToken(tokenData) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}
async function getAccessToken() {
  let tok = loadToken();
  if (!tok) throw new Error("Nu exista token ANAF. Foloseste anaf_auth_start + anaf_auth_callback.");
  if (tok.expires_at && Date.now() > tok.expires_at - 60000) tok = await refreshToken(tok.refresh_token);
  return tok.access_token;
}
async function refreshToken(refresh_token) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: process.env.ANAF_CLIENT_ID || "", client_secret: process.env.ANAF_CLIENT_SECRET || "" });
  const res = await fetch(`${OAUTH_BASE}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const tokenData = { access_token: data.access_token, refresh_token: data.refresh_token || refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  saveToken(tokenData);
  return tokenData;
}
async function anafRequest(path, options = {}) {
  const token = await getAccessToken();
  return fetch(`${BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
}
function escXml(str) { return str ? String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : ""; }

function buildInvoiceXML(inv) {
  const lines = (inv.lines || []).map((l, i) => `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${l.unit || 'C62'}">${l.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${inv.currency || 'RON'}">${(l.quantity * l.unit_price).toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item><cbc:Name>${escXml(l.description)}</cbc:Name></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${inv.currency || 'RON'}">${l.unit_price.toFixed(2)}</cbc:PriceAmount></cac:Price>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${inv.currency || 'RON'}">${((l.quantity * l.unit_price) * (l.vat_percent || 19) / 100).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${inv.currency || 'RON'}">${(l.quantity * l.unit_price).toFixed(2)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${inv.currency || 'RON'}">${((l.quantity * l.unit_price) * (l.vat_percent || 19) / 100).toFixed(2)}</cbc:TaxAmount>
          <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${l.vat_percent || 19}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
    </cac:InvoiceLine>`).join("");

  const taxableTotal = (inv.lines || []).reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const taxTotal = (inv.lines || []).reduce((s, l) => s + (l.quantity * l.unit_price) * (l.vat_percent || 19) / 100, 0);
  const payableTotal = taxableTotal + taxTotal;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${escXml(inv.invoice_number)}</cbc:ID>
  <cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>
  ${inv.due_date ? `<cbc:DueDate>${inv.due_date}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${inv.type_code || "380"}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${inv.currency || "RON"}</cbc:DocumentCurrencyCode>
  ${inv.note ? `<cbc:Note>${escXml(inv.note)}</cbc:Note>` : ""}
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>${escXml(inv.supplier.name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>${escXml(inv.supplier.street || "")}</cbc:StreetName>
      <cbc:CityName>${escXml(inv.supplier.city || "")}</cbc:CityName>
      <cbc:CountrySubentity>${escXml(inv.supplier.county || "")}</cbc:CountrySubentity>
      <cac:Country><cbc:IdentificationCode>${inv.supplier.country || "RO"}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${escXml(inv.supplier.vat_id || inv.supplier.cif)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${escXml(inv.supplier.name)}</cbc:RegistrationName><cbc:CompanyID>${escXml(inv.supplier.reg_com || "")}</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>${escXml(inv.customer.name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>${escXml(inv.customer.street || "")}</cbc:StreetName>
      <cbc:CityName>${escXml(inv.customer.city || "")}</cbc:CityName>
      <cbc:CountrySubentity>${escXml(inv.customer.county || "")}</cbc:CountrySubentity>
      <cac:Country><cbc:IdentificationCode>${inv.customer.country || "RO"}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${escXml(inv.customer.vat_id || inv.customer.cif)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${escXml(inv.customer.name)}</cbc:RegistrationName><cbc:CompanyID>${escXml(inv.customer.reg_com || "")}</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  ${inv.payment_means ? `<cac:PaymentMeans><cbc:PaymentMeansCode>${inv.payment_means.code || "30"}</cbc:PaymentMeansCode>${inv.payment_means.iban ? `<cac:PayeeFinancialAccount><cbc:ID>${escXml(inv.payment_means.iban)}</cbc:ID></cac:PayeeFinancialAccount>` : ""}</cac:PaymentMeans>` : ""}
  <cac:TaxTotal><cbc:TaxAmount currencyID="${inv.currency || 'RON'}">${taxTotal.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${inv.currency || 'RON'}">${taxableTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${inv.currency || 'RON'}">${taxableTotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${inv.currency || 'RON'}">${payableTotal.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${inv.currency || 'RON'}">${payableTotal.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

const server = new McpServer({ name: "anaf-efactura", version: "1.0.0" });

server.tool("anaf_auth_start", "Genereaza URL OAuth2 ANAF.", {
  client_id: z.string(), redirect_uri: z.string().default("urn:ietf:wg:oauth:2.0:oob"),
}, async ({ client_id, redirect_uri }) => {
  const url = `${OAUTH_BASE}/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&token_content_type=jwt`;
  return { content: [{ type: "text", text: `Deschide in browser:\n\n${url}\n\nApoi foloseste anaf_auth_callback cu codul primit.` }] };
});

server.tool("anaf_auth_callback", "Schimba codul pe token.", {
  code: z.string(), client_id: z.string(), client_secret: z.string(), redirect_uri: z.string().default("urn:ietf:wg:oauth:2.0:oob"),
}, async ({ code, client_id, client_secret, redirect_uri }) => {
  process.env.ANAF_CLIENT_ID = client_id; process.env.ANAF_CLIENT_SECRET = client_secret;
  const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id, client_secret, redirect_uri });
  const res = await fetch(`${OAUTH_BASE}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) return { content: [{ type: "text", text: `Eroare: ${res.status} ${await res.text()}` }], isError: true };
  const data = await res.json();
  saveToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000, client_id, client_secret });
  return { content: [{ type: "text", text: "Autentificare ANAF reusita. Token salvat." }] };
});

server.tool("anaf_upload_invoice", "Incarca XML UBL in e-Factura.", {
  cif: z.string(), xml: z.string(), standard: z.enum(["UBL", "CII"]).default("UBL"), extern: z.boolean().default(false),
}, async ({ cif, xml, standard, extern }) => {
  const params = new URLSearchParams({ standard, cif }); if (extern) params.set("extern", "DA");
  const res = await anafRequest(`/upload?${params}`, { method: "POST", headers: { "Content-Type": "application/xml" }, body: xml });
  const text = await res.text();
  if (!res.ok) return { content: [{ type: "text", text: `Eroare upload: ${res.status} ${text}` }], isError: true };
  return { content: [{ type: "text", text: `Upload reusit.\n${text}` }] };
});

server.tool("anaf_create_and_upload_invoice", "Creeaza UBL din date structurate si incarca in ANAF.", {
  invoice_number: z.string(), issue_date: z.string(), due_date: z.string().optional(), currency: z.string().default("RON"),
  type_code: z.string().default("380"), note: z.string().optional(),
  supplier: z.object({ name: z.string(), cif: z.string(), vat_id: z.string().optional(), reg_com: z.string().optional(), street: z.string().optional(), city: z.string().optional(), county: z.string().optional(), country: z.string().default("RO") }),
  customer: z.object({ name: z.string(), cif: z.string(), vat_id: z.string().optional(), reg_com: z.string().optional(), street: z.string().optional(), city: z.string().optional(), county: z.string().optional(), country: z.string().default("RO") }),
  payment_means: z.object({ code: z.string().default("30"), iban: z.string().optional() }).optional(),
  lines: z.array(z.object({ description: z.string(), quantity: z.number(), unit_price: z.number(), unit: z.string().default("C62"), vat_percent: z.number().default(19), classificationCode: z.string().optional() })),
  extern: z.boolean().default(false),
}, async (inv) => {
  const xml = buildInvoiceXML(inv); const cif = inv.supplier.cif.replace(/^RO/i, "");
  const params = new URLSearchParams({ standard: "UBL", cif }); if (inv.extern) params.set("extern", "DA");
  const res = await anafRequest(`/upload?${params}`, { method: "POST", headers: { "Content-Type": "application/xml" }, body: xml });
  const responseText = await res.text();
  if (!res.ok) return { content: [{ type: "text", text: `Eroare: ${res.status}\n${responseText}\n\nXML:\n${xml}` }], isError: true };
  return { content: [{ type: "text", text: `Factura incarcata.\n${responseText}\n\nXML:\n${xml}` }] };
});

server.tool("anaf_upload_status", "Verifica starea unei incarcari.", { upload_id: z.string() }, async ({ upload_id }) => {
  const res = await anafRequest(`/stareMesaj?id_incarcare=${upload_id}`);
  return { content: [{ type: "text", text: await res.text() }] };
});

server.tool("anaf_download", "Descarca ZIP din SPV.", { id: z.string() }, async ({ id }) => {
  const res = await anafRequest(`/descarcare?id=${id}`);
  if (!res.ok) return { content: [{ type: "text", text: `Eroare: ${res.status} ${await res.text()}` }], isError: true };
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = join(CONFIG_DIR, `download_${id}.zip`);
  mkdirSync(CONFIG_DIR, { recursive: true }); writeFileSync(outPath, buf);
  return { content: [{ type: "text", text: `ZIP: ${outPath} (${buf.length} bytes)` }] };
});

server.tool("anaf_list_messages", "Lista mesaje SPV.", {
  cif: z.string(), days: z.number().default(60), filter: z.enum(["E", "P", "T"]).optional(),
}, async ({ cif, days, filter }) => {
  let path = `/listaMesajeFactura?zile=${days}&cif=${cif}`; if (filter) path += `&filtru=${filter}`;
  const res = await anafRequest(path);
  return { content: [{ type: "text", text: await res.text() }] };
});

server.tool("anaf_validate_xml", "Valideaza XML offline.", { xml: z.string() }, async ({ xml }) => {
  const errors = [];
  for (const tag of ["cbc:ID","cbc:IssueDate","cbc:InvoiceTypeCode","cbc:DocumentCurrencyCode","cac:AccountingSupplierParty","cac:AccountingCustomerParty","cac:TaxTotal","cac:LegalMonetaryTotal","cac:InvoiceLine"]) {
    if (!xml.includes(`<${tag}`)) errors.push(`Lipsa: ${tag}`);
  }
  if (!xml.includes("CIUS-RO")) errors.push("Lipsa CIUS-RO in CustomizationID");
  if (!errors.length) return { content: [{ type: "text", text: "Validare OK. Validarea completa se face la upload." }] };
  return { content: [{ type: "text", text: `Erori:\n${errors.join("\n")}` }], isError: true };
});

server.tool("anaf_generate_xml", "Genereaza XML fara upload.", {
  invoice_number: z.string(), issue_date: z.string(), due_date: z.string().optional(), currency: z.string().default("RON"),
  type_code: z.string().default("380"), note: z.string().optional(),
  supplier: z.object({ name: z.string(), cif: z.string(), vat_id: z.string().optional(), reg_com: z.string().optional(), street: z.string().optional(), city: z.string().optional(), county: z.string().optional(), country: z.string().default("RO") }),
  customer: z.object({ name: z.string(), cif: z.string(), vat_id: z.string().optional(), reg_com: z.string().optional(), street: z.string().optional(), city: z.string().optional(), county: z.string().optional(), country: z.string().default("RO") }),
  payment_means: z.object({ code: z.string().default("30"), iban: z.string().optional() }).optional(),
  lines: z.array(z.object({ description: z.string(), quantity: z.number(), unit_price: z.number(), unit: z.string().default("C62"), vat_percent: z.number().default(19), classificationCode: z.string().optional() })),
}, async (inv) => ({ content: [{ type: "text", text: buildInvoiceXML(inv) }] }));

server.tool("anaf_company_lookup", "Info firma dupa CIF (public, fara auth).", { cif: z.string() }, async ({ cif }) => {
  const cifClean = cif.replace(/^RO/i, "").trim();
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch("https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ cui: parseInt(cifClean), data: today }]) });
  if (!res.ok) return { content: [{ type: "text", text: `Eroare: ${res.status}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
});

server.resource("config", "anaf://config", async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ environment: ENV, base_url: BASE, config_dir: CONFIG_DIR, token_exists: existsSync(TOKEN_FILE) }, null, 2) }],
}));

await connectTransport(server, { name: "anaf-efactura" });
