#!/usr/bin/env node
// anaf-efactura-mcp - MCP server for Romania ANAF e-Factura (CIUS-RO 1.0.1 / EN16931)

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
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

let VERSION = "1.0.2";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  if (pkg.version) VERSION = pkg.version;
} catch {}

const ENV = process.env.ANAF_ENV === "production" ? "prod" : "test";
const BASE = ENV === "prod"
  ? "https://api.anaf.ro/prod/FCTEL/rest"
  : "https://api.anaf.ro/test/FCTEL/rest";
const OAUTH_BASE = "https://logincert.anaf.ro/anaf-oauth2/v1";
const ANAF_TVA_API = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";
const CONFIG_DIR = process.env.ANAF_CONFIG_DIR || join(process.env.HOME || "/tmp", ".anaf-efactura-mcp");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

function log(level, msg, extra = {}) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), svc: "anaf-efactura", level, msg, ...extra }));
}

function loadToken() {
  try {
    if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
  } catch (e) { log("error", "loadToken_failed", { err: e.message }); }
  return null;
}

function saveToken(tokenData) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  try { chmodSync(TOKEN_FILE, 0o600); } catch {}
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if ((res.status >= 500 || res.status === 429) && attempt < retries - 1) {
        const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
        log("warn", "retrying", { url, status: res.status, attempt, wait });
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) {
        const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
        log("warn", "fetch_error_retry", { url, err: e.message, attempt, wait });
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr || new Error("fetch_failed_after_retries");
}

async function getAccessToken() {
  let tok = loadToken();
  if (!tok) throw new Error("Neautentificat. Ruleaza anaf_auth_start + anaf_auth_callback.");
  if (tok.expires_at && Date.now() > tok.expires_at - 60000) {
    log("info", "refreshing_token");
    tok = await refreshToken(tok.refresh_token, tok.client_id, tok.client_secret);
  }
  return tok.access_token;
}

async function refreshToken(refresh_token, client_id, client_secret) {
  const cid = client_id || process.env.ANAF_CLIENT_ID;
  const cs = client_secret || process.env.ANAF_CLIENT_SECRET;
  if (!cid || !cs) throw new Error("ANAF_CLIENT_ID/SECRET lipsa.");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: cid, client_secret: cs });
  const res = await fetchWithRetry(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Refresh esuat: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const tokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    client_id: cid, client_secret: cs,
  };
  saveToken(tokenData);
  return tokenData;
}

