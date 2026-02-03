# PRD.me — PR Hub (Plataforma de Acionamento de Pronta Resposta)
**Produto:** PR Hub (Pronta Resposta Hub)  
**Versão:** 0.1  
**Data:** 2026-02-03  
**Owner (negócio):** Monitoramento / Segurança  
**Owner (técnico):** Engenharia / Plataforma  
**Status:** Draft para execução (MVP)

---

## 1) Visão do produto
Criar uma plataforma web para gerenciar acionamentos de **Pronta Resposta** de forma rastreável, organizada e escalável, substituindo o uso de grupos de WhatsApp e reduzindo ruído operacional.

O produto combina:
- **Cotação multi-fornecedor** (estilo “Uber”: vários recebem, um é aprovado)
- **Chat por acionamento** (um chat exclusivo por solicitação, criado após aprovação)
- **Link mobile do prestador** (sem login; envia GPS, mídias e eventos)
- **Auditoria e custos** (timeline completa e dashboard de custos)

---

## 2) Problema e contexto
### Problema atual
- Informações de acionamentos se misturam em conversas (WhatsApp) sem threads formais.
- Dificuldade de rastrear:
  - quem solicitou / aprovou / encerrou
  - SLA real vs prometido
  - evidências (mídias) e custos (km/hora/reembolsos)
- Operação de envio manual da mesma mensagem para múltiplas empresas.

### Impacto
- Aumento de tempo de resposta (TTR) e riscos de falha na tratativa.
- Custos contestáveis e baixa governança.
- Baixa capacidade de auditoria e aprendizado.

---

## 3) Objetivos (MVP)
1. **Organizar a tratativa por acionamento** com chat dedicado e histórico completo.
2. **Reduzir tempo de acionamento** (criação + cotação + aprovação) e padronizar dados.
3. **Garantir rastreabilidade** (audit trail) ponta a ponta.
4. **Melhorar governança de custos** com validações de km/hora e evidências.
5. **Permitir execução em campo** via link web mobile, sem cadastro prévio do prestador.

---

## 4) Não objetivos (MVP)
- Pagamento e faturamento (NF, conciliação, repasse financeiro).
- Aplicativo nativo (iOS/Android).
- Integrações obrigatórias com sistemas externos (rastreador, CRM, ERP).
- Chat “aberto” para fornecedor iniciar conversa sem acionamento vigente.

---

## 5) Público-alvo e personas
### 5.1 Persona A — Operador Kovi (desktop)
- Cria e gerencia acionamentos.
- Aprova propostas.
- Acompanha status e evidências.
- Encerra/valida e gera visão gerencial.

### 5.2 Persona B — Analista do fornecedor (desktop)
- Recebe cotações (dados restritos).
- Responde ETA.
- Após aprovação, usa chat para trocar informações e evidências.
- Submete custos ao final.

### 5.3 Persona C — Prestador em campo (mobile)
- Recebe link do fornecedor.
- Visualiza local de chegada.
- Envia posição/GPS, mídias, marca eventos (início/chegada/solicitar encerramento).
- Não acessa nem interage no chat.

### 5.4 Persona D — Admin (desktop)
- Gerencia cadastros de usuários e fornecedores.
- Ajusta parâmetros e monitora.

---

## 6) Jornada do usuário (MVP)
### 6.1 Jornada: criar e aprovar acionamento
1. Kovi cria solicitação (placa, local, motivo, fornecedores alvo).
2. Fornecedores recebem cotação e veem **apenas endereço**.
3. Fornecedor responde ETA (minutos).
4. Kovi aprova um fornecedor → sistema cria chat e libera detalhes completos ao aprovado.

### 6.2 Jornada: execução em campo via link
1. Fornecedor repassa link para prestador.
2. Prestador abre no mobile e marca “Iniciar deslocamento” (começa GPS).
3. Prestador anexa mídias (fotos/vídeos) e marca “Cheguei”.
4. Prestador solicita encerramento (ou encerra se permitido).

