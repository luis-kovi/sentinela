# spec.md — PR Hub (Plataforma de Acionamento de Pronta Resposta)
**Versão:** 0.1  
**Data:** 2026-02-03  
**Objetivo do arquivo:** servir como especificação técnica única para orientar o desenvolvimento via Codex (MVP + incrementos), incluindo modelo de dados (Prisma/Postgres), contratos REST e checklist de entrega.

---

## 1) Contexto e problema
- Operação de monitoramento precisa acionar fornecedores de pronta resposta.
- WhatsApp mistura acionamentos, reduz rastreabilidade e aumenta retrabalho.
- Necessidade de:
  - **Cotação** (múltiplos fornecedores → 1 aprovado)
  - **Chat por acionamento** (criado somente após aprovação)
  - **Link web mobile** para prestador em campo (sem cadastro) para GPS/mídias/eventos
  - **Trilha de auditoria** e **dashboards de custos**
  - **Controle de acesso** (dados limitados antes da aprovação)

---

## 2) Escopo do MVP
### Inclui
1. Cadastro Admin: fornecedores, usuários e (opcional) veículos.
2. Kovi cria solicitação e seleciona fornecedores para cotar.
3. Fornecedor responde ETA (minutos).
4. Kovi aprova uma proposta → cria chat e libera detalhes completos.
5. Prestador em campo usa link: iniciar deslocamento, enviar GPS, marcar chegada, anexar mídias, solicitar encerramento.
6. Fornecedor submete custos; sistema valida KM/hora adicional; Kovi revisa/encerra.
7. Auditoria e relatórios básicos (custos por fornecedor/período).

### Fora (MVP)
- Pagamento/faturamento/NF.
- App nativo.
- Fornecedor iniciar contato sem acionamento vigente.
- Integrações obrigatórias com sistemas externos (pode ser fase 2).

---

## 3) Stack recomendada (referência)
- Front + API: **Next.js + TypeScript**
- DB: **PostgreSQL**
- ORM: **Prisma**
- Realtime: **Socket.IO**
- Mapas: **Leaflet + OpenStreetMap tiles**
- Reverse geocoding: **Nominatim** (com cache + rate limit)
- Storage: **S3 compatível** (ex.: MinIO local; S3 em produção)
- Auth: **Auth.js/NextAuth** (RBAC por role)

> Observação: versões exatas ficam no `package.json` e devem ser mantidas patched por segurança.

---

## 4) Papéis (RBAC) e permissões
### Roles
- **ADMIN**: tudo do KOVI + gerenciar cadastros (usuários, fornecedores, veículos, parâmetros).
- **KOVI**: criar/gerenciar acionamentos, aprovar/reprovar, chat, revisão de custos, dashboards.
- **SUPPLIER**: receber cotações (dados restritos), enviar ETA, acessar chat e custos **somente se aprovado**.

### Prestador (Field)
- **Sem login**: acesso por link tokenizado (token puro nunca persistido).
- Não vê e não interage no chat; apenas envia GPS/mídias e eventos.

---

## 5) Máquina de estados (Dispatch)
Estados (`DispatchStatus`):
- `QUOTING` → `APPROVED` **ou** `REJECTED`
- `APPROVED` → `IN_TRANSIT` → `ON_SITE` → `CLOSE_REQUESTED` → `CLOSED`

Regras:
- Chat **só existe** após `APPROVED`.
- Fornecedor só acessa detalhes completos e chat se for o `approvedSupplierCompanyId`.

---

## 6) Modelo de dados (Prisma / PostgreSQL)

### 6.1 Convenções
- `cuid()` para ids.
- Audit append-only: `AuditEvent`.
- Token do prestador: salvar **apenas hash** (ex.: SHA-256 + salt).
- `plate` normalizada (UPPER + remove não alfanumérico) na API.

