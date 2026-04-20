# Exemple de utilizare — ANAF e-Factura MCP

Fiecare exemplu arată: (a) ce îi zici lui Claude în limbaj natural, (b) ce tool apelează, (c) datele exacte trimise.

Pentru fluxul de autentificare, vezi [SETUP.md](SETUP.md#6-prima-autentificare).

---

## 1. Căutare firmă după CIF (fără autentificare)

Cel mai simplu test pentru a verifica că serverul merge.

**Tu:** *„Caută firma cu CIF 15193236"*

**Tool:** `anaf_company_lookup`

**Parametri:**
```json
{ "cif": "15193236" }
```

**Răspuns (extras):**
```json
{
  "found": [
    {
      "date_generale": {
        "cui": 15193236,
        "denumire": "ASMIN S.R.L.",
        "adresa": "MUN. BRASOV, STR. ...",
        "telefon": "...",
        "status_inactivi_reactivati": "nu figureaza inactiv fiscal"
      },
      "inregistrare_scop_Tva": { "scpTVA": false }
    }
  ]
}
```

Folosește-l înainte de orice factură pentru a confirma datele corecte ale clientului.

---

## 2. Factură B2B simplă, RO→RO, 19% TVA

Cazul cel mai frecvent: prestarea unui serviciu către o firmă românească plătitoare de TVA.

**Tu:** *„Fă o factură de la firma mea (ASMIN SRL, CIF 15193236, VAT RO15193236, Brașov, str. Memorandului 10) către Client Test SRL (CIF 12345678, VAT RO12345678, București, Calea Victoriei 1). Serviciu: 5 ore consultanță IT la 300 RON/oră. TVA 19%. Seria TEST, nr 0001, data azi, scadența peste 30 zile."*

**Tool:** `anaf_create_and_upload_invoice`

**Parametri:**
```json
{
  "invoice_number": "TEST-0001",
  "issue_date": "2026-04-20",
  "due_date": "2026-05-20",
  "currency": "RON",
  "type_code": "380",
  "supplier": {
    "name": "ASMIN S.R.L.",
    "cif": "15193236",
    "vat_id": "RO15193236",
    "street": "Str. Memorandului 10",
    "city": "Brașov",
    "county": "RO-BV",
    "country": "RO"
  },
  "customer": {
    "name": "Client Test S.R.L.",
    "cif": "12345678",
    "vat_id": "RO12345678",
    "street": "Calea Victoriei 1",
    "city": "București",
    "county": "RO-B",
    "country": "RO"
  },
  "payment_means": {
    "code": "30",
    "iban": "RO12BACX0000001234567890"
  },
  "lines": [
    {
      "description": "Servicii consultanță IT",
      "quantity": 5,
      "unit_price": 300,
      "unit": "HUR",
      "vat_percent": 19
    }
  ]
}
```

**Observații:**
- `CountrySubentity` folosește formatul **ISO 3166-2** (`RO-BV`, `RO-B` etc.) pentru județe — e cerința CIUS-RO.
- `unit: "HUR"` = ore (UN/ECE Rec 20). Pentru bucăți: `C62`. Pentru luni: `MON`.
- `payment_means.code: 30` = transfer bancar.
- Dacă nu specifici `vat_category`, se folosește `S` (standard) pentru TVA > 0. Corect pentru 19%/9%/5%.

**Rezultat:** Claude primește `id_incarcare` de la ANAF.

---

## 3. Factură cu TVA mixt (19% + 9%)

Restaurant, supermarket, firme cu bunuri în cote diferite.

**Tu:** *„Factură de la ASMIN către Client SRL: 10 buc produs A la 100 RON TVA 19%, 5 buc produs B (carte) la 50 RON TVA 9%."*

**Parametri (relevanți):**
```json
{
  "lines": [
    {
      "description": "Produs A",
      "quantity": 10,
      "unit_price": 100,
      "vat_percent": 19
    },
    {
      "description": "Carte (produs B)",
      "quantity": 5,
      "unit_price": 50,
      "vat_percent": 9
    }
  ]
}
```

MCP-ul generează **automat** două `<cac:TaxSubtotal>` separate la nivel document (una pentru 19%, una pentru 9%) — conform EN16931 BG-23.

---

## 4. Taxare inversă (AE) — B2B materiale de construcții, fier vechi etc.

Pentru operațiuni unde TVA se achită de către cumpărător (ex. livrări de cereale, deșeuri feroase, lemn).

**Tu:** *„Factură taxare inversă pentru livrare fier vechi: 1000 kg la 2 RON/kg, motivul: art. 331 alin (2) lit. d) Cod fiscal."*

