# anaf-efactura-mcp

**MCP server pentru sistemul ANAF e-Factura (Romania)** — creează, încarcă, validează și gestionează facturi electronice direct din SPV.

Compatibil cu [Model Context Protocol](https://modelcontextprotocol.io): Claude Desktop, Cursor, Windsurf, VS Code, orice client MCP.

[![npm](https://img.shields.io/npm/v/anaf-efactura-mcp.svg)](https://www.npmjs.com/package/anaf-efactura-mcp)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[🇷🇴 Română](#română) · [🇬🇧 English](#english) · [📘 Ghid setup pas-cu-pas](docs/SETUP.md) · [💡 Exemple](docs/USAGE.md)

---

## Română

### De ce există

România impune e-Facturare obligatorie pentru toate tranzacțiile B2B prin SPV. Acest server MCP permite asistenților AI (Claude, Cursor etc.) să gestioneze întregul flux — de la generare XML UBL 2.1 CIUS-RO conform până la upload direct în ANAF.

Gata cu editarea manuală de XML. Gata cu copy-paste în interfața web ANAF.

> *"Facturează-l pe Client SRL, CIF 12345678, 5 ore consultanță la 300 RON/oră, TVA 19%"*

### Înainte de instalare — CE AI NEVOIE OBLIGATORIU

1. **Certificat digital calificat** (token USB de tip certSIGN, DigiSign, Trans Sped etc.), înregistrat în SPV.
2. **Aplicație OAuth înregistrată la ANAF** → [logincert.anaf.ro/anaf-oauth2/v1/manager](https://logincert.anaf.ro/anaf-oauth2/v1/manager). Primești `client_id` + `client_secret` + trebuie să declari un `redirect_uri` HTTPS real (ANAF **nu** acceptă `urn:ietf:wg:oauth:2.0:oob`).
3. **Browser** cu certificatul digital instalat (Firefox sau Chrome/Edge cu ProCert).
4. **Node.js ≥ 20** (pentru `fetch` global).

👉 **[Ghidul complet cu capturi și pași](docs/SETUP.md)** — citește-l înainte de prima rulare.

### Instalare rapidă

#### Claude Desktop (stdio)

Editează `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anaf-efactura": {
      "command": "npx",
      "args": ["-y", "anaf-efactura-mcp"],
      "env": {
        "ANAF_ENV": "test"
      }
    }
  }
}
```

Repornește Claude Desktop. Tool-urile `anaf_*` apar în listă.

#### Remote / PM2 (HTTP streamable)

```bash
git clone https://github.com/hegetiby/anaf-efactura-mcp
cd anaf-efactura-mcp
cp .env.example .env
# editeaza .env
npm install
MCP_TRANSPORT=sse MCP_PORT=3800 node src/index.js
```

Sau cu PM2:

```bash
pm2 start src/index.js --name anaf-efactura
```

Endpoint-uri disponibile:
- `GET /health` — status serviciu
- `GET /` — identitate
- `POST /mcp` — JSON-RPC 2.0 (Streamable HTTP)
- `GET /.well-known/mcp/server-card.json`

### Tool-uri

| Tool | Auth | Descriere |
|---|:---:|---|
| `anaf_company_lookup` | ❌ | Caută date publice despre orice firmă RO după CIF |
| `anaf_auth_start` | ❌ | Generează URL OAuth2 |
| `anaf_auth_callback` | ❌ | Schimbă codul pe token |
| `anaf_auth_status` | ❌ | Verifică tokenul curent |
| `anaf_generate_xml` | ❌ | Generează UBL fără upload |
| `anaf_validate_xml` | ❌ | Validare structurală offline |
| `anaf_create_and_upload_invoice` | ✅ | Construiește UBL + upload, one-shot |
| `anaf_upload_invoice` | ✅ | Upload XML existent |
| `anaf_upload_status` | ✅ | Verifică statusul unui upload |
| `anaf_download` | ✅ | Descarcă răspunsul SPV (ZIP) |
| `anaf_list_messages` | ✅ | Listează mesaje SPV |

### Test rapid fără autentificare

Oricine poate verifica că serverul funcționează apelând `anaf_company_lookup` (folosește API-ul public ANAF TVA v9):

> *"Caută firma cu CIF 15193236"* → date reale din registrul ANAF.

### Flux tipic de utilizare

1. `anaf_auth_start` → obții URL-ul de autorizare
2. Deschizi URL-ul în browser (cu certificatul instalat) și autorizezi
3. Browser te redirectează la `redirect_uri?code=XXX` → copiezi codul
4. `anaf_auth_callback` cu codul → token-ul se salvează local
5. `anaf_create_and_upload_invoice` → generezi și încarci facturi
6. `anaf_upload_status` cu `id_incarcare` → urmărești procesarea
7. `anaf_download` cu ID-ul mesajului → descarci răspunsul oficial

### Tipuri de factură suportate

- `380` — Factură standard
- `381` — Notă de credit
- `384` — Notă de debit
- `389` — Autofactură

### Cote și categorii TVA

| Categorie | Cod | Utilizare tipică |
|---|:---:|---|
| Standard | `S` | Cote pozitive (19%, 9%, 5%) |
| Taxare inversă | `AE` | B2B între plătitori TVA pe anumite bunuri |
| Scutit | `E` | Operațiuni scutite fără drept de deducere |
| Cota zero | `Z` | Operațiuni cu cota 0% |
| Export extra-UE | `G` | Livrări în afara UE |
| Intracomunitar | `K` | Livrări intracomunitare |
| În afara scopului | `O` | Operațiuni în afara scopului TVA |

Dacă `vat_category` lipsește, se alege `S` pentru TVA > 0, `Z` pentru TVA = 0. Pentru orice altceva **trebuie specificat explicit** plus `vat_exemption_reason`.

### Variabile de mediu

| Variabilă | Default | Descriere |
|---|---|---|
| `ANAF_ENV` | `test` | `test` = sandbox, `production` = live |
| `ANAF_CLIENT_ID` | — | Client ID OAuth (opțional; se salvează la callback) |
| `ANAF_CLIENT_SECRET` | — | Client Secret OAuth |
| `ANAF_CONFIG_DIR` | `~/.anaf-efactura-mcp` | Unde se salvează tokenul |
| `MCP_TRANSPORT` | `stdio` | `stdio` sau `sse` |
| `MCP_PORT` | `3800` | Port pentru modul sse |

### Troubleshooting

- **„Neautentificat"** → rulează `anaf_auth_start` + `anaf_auth_callback`.
- **HTTP 400 la callback** → codul a expirat (valabil ~60s). Reia fluxul.
- **HTTP 401 la upload** → tokenul expirat și refresh eșuat. Reautentifică.
- **XML respins de ANAF** → rulează întâi `anaf_validate_xml` apoi vezi mesajul de la ANAF în răspuns.
- **`urn:ietf:wg:oauth:2.0:oob` nu funcționează** → corect, ANAF nu-l acceptă. Folosește un redirect_uri HTTPS real.

### Compliance XML

UBL 2.1 · EN 16931:2017 · CIUS-RO 1.0.1 · TaxSubtotal grupat pe cotă TVA (BG-23).

---

## English

### Why this exists

Romania mandates e-invoicing for all B2B transactions via ANAF's SPV. This MCP server lets AI assistants (Claude, Cursor etc.) handle the full invoice lifecycle — from generating compliant UBL 2.1 CIUS-RO XML to uploading directly to the ANAF API.

### Prerequisites (mandatory)

1. **Qualified digital certificate** (USB token), registered in SPV.
2. **OAuth app registered** at [logincert.anaf.ro/anaf-oauth2/v1/manager](https://logincert.anaf.ro/anaf-oauth2/v1/manager) with a real HTTPS redirect_uri. ANAF does **not** accept `urn:ietf:wg:oauth:2.0:oob`.
3. A browser with the certificate installed.
4. Node.js ≥ 20.

👉 **[Full setup guide](docs/SETUP.md)**

### Quick install (Claude Desktop)

```json
{
  "mcpServers": {
    "anaf-efactura": {
      "command": "npx",
      "args": ["-y", "anaf-efactura-mcp"],
      "env": { "ANAF_ENV": "test" }
    }
  }
}
```

### Authentication flow

1. Call `anaf_auth_start` → get authorization URL.
2. Open in a browser with the certificate installed; select the cert.
3. Browser redirects to `redirect_uri?code=XXX` — copy the code.
4. Call `anaf_auth_callback` with the code → token saved locally.
5. All subsequent calls auto-refresh the token.

### Compliance

UBL 2.1 · EN 16931:2017 · CIUS-RO 1.0.1

### License

MIT

---

Built by [@hegetiby](https://hegetiby.store). Report issues on [GitHub](https://github.com/hegetiby/anaf-efactura-mcp/issues).