### 6.2 Prisma schema (colar em `prisma/schema.prisma`)
> **Importante:** este schema assume PostgreSQL e inclui índices/constraints essenciais.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role { KOVI SUPPLIER ADMIN }

enum DispatchStatus {
  QUOTING
  APPROVED
  REJECTED
  IN_TRANSIT
  ON_SITE
  CLOSE_REQUESTED
  CLOSED
}

enum QuoteStatus {
  PENDING
  SUBMITTED
  ACCEPTED
  REJECTED
  EXPIRED
  WITHDRAWN
}

enum DispatchReason {
  ROUBO
  FURTO
  DESCONEXAO_RASTREADOR
  RASTREADOR_SEM_SINAL
  APROPRIACAO_INDEBITA
  AVERIGUACAO
  RODANDO_BLOQUEADO
  OUTROS
}

enum ChatAuthorType { USER SYSTEM FIELD }
enum AttachmentOrigin { CHAT FIELD COST_EVIDENCE }
enum FieldEventType { START_TRIP ARRIVE_ON_SITE REQUEST_CLOSE CLOSE }
enum AuditActorType { USER FIELD_SESSION SYSTEM }
enum CostValidationFlag { OK NEEDS_REVIEW MISSING_EVIDENCE GPS_MISMATCH TIME_MISMATCH }

model User {
  id                String   @id @default(cuid())
  role              Role
  name              String
  email             String   @unique
  isActive          Boolean  @default(true)

  supplierCompanyId String?
  supplierCompany   SupplierCompany? @relation(fields: [supplierCompanyId], references: [id])

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  createdDispatches  Dispatch[] @relation("DispatchCreatedBy")
  approvedDispatches Dispatch[] @relation("DispatchApprovedBy")
  rejectedDispatches Dispatch[] @relation("DispatchRejectedBy")
  closedDispatches   Dispatch[] @relation("DispatchClosedBy")

  chatMessages      ChatMessage[]
  auditEvents       AuditEvent[]

  @@index([role])
  @@index([supplierCompanyId])
}

model SupplierCompany {
  id               String  @id @default(cuid())
  legalName        String
  cnpj             String  @unique
  address          String
  responsibleName  String
  phone            String
  includedKm       Int     @default(0)
  includedMinutes  Int     @default(0)
  isActive         Boolean @default(true)

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  users            User[]
  quotes           Quote[]
  approvedDispatches Dispatch[]

  @@index([isActive])
}