### 6.3 Jornada: custos e encerramento
1. Fornecedor submete custos (saída, km adicional, hora adicional, reembolsos).
2. Sistema valida:
   - KM adicional vs GPS (ou exige hodômetro com timestamp).
   - Hora adicional vs timestamps (início/fim no sistema).
3. Kovi revisa custos e encerra acionamento.
4. Dashboard consolida custos por fornecedor e período.

---

## 7) Requisitos funcionais

### 7.1 Cadastros
**Kovi User**
- Campos: nome, e-mail.

**Fornecedor (empresa)**
- Campos: nome social, CNPJ, endereço, responsável, telefone.
- Franquia: tempo por acionamento e KM (ex.: includedMinutes, includedKm).
- Cadastro de usuários do fornecedor: nome, e-mail.

**Prestador (campo)**
- Sem cadastro prévio.
- Acesso por link tokenizado por acionamento.

**Admin**
- Mesmo acesso do Kovi + permissões de cadastro/gestão.

---

### 7.2 Solicitação (Dispatch)
Ao criar:
- Placa e modelo do carro:
  - Lookup opcional por placa (pré-cadastro).
  - Se não existir, cadastro manual (snapshot).
- Local: latitude/longitude **ou** endereço.
  - Se lat/long: converter para endereço (reverse geocode).
- Driver (opcional).
- Motivo (enum) + “Outros” com detalhamento obrigatório.

Motivos:
- Roubo
- Furto
- Desconexão do rastreador
- Rastreador sem sinal
- Apropriação indébita
- Averiguação
- Rodando bloqueado
- Outros (detalhar)

---

### 7.3 Cotação (Quote)
- Kovi seleciona fornecedores cadastrados para receber a solicitação.
- Fornecedor (antes de aprovação) vê somente:
  - endereço e mapa (e opcional: motivo macro).
- Fornecedor responde:
  - ETA em minutos
  - nota opcional
- Kovi aprova:
  - apenas 1 fornecedor por acionamento (MVP).
  - ao aprovar, cria chat dedicado e libera detalhes completos ao aprovado.
- Fornecedores não aprovados:
  - não devem ver dados sensíveis (placa, detalhes do veículo).

---

### 7.4 Chat por acionamento
- Criado automaticamente após aprovação.
- Suporta:
  - mensagens textuais
  - anexos (imagens e outras mídias)
  - mensagens do sistema (eventos do prestador)
- Não existe “grupo fixo”; um chat por acionamento.

---

### 7.5 Link do prestador (mobile)
- Link único tokenizado por acionamento/FieldSession.
- Prestador pode:
  - ver local de chegada (endereço + mapa)
  - iniciar deslocamento (marca evento + inicia coleta GPS)
  - enviar GPS (batch)
  - anexar mídias (que aparecem no chat do acionamento)
  - marcar chegada
  - solicitar encerramento
- Prestador **não**:
  - vê chat
  - responde mensagens do chat

---

### 7.6 Encerramento e custos
Ao encerrar, fornecedor informa:
- Valor da saída (base)
- Km adicional
- Hora adicional
- Reembolsos (texto + itens)

Validações:
- Km adicional:
  - Preferência: medir deslocamento via GPS.
  - Se GPS não compatível com km adicional:
    - exigir evidência com fotos de hodômetro (inicial/final) com timestamp.
- Hora adicional:
  - compatível com timestamps de início/fim do acionamento no sistema.

Revisão:
- Kovi revisa/aceita custos e encerra acionamento (status CLOSED).

---

### 7.7 Rastreabilidade (Audit Trail)
A plataforma deve registrar, no mínimo:
- usuário solicitante + data/hora da solicitação
- tempo previsto (ETA) do fornecedor selecionado
- data/hora da aprovação/rejeição
- data/hora de início do trajeto (via link)
- data/hora de chegada ao local
- data/hora de finalização
- usuário que finalizou
- (extensível) outros eventos e metadados

---

### 7.8 Tela principal (Kovi)
Visões:
- Acionamentos vigentes por fornecedor
- Em cotação
- Aprovados (com link para chat)
- Reprovados (com motivo)

