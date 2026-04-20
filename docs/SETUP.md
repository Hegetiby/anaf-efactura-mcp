# Ghid Setup ANAF e-Factura MCP — Pas cu Pas

Acest ghid te duce de la zero până la prima factură încărcată cu succes. Urmează pașii **în ordine**. Dacă sari pași, probabil nu va merge.

## 📋 Rezumat cerințe

Înainte să instalezi MCP-ul, ai nevoie de **patru lucruri**, în această ordine:

1. Un **certificat digital calificat** (token USB)
2. Înregistrarea acelui certificat în **SPV (Spațiul Privat Virtual)** la ANAF
3. O **aplicație OAuth2** înregistrată la ANAF (cu `client_id` + `client_secret` + `redirect_uri`)
4. Certificatul **instalat în browser** (Firefox sau Chrome/Edge cu ProCert)

Dacă ai deja toate astea, sari direct la [pasul 5](#5-configurare-mcp-server).

---

## 1. Obținerea certificatului digital calificat

ANAF acceptă doar certificate emise de **furnizori acreditați** (lista oficială: [cloudsign.ro](https://cloudsign.ro) → caută "autoritati de certificare"). Cei mai folosiți:

| Furnizor | Preț aprox. (1 an) | Site |
|---|---|---|
| **certSIGN** | 160-250 RON | [certsign.ro](https://www.certsign.ro) |
| **DigiSign** | 150-230 RON | [digisign.ro](https://www.digisign.ro) |
| **Trans Sped** | 170-260 RON | [transsped.ro](https://www.transsped.ro) |
| **Alfasign** | 150-220 RON | [alfasign.ro](https://www.alfasign.ro) |

### Ce primești

- **Token USB** (stick fizic) sau **certificat în cloud** (mai nou, nu toți îl suportă)
- Software de instalare (driver pentru token + aplicația de management)
- Cod PIN (ține-l la vedere doar TU — dacă-l pierzi, certificatul devine inutilizabil)
- Un fișier `.p12` sau `.pfx` (pentru varianta soft; pentru token fizic nu ai fișier)

### Timp necesar

- Comandă online → primire token prin curier: **3-5 zile lucrătoare**
- Verificare identitate (video-call cu operator sau deplasare): **1 zi**
- Emisiune certificat: **aceeași zi** după verificare

### Important

- Certificatul trebuie să fie **pe numele persoanei fizice** care are drept de semnătură în firmă (administrator, sau angajat cu procură notarială).
- **NU** cumpăra certificat de tip "simplu/nealificat" — nu funcționează pentru SPV.

---

## 2. Înregistrarea certificatului în SPV

După ce ai certificatul:

### Pas 2.1 — Instalează driver-ul

Urmează instrucțiunile de la furnizorul tău. De obicei:
- Windows: descarci și rulezi installer-ul (ex. `certSIGN Digital Signing Tool`)
- Macasul vine cu SafeNet Authentication Client sau similar
- Linux: mai complicat (OpenSC + pkcs11)

Verifică instalarea: deschide `certmgr.msc` pe Windows → Personal → Certificate → trebuie să-l vezi listat când conectezi token-ul USB.

### Pas 2.2 — Intră pe anaf.ro cu certificatul

1. Mergi la [anaf.ro](https://www.anaf.ro)
2. Click pe **„Spațiul Privat Virtual"** (colț dreapta-sus)
3. Click pe **„Autentificare cu certificat digital"**
4. Browser-ul îți cere certificatul → alegi-l → introduci PIN-ul
5. Dacă primești eroare „certificat negăsit" → treci la [Pasul 4](#4-instalarea-certificatului-în-browser)

### Pas 2.3 — Înregistrarea efectivă (prima oară)

Dacă e prima dată când folosești certificatul pe ANAF, vei vedea un formular de înregistrare SPV:

1. Completezi datele firmei (CUI, denumire, adresă)
2. Încarci o **cerere semnată olograf + scan** (se generează din sistem, o printezi, o semnezi, o scanezi, o urci)
3. ANAF verifică (1-3 zile lucrătoare)
4. Primești email când e aprobat

**Verifică status la:** anaf.ro → SPV → contul tău → „Cereri și răspunsuri"

---

## 3. Înregistrarea aplicației OAuth2 la ANAF

Acesta e pasul care **blochează** majoritatea oamenilor. Citește-l atent.

### Pas 3.1 — Intră pe portalul OAuth

URL: **[https://logincert.anaf.ro/anaf-oauth2/v1/manager](https://logincert.anaf.ro/anaf-oauth2/v1/manager)**

Te autentifici cu **același certificat** folosit pentru SPV.

### Pas 3.2 — „Adaugă aplicație"

Completezi:

| Câmp | Ce pui |
|---|---|
| **Nume aplicație** | Orice (ex: „Factura mea AI") |
| **Descriere** | Orice (ex: „Integrare MCP pentru e-Factura") |
| **Redirect URI** | ⚠️ VEZI MAI JOS |
| **Website** | URL-ul firmei tale (opțional) |

### Pas 3.3 — Alegerea `redirect_uri` — CRUCIAL

ANAF **nu acceptă** valori ca `urn:ietf:wg:oauth:2.0:oob` sau `http://localhost`. Îți trebuie un **URL HTTPS real**.

**Variante:**

#### Varianta A — Tu ai deja un domeniu

Dacă ai un server web cu HTTPS (ex: `https://firma-mea.ro`), folosește un path dummy:

```
https://firma-mea.ro/anaf-callback
```

Nu contează dacă acel URL returnează 404. ANAF doar te redirectează acolo cu `?code=XXX` în URL — tu copiezi manual `code` din bara browserului.

#### Varianta B — Folosești un serviciu de redirect gratuit

Ex. `https://oauth.pstmn.io/v1/callback` (Postman OAuth helper) — funcționează dacă-l înregistrezi exact așa.

#### Varianta C — Ridici un callback temporar

Rulezi local un mini-server Node care ascultă pe HTTPS și captează `code`. Exemplu minim (necesită certificat self-signed + `/etc/hosts` sau Cloudflare Tunnel).

### Pas 3.4 — Primești credențialele

După salvare vezi:
- **Client ID** (ex: `abc123def456...`)
- **Client Secret** (ex: `789xyz...`) — ⚠️ **salvează-l imediat**, nu-l mai poți vedea după ce închizi pagina

### ⚠️ Alegerea mediului: TEST vs PRODUCTION

În portal există două tab-uri:
- **Test** — sandbox ANAF, facturile NU intră în sistemul real
- **Production** — live, facturile sunt valide fiscal

**Începe cu Test.** Treci la Production doar după ce ai încărcat măcar 1 factură de test cu succes.

Fiecare are client_id/secret diferit. Trebuie să înregistrezi aplicația **separat** în fiecare mediu.

---

## 4. Instalarea certificatului în browser

Ca să te autentifici pe ANAF, browserul trebuie să „vadă" certificatul din token-ul USB.

### Firefox (recomandat, cel mai simplu)

Firefox are propriul magazin de certificate. Adăugăm modulul PKCS#11 al token-ului:

1. Firefox → `about:preferences#privacy` → scroll până jos → **„Certificates"** → **„Security Devices"**
2. **„Load"** → alegi modulul `.dll` al driver-ului tău:
   - certSIGN: `C:\Program Files\certSIGN\certSIGN Digital Signing\certSIGN_pkcs11.dll`
   - SafeNet (DigiSign): `C:\Windows\System32\eTPKCS11.dll`
   - Trans Sped: vezi docs furnizor
3. Dă-i un nume (ex. „Token ANAF") și salvează.
4. Conectează token-ul USB → testează: mergi la [anaf.ro](https://www.anaf.ro) → SPV → vei fi întrebat de PIN.

### Chrome / Edge (necesită ProCert)

Windows-ul trebuie să vadă certificatul. Dacă driver-ul furnizorului deja îl înregistrează în „Certificate Store" Windows, Chrome/Edge îl vor găsi automat.

Dacă nu funcționează:
1. Instalează **ProCert** (aplicație gratuită pentru Windows) — importă automat certificatele din PKCS#11.
2. Download: [procert.ro](https://www.procert.ro) (sau caută „ProCert pentru Chrome Romania")
3. După instalare, Chrome va cere certificatul la următoarea autentificare ANAF.

### Test rapid

Mergi la [https://logincert.anaf.ro](https://logincert.anaf.ro). Dacă vezi o pagină care cere certificatul → e OK. Dacă vezi eroare SSL sau pagină albă → browserul nu găsește certificatul.

---

## 5. Configurare MCP server

Alegi unul dintre două moduri de rulare:

### Modul A — Claude Desktop (stdio, local)

Editează `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

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

Repornește Claude Desktop. Deschide o conversație și tastează `/` — ar trebui să vezi tool-urile `anaf_*` în listă.

### Modul B — Server remote (HTTP / PM2)

Util dacă vrei ca mai mulți oameni/clienți MCP să folosească același server.

```bash
git clone https://github.com/hegetiby/anaf-efactura-mcp.git
cd anaf-efactura-mcp
npm install
cp .env.example .env
# editeaza .env: ANAF_ENV=test
MCP_TRANSPORT=sse MCP_PORT=3800 node src/index.js
```

Cu PM2:

```bash
pm2 start src/index.js --name anaf-efactura \
  --env ANAF_ENV=test \
  --env MCP_TRANSPORT=sse \
  --env MCP_PORT=3800
pm2 save
```

Apoi în clientul MCP conectezi la `http://server-ul-tau:3800/mcp`.

---

## 6. Prima autentificare

Cu MCP-ul pornit, într-o conversație cu Claude (sau alt client):

### Pas 6.1 — Generează URL-ul de autorizare

Tastezi (sau Claude va apela automat):

> *„Vreau să mă autentific la ANAF. Client ID-ul e `abc123...`, redirect_uri e `https://firma-mea.ro/anaf-callback`."*

Claude apelează `anaf_auth_start` și îți returnează un URL de forma:

```
https://logincert.anaf.ro/anaf-oauth2/v1/authorize?response_type=code&client_id=abc123...&redirect_uri=https%3A%2F%2Ffirma-mea.ro%2Fanaf-callback&token_content_type=jwt
```

### Pas 6.2 — Deschide URL-ul în browser

- Browser-ul trebuie să aibă certificatul disponibil (vezi [Pasul 4](#4-instalarea-certificatului-în-browser)).
- Introduci PIN-ul.
- Apare pagina de confirmare ANAF → click „Autorizez".

### Pas 6.3 — Capturează codul

Browser-ul te redirectează la:

```
https://firma-mea.ro/anaf-callback?code=AUTHCODE123&state=...
```

Chiar dacă pagina dă 404, **bara de adresă îți arată codul**. Copiază valoarea lui `code`.

### ⚠️ Codul expiră în ~60 secunde. Grăbește-te.

### Pas 6.4 — Schimbă codul pe token

Înapoi în conversație:

> *„Codul e `AUTHCODE123`, client_secret-ul e `789xyz...`."*

Claude apelează `anaf_auth_callback` → tokenul e salvat local la `~/.anaf-efactura-mcp/token.json` cu permisiuni 0600.

### Pas 6.5 — Verificare

> *„Verifică statusul autentificării."*

`anaf_auth_status` returnează `{authenticated: true, expires_in_seconds: 3600, ...}` — ești logat.

---

## 7. Prima factură (sandbox)

În mediul **test**, poți încărca orice date. Factura nu e validă fiscal.

> *„Emite o factură test de la ASMIN SRL (CIF 15193236) către ACME Client SRL (CIF 12345678), 5 ore consultanță la 300 RON/oră, TVA 19%, data azi, seria TEST, nr 001."*

Claude apelează `anaf_create_and_upload_invoice` cu structura completă. Primești `id_incarcare`.

Apoi:

> *„Verifică statusul uploadului cu id-ul X."*

Când statusul e `ok`, descarci răspunsul oficial:

> *„Descarcă răspunsul cu ID-ul Y."*

ZIP-ul se salvează în `~/.anaf-efactura-mcp/`.

---

## 8. Trecerea la PRODUCTION

După ce fluxul merge pe test:

1. Înregistrează o **aplicație OAuth separată** în tab-ul **Production** pe portalul ANAF (altul client_id/secret).
2. Setează `ANAF_ENV=production` în `.env` sau în config.
3. Șterge tokenul vechi: `rm ~/.anaf-efactura-mcp/token.json` (altfel folosește cel de test).
4. Reia fluxul de autentificare cu credențialele de production.
5. Prima factură reală → atenție la sumele și CIF-urile corecte.

---

## 9. Troubleshooting

### „certificat negăsit" la ANAF

- Token-ul USB e conectat?
- Driver-ul e instalat? (Verifică în Device Manager — nu trebuie să apară semn galben.)
- Browser-ul îl vede? (Firefox: `about:preferences` → Security Devices)
- PIN-ul corect? (3 încercări greșite → token blocat, trebuie deblocat cu PUK de la furnizor)

### „Cerere OAuth: 400 invalid_grant"

- Codul a expirat (peste 60s de la primire). Reia de la `anaf_auth_start`.
- `redirect_uri` e diferit față de cel înregistrat (spații, slash final, http vs https) — trebuie **identic caracter cu caracter**.

### „HTTP 401 Unauthorized" la upload

- Tokenul a expirat și refresh-ul a eșuat.
- Rulează `anaf_auth_status` → dacă `expired: true`, reautentifică.

### „Factura respinsă" (status `nok`)

- Descarcă răspunsul ANAF cu `anaf_download` — ZIP-ul conține un XML cu erorile exacte.
- Rulează `anaf_validate_xml` pe XML-ul trimis — poate găsi probleme înainte de upload.
- Erori comune: CIF inexistent, cota TVA greșită, adresă lipsă, dată invalidă, TaxSubtotal lipsă (fix în v1.0.2).

### SPV status „în verificare" > 5 zile

Sună la ANAF: 031.403.91.60 sau deschide ticket la ghișeul lor online.

---

## 10. Resurse oficiale ANAF

- Portal e-Factura: [mfinante.gov.ro/ro/web/efactura](https://mfinante.gov.ro/ro/web/efactura)
- Documentație API: [mfinante.gov.ro/ro/web/efactura/informatii-tehnice](https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice)
- Portal OAuth manager: [logincert.anaf.ro/anaf-oauth2/v1/manager](https://logincert.anaf.ro/anaf-oauth2/v1/manager)
- Validator XML ANAF (oficial): [mfinante.gov.ro → validator online](https://mfinante.gov.ro/ro/web/efactura)
- Specificația CIUS-RO (PDF) — se descarcă din documentația tehnică
- Forum tehnic: [github.com/hegetiby/anaf-efactura-mcp/discussions](https://github.com/hegetiby/anaf-efactura-mcp/discussions)

---

Ai terminat! Dacă blocaj în orice pas → [deschide un issue](https://github.com/hegetiby/anaf-efactura-mcp/issues).