model Vehicle {
  id        String   @id @default(cuid())
  plate     String   @unique
  model     String
  color     String?
  year      Int?
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Dispatch {
  id                String         @id @default(cuid())
  status            DispatchStatus @default(QUOTING)

  vehicleId         String?
  vehicle           Vehicle? @relation(fields: [vehicleId], references: [id])

  plate             String
  vehicleModel      String?
  vehicleColor      String?
  vehicleYear       Int?

  address           String
  latitude          Decimal? @db.Decimal(10, 7)
  longitude         Decimal? @db.Decimal(10, 7)

  geocodeProvider   String?
  geocodeRaw        Json?

  driverName        String?
  reason            DispatchReason
  reasonDetails     String?

  approvedSupplierCompanyId String?
  approvedSupplierCompany   SupplierCompany? @relation(fields: [approvedSupplierCompanyId], references: [id])

  approvedQuoteId   String?
  approvedQuote     Quote? @relation("DispatchApprovedQuote", fields: [approvedQuoteId], references: [id])

  createdById       String
  createdBy         User @relation("DispatchCreatedBy", fields: [createdById], references: [id])

  approvedById      String?
  approvedBy        User? @relation("DispatchApprovedBy", fields: [approvedById], references: [id])
  approvedAt        DateTime?

  rejectedById      String?
  rejectedBy        User? @relation("DispatchRejectedBy", fields: [rejectedById], references: [id])
  rejectedAt        DateTime?
  rejectReason      String?

  closedById        String?
  closedBy          User? @relation("DispatchClosedBy", fields: [closedById], references: [id])
  closedAt          DateTime?

  fieldStartedAt    DateTime?
  fieldArrivedAt    DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  quotes            Quote[]
  chatRoom          ChatRoom?
  fieldSessions     FieldSession[]
  cost              CostBreakdown?
  attachments       Attachment[]
  auditEvents       AuditEvent[]

  @@index([status])
  @@index([createdAt])
  @@index([approvedSupplierCompanyId, status])
  @@index([plate])
}

model Quote {
  id                String      @id @default(cuid())
  dispatchId        String
  dispatch          Dispatch    @relation(fields: [dispatchId], references: [id])

  supplierCompanyId String
  supplierCompany   SupplierCompany @relation(fields: [supplierCompanyId], references: [id])

  status            QuoteStatus @default(PENDING)

  etaMinutes        Int?
  supplierNote      String?
  submittedAt       DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  approvedForDispatch Dispatch? @relation("DispatchApprovedQuote")

  @@unique([dispatchId, supplierCompanyId])
  @@index([supplierCompanyId, status])
  @@index([dispatchId, status])
}

model ChatRoom {
  id         String   @id @default(cuid())
  dispatchId String   @unique
  dispatch   Dispatch @relation(fields: [dispatchId], references: [id])
  createdAt  DateTime @default(now())
  messages   ChatMessage[]
}

model ChatMessage {
  id              String       @id @default(cuid())
  chatRoomId      String
  chatRoom        ChatRoom     @relation(fields: [chatRoomId], references: [id])

  authorType      ChatAuthorType
  authorUserId    String?
  authorUser      User?        @relation(fields: [authorUserId], references: [id])

  fieldSessionId  String?
  fieldSession    FieldSession? @relation(fields: [fieldSessionId], references: [id])

  text            String?
  systemType      String?

  createdAt       DateTime @default(now())
  attachments     Attachment[]

  @@index([chatRoomId, createdAt])
  @@index([authorUserId])
  @@index([fieldSessionId])
}

model Attachment {
  id            String           @id @default(cuid())
  dispatchId    String?
  dispatch      Dispatch?        @relation(fields: [dispatchId], references: [id])

  chatMessageId String?
  chatMessage   ChatMessage?     @relation(fields: [chatMessageId], references: [id])

  origin        AttachmentOrigin
  fileName      String
  mimeType      String
  sizeBytes     Int
  storageKey    String
  publicUrl     String?
  meta          Json?

  createdAt     DateTime @default(now())

  @@index([dispatchId, createdAt])
  @@index([chatMessageId])
  @@index([origin])
}

model FieldSession {
  id              String   @id @default(cuid())
  dispatchId      String
  dispatch        Dispatch @relation(fields: [dispatchId], references: [id])

  tokenHash       String   @unique
  expiresAt       DateTime?

  allowClose      Boolean  @default(false)

  startedAt       DateTime?
  arrivedAt       DateTime?
  closeRequestedAt DateTime?
  closedAt        DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  gpsPoints       GPSPoint[]
  fieldEvents     FieldEvent[]
  chatMessages    ChatMessage[]

  @@index([dispatchId, createdAt])
}

model GPSPoint {
  id             String   @id @default(cuid())
  fieldSessionId String
  fieldSession   FieldSession @relation(fields: [fieldSessionId], references: [id])

  latitude       Decimal  @db.Decimal(10, 7)
  longitude      Decimal  @db.Decimal(10, 7)
  accuracyM      Int?
  speedMps       Float?
  recordedAt     DateTime

  createdAt      DateTime @default(now())

  @@index([fieldSessionId, recordedAt])
}

model FieldEvent {
  id             String        @id @default(cuid())
  fieldSessionId String
  fieldSession   FieldSession  @relation(fields: [fieldSessionId], references: [id])

  type           FieldEventType
  occurredAt     DateTime @default(now())
  meta           Json?

  @@index([fieldSessionId, occurredAt])
  @@index([type])
}

model CostBreakdown {
  id               String   @id @default(cuid())
  dispatchId        String   @unique
  dispatch          Dispatch @relation(fields: [dispatchId], references: [id])

  currency          String   @default("BRL")

  exitValueCents    Int      @default(0)
  extraKm           Int      @default(0)
  extraHourMinutes  Int      @default(0)

  reimbursements    Json?

  measuredKm        Int?
  measuredMinutes   Int?

  validationFlag    CostValidationFlag @default(OK)
  validationNotes   String?

  submittedByUserId String?
  submittedByUser   User? @relation(fields: [submittedByUserId], references: [id])

  submittedAt       DateTime?
  reviewedByUserId  String?
  reviewedByUser    User? @relation(fields: [reviewedByUserId], references: [id])
  reviewedAt        DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([submittedAt])
  @@index([validationFlag])
}

model AuditEvent {
  id                 String         @id @default(cuid())
  dispatchId          String
  dispatch            Dispatch       @relation(fields: [dispatchId], references: [id])

  actorType           AuditActorType
  actorUserId         String?
  actorUser           User?          @relation(fields: [actorUserId], references: [id])
  actorFieldSessionId String?
  actorFieldSession   FieldSession?  @relation(fields: [actorFieldSessionId], references: [id])

  eventType           String
  occurredAt          DateTime       @default(now())
  payload             Json?

  @@index([dispatchId, occurredAt])
  @@index([eventType])
  @@index([actorUserId])
  @@index([actorFieldSessionId])
}
```

---

## 7) Contratos REST (API v1)

### 7.1 Convenções gerais
- Base: `/api/v1`
- Autenticação: sessão (server-side) e RBAC.
- Recomendado: `X-Idempotency-Key` em POST críticos.

### 7.2 Matriz de autorização (resumo)
- ADMIN: todos endpoints.
- KOVI: todos exceto `/admin/*` e `/supplier/*`.
- SUPPLIER:
  - Pode: `/supplier/quotes*`, `/dispatches/:id` **apenas se aprovado**, `/chats/*` **apenas se aprovado**, `/dispatches/:id/costs/*` **apenas se aprovado**.
  - Não pode: criar dispatch, aprovar/reprovar, ver cotações de outros fornecedores.

### 7.3 Endpoints — Admin
#### Suppliers
- `GET /admin/suppliers`
- `POST /admin/suppliers`
- `PATCH /admin/suppliers/:supplierCompanyId`

#### Users
- `POST /admin/users`
- `GET /admin/users?role=&supplierCompanyId=`

#### Vehicles
- `POST /admin/vehicles`
- `GET /admin/vehicles?plate=`

---

## 8) Endpoints — Dispatch (KOVI/ADMIN)

### 8.1 Criar solicitação e gerar cotações
`POST /dispatches`

Body:
```json
{
  "plate": "ABC1D23",
  "vehicleSnapshot": { "model": "HB20", "color": "Prata", "year": 2023 },
  "location": { "address": "Av. Paulista, 1000", "latitude": -23.56, "longitude": -46.65 },
  "driverName": "Opcional",
  "reason": "RASTREADOR_SEM_SINAL",
  "reasonDetails": null,
  "supplierCompanyIds": ["sup1", "sup2"]
}
```

Regras:
- Normalizar placa.
- Se existir `Vehicle` pela placa, preencher snapshot automaticamente (mas manter overrides se enviados).
- Se `reason=OUTROS`, exigir `reasonDetails` não vazio.
- Criar `Dispatch(status=QUOTING)` + `Quote(PENDING)` para cada supplier.
- Audit:
  - `DISPATCH_CREATED`
  - `QUOTES_CREATED` (payload: suppliers)

Resposta `201`:
```json
{ "id": "dispatchId", "status": "QUOTING" }
```

### 8.2 Listar (tela principal)
`GET /dispatches?status=&supplierCompanyId=&from=&to=`

Retorna lista com campos mínimos (id, status, createdAt, address, reason, approvedSupplierCompany, approvedEta).

### 8.3 Detalhe
`GET /dispatches/:dispatchId`

RBAC:
- KOVI/ADMIN: sempre.
- SUPPLIER: **somente** se `approvedSupplierCompanyId` == supplier do usuário.

### 8.4 Reprovar/cancelar
`POST /dispatches/:dispatchId/reject`

Body:
```json
{ "reason": "Fornecedor não respondeu" }
```

Regras:
- Permitido se status em `QUOTING` (MVP).
- Atualizar:
  - `Dispatch.status=REJECTED`
  - `rejectedById`, `rejectedAt`, `rejectReason`
- Audit: `DISPATCH_REJECTED`.

---

## 9) Endpoints — Quotes

### 9.1 Fornecedor lista cotações pendentes (dados restritos)
`GET /supplier/quotes?status=PENDING|SUBMITTED`

Retornar apenas:
- `quoteId`, `dispatchId`, `address`, `status`, `createdAt`, (motivo opcional).

### 9.2 Fornecedor envia proposta (ETA)
`POST /supplier/quotes/:quoteId/submit`

Body:
```json
{ "etaMinutes": 18, "supplierNote": "Equipe próxima" }
```

Regras:
- quote deve ser do supplier do usuário.
- quote.status == `PENDING`
- dispatch.status == `QUOTING`
- Atualizar quote:
  - `status=SUBMITTED`
  - `etaMinutes`, `supplierNote`, `submittedAt`
- Audit: `QUOTE_SUBMITTED` (payload: eta, supplierId)

### 9.3 Kovi lista quotes do dispatch
`GET /dispatches/:dispatchId/quotes`

Retorna todas proposals.

### 9.4 Kovi aprova proposta (cria chat)
`POST /dispatches/:dispatchId/approve`

Body:
```json
{ "quoteId": "q1" }
```

Regras (transação):
- dispatch.status == `QUOTING`
- quote.status == `SUBMITTED`
- Set:
  - Dispatch:
    - `status=APPROVED`
    - `approvedQuoteId=quoteId`
    - `approvedSupplierCompanyId=quote.supplierCompanyId`
    - `approvedAt=now`, `approvedById`
  - Quote vencedora: `ACCEPTED`
  - Outras Quotes: `REJECTED`
  - Criar `ChatRoom(dispatchId)` se não existir
- Audit:
  - `DISPATCH_APPROVED`
  - `CHAT_CREATED`

Resposta:
```json
{ "dispatchId": "d1", "status": "APPROVED", "chatRoomId": "c1" }
```

---

## 10) Endpoints — Chat (KOVI/ADMIN + SUPPLIER aprovado)

### 10.1 Listar mensagens
`GET /chats/:chatRoomId/messages?cursor=&limit=50`

RBAC:
- KOVI/ADMIN: ok
- SUPPLIER: apenas se dispatch do chat for aprovado para seu supplier

### 10.2 Enviar mensagem
`POST /chats/:chatRoomId/messages`

Body:
```json
{ "text": "Ok", "attachmentIds": ["att1"] }
```

Regras:
- Criar ChatMessage `authorType=USER` + anexos vinculados (se fornecidos).
- Audit opcional: `CHAT_MESSAGE_SENT` (ou confiar em ChatMessage como log).

---

## 11) Endpoints — Attachments (presign)

### 11.1 Presign (chat)
`POST /attachments/presign`

Body:
```json
{ "fileName": "foto.jpg", "mimeType": "image/jpeg", "sizeBytes": 123, "origin": "CHAT", "dispatchId": "d1" }
```

Resposta:
```json
{
  "attachmentId": "att1",
  "storageKey": "dispatch/d1/chat/att1-foto.jpg",
  "uploadUrl": "https://...signed",
  "headers": { "Content-Type": "image/jpeg" }
}
```

### 11.2 Confirmar upload (opcional)
`POST /attachments/:attachmentId/confirm`

---

## 12) Endpoints — Field (prestador via link, sem login)

### 12.1 Criar FieldSession (gera link)
`POST /dispatches/:dispatchId/field-sessions` (KOVI/ADMIN)

Body:
```json
{ "expiresInMinutes": 240, "allowClose": false }
```

Resposta:
```json
{
  "fieldSessionId": "fs1",
  "fieldUrl": "https://.../field/fs1?t=TOKEN_PURO"
}
```

Regras:
- Persistir somente `tokenHash`.

### 12.2 Consultar sessão (público)
`GET /field/v1/sessions/:fieldSessionId?t=TOKEN`

Retornar apenas destino + flags.

### 12.3 Registrar evento
`POST /field/v1/sessions/:fieldSessionId/events?t=TOKEN`

Body:
```json
{ "type": "START_TRIP", "meta": { "battery": 0.7 } }
```

Efeitos:
- START_TRIP:
  - FieldSession.startedAt
  - Dispatch.status = `IN_TRANSIT`
  - Dispatch.fieldStartedAt
  - Audit: `FIELD_STARTED`
  - Mensagem SYSTEM no chat (recomendado): `systemType=FIELD_STARTED`
- ARRIVE_ON_SITE:
  - FieldSession.arrivedAt
  - Dispatch.status = `ON_SITE`
  - Dispatch.fieldArrivedAt
  - Audit: `FIELD_ARRIVED`
  - Mensagem SYSTEM
- REQUEST_CLOSE:
  - FieldSession.closeRequestedAt
  - Dispatch.status = `CLOSE_REQUESTED`
  - Audit: `FIELD_CLOSE_REQUESTED`
  - Mensagem SYSTEM
- CLOSE:
  - Somente se `allowClose=true`
  - FieldSession.closedAt
  - (opcional) Dispatch.status = `CLOSED` ou mantém `CLOSE_REQUESTED` e exige revisão de custos

### 12.4 Enviar GPS (batch)
`POST /field/v1/sessions/:fieldSessionId/gps?t=TOKEN`

Body:
```json
{
  "points": [
    { "lat": -23.56, "lng": -46.65, "accuracyM": 12, "speedMps": 3.2, "recordedAt": "2026-02-03T14:12:00Z" }
  ]
}
```

### 12.5 Upload de mídia do campo
`POST /field/v1/attachments/presign?t=TOKEN`

Body:
```json
{ "fileName": "carro.jpg", "mimeType": "image/jpeg", "sizeBytes": 99999, "dispatchId": "d1" }
```

Após confirmar upload, criar:
- `Attachment(origin=FIELD, dispatchId=...)`
- opcional: `ChatMessage(authorType=FIELD, text=null)` vinculando o attachment (para “aparecer no chat”)

---

## 13) Endpoints — Costs (SUPPLIER aprovado + KOVI/ADMIN revisão)

### 13.1 Fornecedor submete custos
`POST /dispatches/:dispatchId/costs/submit`

Body:
```json
{
  "exitValueCents": 15000,
  "extraKm": 12,
  "extraHourMinutes": 30,
  "reimbursements": [
    { "type": "estacionamento", "valueCents": 2500, "note": "Shopping X" }
  ],
  "evidenceAttachmentIds": ["att_hodo_ini", "att_hodo_fim"]
}
```

Validações (MVP):
1. **KM adicional**
   - Se `extraKm > 0`:
     - Preferência: ter GPS points suficientes para medir km.
     - Se sem trilha GPS:
       - exigir evidência (hodômetro inicial/final) → `validationFlag=MISSING_EVIDENCE` se faltar.
     - Se trilha existe:
       - calcular `measuredKm`.
       - se diferença grande (definir tolerância, ex.: +30% ou +5km), `validationFlag=GPS_MISMATCH` e exigir evidência.
2. **Hora adicional**
   - Computar `measuredMinutes` com base em:
     - início: `FieldSession.startedAt` (preferido) ou `Dispatch.approvedAt` (decisão de negócio)
     - fim: `FieldSession.closedAt` ou `now` quando submetido (definir regra)
   - Se `extraHourMinutes` incompatível → `validationFlag=TIME_MISMATCH`.

Persistência:
- Upsert `CostBreakdown` para o dispatch.
- `submittedAt`, `submittedByUserId`.
- Audit: `COST_SUBMITTED`.

### 13.2 Kovi revisa e encerra
`POST /dispatches/:dispatchId/costs/review`

Body:
```json
{ "approve": true, "reviewNote": "Ok", "forceClose": true }
```

Regras:
- Set `reviewedAt`, `reviewedByUserId`, `validationNotes`.
- Se approve:
  - `Dispatch.status=CLOSED`, `closedAt`, `closedById`.
- Audit:
  - `COST_REVIEWED`
  - `DISPATCH_CLOSED` (quando fechar)

---

## 14) Auditoria e relatórios

### 14.1 Timeline auditável
`GET /dispatches/:dispatchId/audit`

Unificar:
- `AuditEvent` (principal)
- `FieldEvent` (opcional)
- Mensagens SYSTEM do chat (opcional)

### 14.2 Dashboard de custos
`GET /reports/costs?from=&to=&supplierCompanyId=&groupBy=day|supplier|reason`

Retornar totals + groups.

---

## 15) Realtime (Socket.IO) — recomendação
- Namespace: `/realtime`
- Room por dispatch: `dispatch:{dispatchId}`
- Eventos:
  - `dispatch.statusChanged`
  - `quote.submitted`
  - `chat.messageNew`
  - `attachment.created`
  - `field.event`
- Permissões: validar no handshake e em cada join (supplier só no dispatch aprovado).

---

## 16) Checklist de implementação (para Codex)
### Fase A — Infra mínima
- [ ] Next.js + TS + lint/test
- [ ] Docker compose Postgres
- [ ] Prisma migrate + seed

### Fase B — RBAC + Admin
- [ ] Auth + middleware
- [ ] CRUD suppliers/users/vehicles

### Fase C — Fluxo de cotação
- [ ] POST /dispatches
- [ ] Supplier quotes list + submit ETA
- [ ] Approve + create chat

### Fase D — Chat + anexos
- [ ] REST mensagens + Socket.IO
- [ ] Presign + upload + exibir no chat

### Fase E — Field link
- [ ] FieldSession + token hash
- [ ] Eventos + GPS batch + mídia field no chat

### Fase F — Custos + validações
- [ ] submit costs (flags)
- [ ] review costs + close

### Fase G — Auditoria + reports
- [ ] timeline
- [ ] report custos

---

## 17) Critérios de aceite do MVP (mínimo)
1. Criar dispatch em cotação e enviar para múltiplos fornecedores.
2. Fornecedor vê somente endereço em cotação e responde ETA.
3. Kovi aprova e o chat do acionamento nasce.
4. Prestador via link envia GPS e mídias; eventos aparecem no chat.
5. Fornecedor submete custos; validações de km/hora rodam e geram flag quando necessário.
6. Kovi revisa e encerra; timeline auditável completa.
7. Dashboard simples de custos por fornecedor e período exportável (CSV como incremento opcional).

---

## 18) Decisões pendentes (travar antes de “hardening”)
- Motivo aparece para fornecedor na fase QUOTING? (recomendação: sim, mas “macro”).
- Hora adicional conta de `startedAt` ou `approvedAt`?
- Tolerância para `GPS_MISMATCH` (ex.: +5km ou +30%).
- Política de expiração de Quote (`EXPIRED`) e FieldSession.