---

### 7.9 Dashboard de custos
- Dashboard agregando custos informados:
  - por fornecedor
  - por período
  - por motivo (opcional)
- Exportação CSV (incremento recomendado)

---

## 8) Requisitos não funcionais
### 8.1 Segurança
- RBAC rigoroso (Kovi/Admin/Supplier).
- Antes de aprovação: fornecedor vê somente endereço (dados restritos).
- Token do prestador:
  - armazenar somente hash
  - expiração configurável
  - rate limiting nos endpoints públicos (field)
- Uploads:
  - validação de tipo/mime/size
  - storage fora do banco (S3 compatível)
- Logs e auditoria append-only (sem edição histórica).

### 8.2 Desempenho e escala (MVP)
- Suportar centenas de acionamentos/dia sem degradação perceptível.
- Paginação em listas e chat.
- Realtime para chat/eventos (websocket).

### 8.3 Disponibilidade
- MVP: best-effort; porém endpoints críticos devem ser idempotentes quando possível.

### 8.4 Usabilidade
- Desktop: fluxos curtos e padronizados para criação/aprovação.
- Mobile: UX simples (3 botões-chave + upload + mapa).

---

## 9) Métricas de sucesso
- **Tempo médio** do “criar” → “aprovar” (min).
- % acionamentos com trilha de auditoria completa.
- % custos com `validationFlag != OK` (tende a cair com governança).
- Redução de retrabalho (proxy: menos mensagens redundantes / menos disputas de custos).
- Adoção: # acionamentos via ferramenta / # total.

---

## 10) Dependências e premissas
- Lista atual de fornecedores e usuários.
- Domínio/hosting para páginas públicas do prestador.
- Object storage (S3 compatível) disponível.
- Política interna para uso de mapas e geocoding (cache/limite).

---

## 11) Riscos e mitigação
1. **Uso de Nominatim/OSM sem cache** → bloqueio por policy  
   - Mitigação: cache + rate limit + user-agent identificável.
2. **Segurança do link do prestador** (vazamento)  
   - Mitigação: expiração + token forte + rate limit + (opcional) geofence/validar device.
3. **GPS impreciso** em áreas urbanas  
   - Mitigação: tolerância, exigir evidência em casos discrepantes.
4. **Adoção operacional** (mudança de hábito)  
   - Mitigação: MVP com fluxo mais rápido que WhatsApp + treinamento curto.

---

## 12) Perguntas em aberto (decisões a “travar”)
1. Fornecedor vê motivo na fase QUOTING? (recomendado: sim, “macro”).
2. Hora adicional é calculada a partir de `startedAt` ou `approvedAt`?
3. Tolerância para mismatch GPS (ex.: >30% ou >5km).
4. Expiração de quotes (EXPIRED): sim/não e tempo padrão.
5. Permitir “CLOSE” direto pelo prestador (`allowClose=true`) ou sempre depender de Kovi?

---

## 13) Critérios de aceite do MVP
1. Criar dispatch em cotação e disparar para múltiplos fornecedores.
2. Fornecedor vê somente endereço e responde ETA.
3. Kovi aprova e chat por acionamento nasce automaticamente.
4. Prestador via link envia GPS e mídias; eventos aparecem no chat.
5. Fornecedor submete custos; sistema gera flag quando inconsistências.
6. Kovi revisa e encerra; timeline auditável completa.
7. Dashboard de custos por fornecedor e período.

---

## 14) Roadmap (sugestão)
### Release 0 (MVP)
- Cadastros + dispatch + quotes + aprovação + chat + field link + custos + auditoria + dashboard simples.

### Release 1 (incrementos)
- SLA dashboard (ETA vs real), export CSV, templates de mensagem, anexos com thumbnails, expiração automática.
- Notificações (email/push/webhook).

### Release 2 (hardening)
- Integrações com rastreador/alertas, SSO corporativo, antifraude de link, auditoria avançada, relatórios financeiros.