async function anafRequest(path, options = {}) {
  const token = await getAccessToken();
  return fetchWithRetry(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

function escXml(str) {
  if (str == null || str === "") return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function n2(x) { return Number(x).toFixed(2); }

function inferTaxCategory(vat_percent, override) {
  if (override) return String(override).toUpperCase();
  if (vat_percent > 0) return "S";
  return "Z";
}
function buildInvoiceXML(inv) {
  const currency = inv.currency || "RON";
  const lines = inv.lines || [];

  const lineXml = lines.map((l, i) => {
    const qty = Number(l.quantity);
    const price = Number(l.unit_price);
    const vat = l.vat_percent ?? 19;
    const cat = inferTaxCategory(vat, l.vat_category);
    const taxable = qty * price;
    const longDesc = l.description_long ? `<cbc:Description>${escXml(l.description_long)}</cbc:Description>` : "";
    const cls = l.classification_code
      ? `<cac:CommodityClassification><cbc:ItemClassificationCode listID="STI">${escXml(l.classification_code)}</cbc:ItemClassificationCode></cac:CommodityClassification>`
      : "";
    return `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${escXml(l.unit || "C62")}">${qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${currency}">${n2(taxable)}</cbc:LineExtensionAmount>
      <cac:Item>
        ${longDesc}
        <cbc:Name>${escXml(l.description)}</cbc:Name>
        ${cls}
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${cat}</cbc:ID>
          <cbc:Percent>${vat}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${currency}">${n2(price)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`;
  }).join("");

  const groups = new Map();
  for (const l of lines) {
    const vat = l.vat_percent ?? 19;
    const cat = inferTaxCategory(vat, l.vat_category);
    const key = `${cat}_${vat}`;
    const taxable = Number(l.quantity) * Number(l.unit_price);
    const tax = taxable * vat / 100;
    const g = groups.get(key) || { cat, rate: vat, taxable: 0, tax: 0, reason: l.vat_exemption_reason };
    g.taxable += taxable;
    g.tax += tax;
    if (!g.reason && l.vat_exemption_reason) g.reason = l.vat_exemption_reason;
    groups.set(key, g);
  }

  let taxableTotal = 0, taxTotal = 0;
  const subtotalXml = [];
  for (const g of groups.values()) {
    taxableTotal += g.taxable;
    taxTotal += g.tax;
    const reasonTag = (g.cat !== "S" && g.reason)
      ? `<cbc:TaxExemptionReason>${escXml(g.reason)}</cbc:TaxExemptionReason>` : "";
    subtotalXml.push(`
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${n2(g.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${n2(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${g.cat}</cbc:ID>
        <cbc:Percent>${g.rate}</cbc:Percent>
        ${reasonTag}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
  }
  const payableTotal = taxableTotal + taxTotal;

  const partyXml = (p) => `<cac:Party>
    <cac:PartyName><cbc:Name>${escXml(p.name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>${escXml(p.street || "")}</cbc:StreetName>
      <cbc:CityName>${escXml(p.city || "")}</cbc:CityName>
      <cbc:CountrySubentity>${escXml(p.county || "")}</cbc:CountrySubentity>
      <cac:Country><cbc:IdentificationCode>${escXml(p.country || "RO")}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    ${p.vat_id ? `<cac:PartyTaxScheme><cbc:CompanyID>${escXml(p.vat_id)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
    <cac:PartyLegalEntity>
      <cbc:RegistrationName>${escXml(p.name)}</cbc:RegistrationName>
      <cbc:CompanyID>${escXml(p.reg_com || p.cif)}</cbc:CompanyID>
    </cac:PartyLegalEntity>
    ${p.contact_name || p.contact_email || p.contact_phone ? `<cac:Contact>
      ${p.contact_name ? `<cbc:Name>${escXml(p.contact_name)}</cbc:Name>` : ""}
      ${p.contact_phone ? `<cbc:Telephone>${escXml(p.contact_phone)}</cbc:Telephone>` : ""}
      ${p.contact_email ? `<cbc:ElectronicMail>${escXml(p.contact_email)}</cbc:ElectronicMail>` : ""}
    </cac:Contact>` : ""}
  </cac:Party>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${escXml(inv.invoice_number)}</cbc:ID>
  <cbc:IssueDate>${escXml(inv.issue_date)}</cbc:IssueDate>
  ${inv.due_date ? `<cbc:DueDate>${escXml(inv.due_date)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${escXml(inv.type_code || "380")}</cbc:InvoiceTypeCode>
  ${inv.note ? `<cbc:Note>${escXml(inv.note)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${escXml(currency)}</cbc:DocumentCurrencyCode>
  ${inv.buyer_reference ? `<cbc:BuyerReference>${escXml(inv.buyer_reference)}</cbc:BuyerReference>` : ""}
  ${inv.order_reference ? `<cac:OrderReference><cbc:ID>${escXml(inv.order_reference)}</cbc:ID></cac:OrderReference>` : ""}
  <cac:AccountingSupplierParty>${partyXml(inv.supplier)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${partyXml(inv.customer)}</cac:AccountingCustomerParty>
  ${inv.payment_means ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>${escXml(inv.payment_means.code || "30")}</cbc:PaymentMeansCode>
    ${inv.due_date ? `<cbc:PaymentDueDate>${escXml(inv.due_date)}</cbc:PaymentDueDate>` : ""}
    ${inv.payment_means.iban ? `<cac:PayeeFinancialAccount><cbc:ID>${escXml(inv.payment_means.iban)}</cbc:ID></cac:PayeeFinancialAccount>` : ""}
  </cac:PaymentMeans>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${n2(taxTotal)}</cbc:TaxAmount>${subtotalXml.join("")}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${n2(taxableTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${n2(taxableTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${n2(payableTotal)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${n2(payableTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}
const partySchema = z.object({
  name: z.string(),
  cif: z.string().describe("CIF fara RO."),
  vat_id: z.string().optional().describe("Ex: RO12345678 (doar platitori TVA)."),
  reg_com: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  country: z.string().default("RO"),
  contact_name: z.string().optional(),
  contact_email: z.string().optional(),
  contact_phone: z.string().optional(),
});

const lineSchema = z.object({
  description: z.string(),
  description_long: z.string().optional(),
  quantity: z.number(),
  unit_price: z.number(),
  unit: z.string().default("C62").describe("UN/ECE Rec 20. C62=buc, HUR=ora, KGM=kg, LTR=litru, MTR=metru, MON=luna"),
  vat_percent: z.number().default(19),
  vat_category: z.enum(["S", "AE", "E", "Z", "G", "K", "O"]).optional().describe("S=standard, AE=taxare inversa, E=scutit, Z=cota zero, G=export extra-UE, K=intracomunitar, O=in afara scopului."),
  vat_exemption_reason: z.string().optional().describe("Obligatoriu pentru AE/E/K/G/O."),
  classification_code: z.string().optional(),
});

const invoiceSchema = {
  invoice_number: z.string(),
  issue_date: z.string().describe("YYYY-MM-DD"),
  due_date: z.string().optional(),
  currency: z.string().default("RON"),
  type_code: z.string().default("380").describe("380=factura, 381=nota credit, 384=nota debit, 389=autofactura"),
  note: z.string().optional(),
  order_reference: z.string().optional(),
  buyer_reference: z.string().optional(),
  supplier: partySchema,
  customer: partySchema,
  payment_means: z.object({
    code: z.string().default("30").describe("30=transfer, 42=virament, 48=card, 49=debit direct, 1=numerar"),
    iban: z.string().optional(),
  }).optional(),
  lines: z.array(lineSchema).min(1),
};

const server = new McpServer({ name: "anaf-efactura", version: VERSION });

server.tool(
  "anaf_auth_start",
  "Genereaza URL-ul OAuth2 ANAF. PREREQUISITE: (1) certificat digital calificat inregistrat in SPV, instalat in browser; (2) aplicatie OAuth inregistrata la https://logincert.anaf.ro/anaf-oauth2/v1/manager cu redirect_uri HTTPS (ANAF NU accepta OOB).",
  {
    client_id: z.string(),
    redirect_uri: z.string().describe("URI HTTPS inregistrat in aplicatia OAuth."),
  },
  async ({ client_id, redirect_uri }) => {
    const url = `${OAUTH_BASE}/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&token_content_type=jwt`;
    return { content: [{ type: "text", text:
`Deschide in browser (cu certificatul digital):\n\n${url}\n\nVei fi redirectat la: ${redirect_uri}?code=<COD>\nCopiaza code si cheama anaf_auth_callback in max 60s.` }] };
  }
);

server.tool(
  "anaf_auth_callback",
  "Schimba codul pe access+refresh token. Salvat local (0600), refresh automat.",
  {
    code: z.string(),
    client_id: z.string(),
    client_secret: z.string(),
    redirect_uri: z.string(),
  },
  async ({ code, client_id, client_secret, redirect_uri }) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code, client_id, client_secret, redirect_uri,
      token_content_type: "jwt",
    });
    const res = await fetchWithRetry(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { content: [{ type: "text", text: `Eroare (HTTP ${res.status}):\n${text}\n\nVerifica: cod neexpirat, client_id/secret, redirect_uri identic.` }], isError: true };
    }
    const data = await res.json();
    const tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      client_id, client_secret,
    };
    saveToken(tokenData);
    return { content: [{ type: "text", text: `Autentificare reusita. Token salvat la ${TOKEN_FILE}.\nExpira: ${new Date(tokenData.expires_at).toISOString()}. Refresh automat.` }] };
  }
);

server.tool(
  "anaf_auth_status",
  "Verifica daca exista token valid salvat.",
  {},
  async () => {
    const tok = loadToken();
    if (!tok) return { content: [{ type: "text", text: `Neautentificat. Ruleaza anaf_auth_start/anaf_auth_callback.` }] };
    const expIn = tok.expires_at ? Math.round((tok.expires_at - Date.now()) / 1000) : null;
    return { content: [{ type: "text", text: JSON.stringify({
      authenticated: true,
      environment: ENV,
      token_file: TOKEN_FILE,
      expires_at: tok.expires_at ? new Date(tok.expires_at).toISOString() : null,
      expires_in_seconds: expIn,
      expired: expIn !== null && expIn < 0,
    }, null, 2) }] };
  }
);
server.tool(
  "anaf_upload_invoice",
  "Incarca XML UBL/CII existent in e-Factura.",
  {
    cif: z.string(),
    xml: z.string(),
    standard: z.enum(["UBL", "CII"]).default("UBL"),
    extern: z.boolean().default(false),
  },
  async ({ cif, xml, standard, extern }) => {
    const cleanCif = cif.replace(/^RO/i, "").trim();
    const params = new URLSearchParams({ standard, cif: cleanCif });
    if (extern) params.set("extern", "DA");
    const res = await anafRequest(`/upload?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xml,
    });
    const text = await res.text();
    if (!res.ok) return { content: [{ type: "text", text: `Upload esuat (HTTP ${res.status}):\n${text}` }], isError: true };
    return { content: [{ type: "text", text: `Upload reusit.\n${text}` }] };
  }
);

server.tool(
  "anaf_create_and_upload_invoice",
  "Construieste UBL CIUS-RO din date structurate si incarca direct. One-shot.",
  { ...invoiceSchema, extern: z.boolean().default(false) },
  async (inv) => {
    try {
      const xml = buildInvoiceXML(inv);
      const cif = inv.supplier.cif.replace(/^RO/i, "").trim();
      const params = new URLSearchParams({ standard: "UBL", cif });
      if (inv.extern) params.set("extern", "DA");
      const res = await anafRequest(`/upload?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: xml,
      });
      const respText = await res.text();
      if (!res.ok) return { content: [{ type: "text", text: `Upload esuat (HTTP ${res.status}):\n${respText}\n\n--- XML generat ---\n${xml}` }], isError: true };
      return { content: [{ type: "text", text: `Factura incarcata.\n\n--- Raspuns ANAF ---\n${respText}\n\n--- XML generat ---\n${xml}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Eroare: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "anaf_upload_status",
  "Verifica statusul unui upload dupa id_incarcare.",
  { upload_id: z.string() },
  async ({ upload_id }) => {
    const res = await anafRequest(`/stareMesaj?id_incarcare=${encodeURIComponent(upload_id)}`);
    return { content: [{ type: "text", text: await res.text() }] };
  }
);

server.tool(
  "anaf_download",
  "Descarca arhiva ZIP a unui mesaj SPV.",
  { id: z.string() },
  async ({ id }) => {
    const res = await anafRequest(`/descarcare?id=${encodeURIComponent(id)}`);
    if (!res.ok) return { content: [{ type: "text", text: `Eroare (HTTP ${res.status}): ${await res.text()}` }], isError: true };
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(CONFIG_DIR, { recursive: true });
    const outPath = join(CONFIG_DIR, `download_${id}.zip`);
    writeFileSync(outPath, buf);
    return { content: [{ type: "text", text: `ZIP salvat: ${outPath} (${buf.length} bytes)` }] };
  }
);

server.tool(
  "anaf_list_messages",
  "Listeaza mesajele SPV.",
  {
    cif: z.string(),
    days: z.number().min(1).max(60).default(60),
    filter: z.enum(["E", "P", "T", "R"]).optional().describe("E=erori, P=primite, T=trimise, R=mesaj cumparator"),
  },
  async ({ cif, days, filter }) => {
    const cleanCif = cif.replace(/^RO/i, "").trim();
    let path = `/listaMesajeFactura?zile=${days}&cif=${cleanCif}`;
    if (filter) path += `&filtru=${filter}`;
    const res = await anafRequest(path);
    return { content: [{ type: "text", text: await res.text() }] };
  }
);

server.tool(
  "anaf_validate_xml",
  "Validare structurala offline a XML-ului UBL.",
  { xml: z.string() },
  async ({ xml }) => {
    const errors = [];
    const warnings = [];
    const required = [
      "cbc:CustomizationID", "cbc:ID", "cbc:IssueDate", "cbc:InvoiceTypeCode",
      "cbc:DocumentCurrencyCode", "cac:AccountingSupplierParty", "cac:AccountingCustomerParty",
      "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:InvoiceLine",
    ];
    for (const tag of required) {
      if (!xml.includes(`<${tag}`)) errors.push(`Element lipsa: ${tag}`);
    }
    if (!xml.includes("CIUS-RO")) errors.push("CustomizationID nu contine CIUS-RO");
    if (!xml.includes("urn:cen.eu:en16931:2017")) errors.push("CustomizationID nu indica EN16931");
    const docTaxTotal = xml.match(/<cac:TaxTotal>[\s\S]*?<\/cac:TaxTotal>/);
    if (docTaxTotal && !docTaxTotal[0].includes("<cac:TaxSubtotal")) {
      errors.push("TaxTotal la nivel document nu contine TaxSubtotal (BG-23 obligatoriu)");
    }
    if (!xml.trim().startsWith("<?xml") && !xml.trim().startsWith("<Invoice")) {
      warnings.push("XML nu incepe cu <?xml sau <Invoice");
    }
    const result = { valid: errors.length === 0, errors, warnings, note: "Validarea completa se face la upload prin ANAF." };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: errors.length > 0 };
  }
);

server.tool(
  "anaf_generate_xml",
  "Genereaza DOAR XML-ul UBL, fara upload.",
  invoiceSchema,
  async (inv) => ({ content: [{ type: "text", text: buildInvoiceXML(inv) }] })
);

server.tool(
  "anaf_company_lookup",
  "Cauta date publice despre o firma romaneasca dupa CIF. Nu necesita autentificare.",
  { cif: z.string() },
  async ({ cif }) => {
    const cifClean = cif.replace(/^RO/i, "").trim();
    const cifNum = parseInt(cifClean, 10);
    if (isNaN(cifNum)) return { content: [{ type: "text", text: `CIF invalid: ${cif}` }], isError: true };
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetchWithRetry(ANAF_TVA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cui: cifNum, data: today }]),
    });
    if (!res.ok) return { content: [{ type: "text", text: `Eroare API ANAF: HTTP ${res.status}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  }
);

server.resource(
  "config",
  "anaf://config",
  { description: "Configuratia curenta a serverului MCP" },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        version: VERSION,
        environment: ENV,
        base_url: BASE,
        oauth_base: OAUTH_BASE,
        config_dir: CONFIG_DIR,
        token_exists: existsSync(TOKEN_FILE),
        client_id_configured: !!process.env.ANAF_CLIENT_ID,
      }, null, 2),
    }],
  })
);

log("info", "starting", { version: VERSION, env: ENV, transport: process.env.MCP_TRANSPORT || "stdio" });
await connectTransport(server, { name: "anaf-efactura" });