**Parametri:**
```json
{
  "lines": [
    {
      "description": "Deșeuri feroase",
      "quantity": 1000,
      "unit_price": 2,
      "unit": "KGM",
      "vat_percent": 0,
      "vat_category": "AE",
      "vat_exemption_reason": "Taxare inversă conform art. 331 alin. (2) lit. d) din Codul Fiscal"
    }
  ]
}
```

**Atenție:** `vat_exemption_reason` e **obligatoriu** pentru `AE`. Fără el, ANAF respinge factura.

---

## 5. Livrare intracomunitară (K) — către firmă din UE

**Tu:** *„Emit factură către client german (DE123456789), 100 buc produs X la 50 EUR, scutit TVA livrare intracomunitară."*

**Parametri:**
```json
{
  "currency": "EUR",
  "customer": {
    "name": "Mustermann GmbH",
    "cif": "DE123456789",
    "vat_id": "DE123456789",
    "street": "Hauptstrasse 1",
    "city": "Berlin",
    "country": "DE"
  },
  "lines": [
    {
      "description": "Produs X",
      "quantity": 100,
      "unit_price": 50,
      "vat_percent": 0,
      "vat_category": "K",
      "vat_exemption_reason": "Scutit cu drept de deducere - livrare intracomunitară art. 294 alin. (2) Cod Fiscal"
    }
  ]
}
```

---

## 6. Export extra-UE (G)

**Tu:** *„Export către firmă din SUA: 1 echipament la 5000 USD."*

**Parametri:**
```json
{
  "currency": "USD",
  "customer": {
    "name": "US Buyer Inc",
    "cif": "US-EIN-12-3456789",
    "country": "US"
  },
  "lines": [
    {
      "description": "Echipament specializat",
      "quantity": 1,
      "unit_price": 5000,
      "vat_percent": 0,
      "vat_category": "G",
      "vat_exemption_reason": "Scutit cu drept de deducere - export art. 294 alin. (1) lit. a) Cod Fiscal"
    }
  ]
}
```

---

## 7. Notă de credit (storno parțial)

Pentru corecția unei facturi emise anterior.

**Tu:** *„Emit notă de credit pentru factura TEST-0001: storno 2 ore din cele 5 (au fost facturate greșit)."*

**Parametri:**
```json
{
  "invoice_number": "NC-0001",
  "issue_date": "2026-04-22",
  "type_code": "381",
  "note": "Storno parțial factura TEST-0001 din 2026-04-20 (2 ore facturate eronat)",
  "order_reference": "TEST-0001",
  "supplier": { "...": "la fel ca la factura originală" },
  "customer": { "...": "la fel ca la factura originală" },
  "lines": [
    {
      "description": "Storno consultanță IT",
      "quantity": 2,
      "unit_price": 300,
      "unit": "HUR",
      "vat_percent": 19
    }
  ]
}
```

**Important:** ANAF interpretează cantitățile de pe NC ca **valori absolute pozitive** — sistemul știe că e storno din `type_code: 381`. Nu pui cantități negative.

---

## 8. Verificare status upload

După ce ai încărcat o factură:

**Tu:** *„Verifică statusul uploadului cu id 5012345678."*

**Tool:** `anaf_upload_status`

**Parametri:**
```json
{ "upload_id": "5012345678" }
```

**Răspuns posibil (XML):**
```xml
<?xml version="1.0"?>
<header xmlns="mfp:anaf:dgti:spv:stareMesajFactura:v1"
  stare="ok"
  id_descarcare="7891234"
  id_incarcare="5012345678"/>
```

Stări posibile: `in prelucrare`, `ok`, `nok`, `XML cu erori nepreluat de sistem`.

---

## 9. Descarcă răspunsul oficial

După ce statusul e `ok` sau `nok`:

**Tu:** *„Descarcă răspunsul cu ID-ul 7891234."*

**Tool:** `anaf_download`

**Parametri:**
```json
{ "id": "7891234" }
```

ZIP-ul se salvează la `~/.anaf-efactura-mcp/download_7891234.zip`. Conține:
- Pentru `ok`: XML-ul semnat electronic cu sigiliul MF (dovadă oficială).
- Pentru `nok`: un XML cu erorile exacte.

---

## 10. Listare mesaje SPV

**Tu:** *„Listează facturile trimise de CIF 15193236 în ultimele 30 de zile."*

**Tool:** `anaf_list_messages`

**Parametri:**
```json
{
  "cif": "15193236",
  "days": 30,
  "filter": "T"
}
```

Filtre: `T`=trimise, `P`=primite, `E`=erori, `R`=mesaj cumpărător.

---

## 11. Generare XML fără upload (pentru review manual)

Dacă vrei doar să vezi XML-ul înainte de a-l trimite:

**Tu:** *„Generează XML-ul pentru factura X dar NU-l încărca."*

**Tool:** `anaf_generate_xml`

Primești XML-ul. Apoi:

**Tu:** *„Validează XML-ul generat."*

**Tool:** `anaf_validate_xml` → verifică structura (CIUS-RO, EN16931, BG-23 etc.)

Când ești mulțumit:

**Tu:** *„Încarcă XML-ul acesta cu CIF 15193236."*

**Tool:** `anaf_upload_invoice`

---

## 12. Debugging: o factură e respinsă

Scenariu tipic: `anaf_upload_status` returnează `stare="nok"`.

1. **Descarci răspunsul** cu `anaf_download` folosind `id_descarcare` din XML-ul de status.
2. Dezarhivezi ZIP-ul — conține un XML cu erori de tipul:
   ```xml
   <Error errorMessage="BR-CO-10: Sum of Invoice line net amount..."/>
   ```
3. Fiecare cod (`BR-*`, `BR-CO-*`) e o regulă EN16931 — caută-l în [documentația oficială](https://docs.peppol.eu/poacc/billing/3.0/rules/).
4. Corectezi datele, reemiti cu alt număr de factură (ANAF nu acceptă retrimitere cu același ID).

---

## Unități de măsură frecvente (UN/ECE Rec 20)

| Cod | Unitate |
|---|---|
| `C62` | Bucată (implicit) |
| `HUR` | Oră |
| `DAY` | Zi |
| `MON` | Lună |
| `KGM` | Kilogram |
| `GRM` | Gram |
| `LTR` | Litru |
| `MTR` | Metru |
| `MTK` | Metru pătrat |
| `MTQ` | Metru cub |
| `KMT` | Kilometru |
| `SET` | Set |
| `PCE` | Piece (la fel ca C62) |
| `H87` | Piece (alternativ) |
| `XPP` | Pachet |

---

## Sfaturi

- **Numerele de factură trebuie să fie unice** în sistemul tău contabil. ANAF acceptă orice format, dar bulgărele e: nu duplica.
- **Data facturii** nu poate fi în viitor. Poate fi retroactivă maxim 15 zile (regulă fiscală RO).
- **Pentru clienți B2C** (persoane fizice fără CIF): folosește CNP-ul drept `cif`. Dar e-Factura **nu** e obligatorie pentru B2C deocamdată.
- **Pentru salvare** ulterioară, Claude poate ține minte datele tale de supplier — zi-i o dată „Salvează datele firmei mele" și la facturile următoare le va folosi automat.