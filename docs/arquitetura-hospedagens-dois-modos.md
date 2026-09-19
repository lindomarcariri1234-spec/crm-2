# Arquitetura de hospedagens do VisiteCRM — dois modos de operação

## Objetivo

O VisiteCRM deve atender simultaneamente a estes cenários:

1. **Excursão sem vínculo direto com hospedagem**
   - a excursão é criada e vendida sem hotel definido;
   - uma reserva pode contratar hospedagem separadamente;
   - outra reserva da mesma excursão pode não contratar hospedagem;
   - a hospedagem pode ser definida depois, por reserva ou por passageiro.

2. **Excursão vinculada diretamente à hospedagem**
   - a excursão possui uma ou mais hospedagens operacionais;
   - existe uma hospedagem principal, quando aplicável;
   - as reservas podem herdar a hospedagem da excursão;
   - o sistema controla quartos, inventário, bloqueios, alocações e custos nesse contexto.

O modelo não deve criar dois módulos diferentes. Deve haver um único núcleo operacional,
com o vínculo entre excursão e hospedagem sendo **opcional**.

---

## Decisão principal

### A excursão não é dona da hospedagem

Uma excursão pode ter um contexto operacional de hospedagem, mas esse contexto não é
obrigatório para que uma reserva contrate hospedagem.

O relacionamento recomendado é:

```text
Accommodation
    │
    ├── AccommodationRoom
    ├── AccommodationRate
    ├── AccommodationInventory
    └── AccommodationBlock

Trip
    │
    └── TripAccommodation (opcional)

Reservation
    │
    └── ReservationAccommodation
            │
            ├── Accommodation (obrigatório)
            └── TripAccommodation (opcional)

ReservationAccommodation
    │
    └── AccommodationStay
            │
            ├── StayGuest
            ├── RoomAssignment
            └── StayRateLine
```

A entidade que representa a contratação da hospedagem é `reservation_accommodations`.
`trip_accommodations` representa somente o contexto oficial da excursão.

---

## Entidades e responsabilidades

### `accommodations`

Representa o estabelecimento físico:

- hotel;
- pousada;
- hostel;
- resort;
- parceiro;
- outra acomodação.

É um cadastro de recurso. Não deve depender de uma excursão específica.

### `accommodation_rooms`

Representa os quartos físicos reais.

Campos principais:

- `id`;
- `tenant_id`;
- `accommodation_id`;
- `room_number`;
- `name`;
- `category`;
- `max_occupancy`;
- `standard_occupancy`;
- `bed_configuration`;
- `bathroom_type`;
- `floor`;
- `status`;
- `is_active`;
- campos de auditoria.

`accommodations.total_rooms` pode continuar existindo por compatibilidade ou informação,
mas nunca deve controlar o estoque operacional. A fonte de verdade é a quantidade de
quartos ativos cadastrados.

### `trip_accommodations` — contexto opcional

Representa uma hospedagem oficialmente associada a uma excursão.

```text
id
tenant_id
trip_id
accommodation_id
check_in
check_out
nights
status
is_primary
pricing_policy
contracted_price
notes
created_at
updated_at
```

Regras:

- uma excursão pode ter zero, uma ou várias linhas;
- no máximo uma linha ativa deve ser `is_primary = true`;
- não existir linha é um estado válido;
- a linha pode representar contrato, bloqueio ou operação oficial da excursão;
- ela não cria automaticamente uma hospedagem para todas as reservas;
- a data e a tarifa do contexto não substituem o preço congelado da reserva.

### `reservation_accommodations` — contratação da hospedagem

Essa é a entidade que permite atender os dois modos.

```text
id
tenant_id
reservation_id
accommodation_id
trip_accommodation_id nullable
check_in
check_out
nights
guests_count
pricing_type
unit_price_snapshot
total_price_snapshot
status
notes
created_at
updated_at
```

Regras:

- `accommodation_id` é obrigatório;
- `trip_accommodation_id` é opcional;
- uma reserva pode existir sem nenhuma hospedagem;
- uma reserva pode contratar uma hospedagem sem que a excursão tenha
  `trip_accommodations`;
- quando `trip_accommodation_id` existir, ele deve pertencer à mesma excursão,
  tenant e acomodação;
- o preço, período e quantidade de hóspedes devem ser congelados no momento da
  contratação;
- alterações futuras na tarifa do cadastro não podem alterar uma contratação já criada.

O `accommodation_id` deve permanecer armazenado mesmo quando
`trip_accommodation_id` estiver preenchido. Isso simplifica consultas, preserva o
histórico e protege a contratação contra alterações futuras no contexto da excursão.

### `accommodation_stays` — estadia operacional

Representa a estadia concreta que será operada pelo PMS.

```text
id
tenant_id
accommodation_id
trip_accommodation_id nullable
trip_id nullable
reservation_id nullable
store_order_id nullable
client_id nullable
source
check_in
check_out
nights
status
pricing_type
contracted_total
frozen_total
actual_check_in_at
actual_check_out_at
notes
created_at
updated_at
```

Possíveis origens:

- `CRM_MANUAL`;
- `RESERVATION`;
- `STORE_DIRECT`;
- `TRIP_PACKAGE`;
- `PARTNER_IMPORT`.

Uma estadia pode possuir `trip_id` sem possuir `trip_accommodation_id`. Isso é
necessário para o modo em que a excursão existe, mas não possui hospedagem oficial.

### Hóspedes, tarifas e alocações

As entidades operacionais continuam independentes:

- `accommodation_stay_guests`;
- `accommodation_stay_rate_lines`;
- `accommodation_room_assignments`;
- `accommodation_room_beds`;
- `accommodation_room_inventory`;
- `accommodation_room_blocks`.

O passageiro nunca deve ser dono direto do quarto. A relação histórica deve ser:

```text
Passenger
    ↓
StayGuest
    ↓
RoomAssignment
    ↓
Room
```

---

## Modo 1 — excursão sem vínculo direto

### Exemplo

```text
Excursão: Carnaval em Salvador
trip_accommodations: nenhuma

Reserva A:
  contratou Hotel X
  check-in 10/02
  check-out 13/02

Reserva B:
  não contratou hospedagem

Reserva C:
  contratou Hotel Y
```

Nesse modo:

- `trips.accommodationId` permanece nulo ou é ignorado;
- não é criada linha em `trip_accommodations`;
- cada `reservation_accommodations` aponta diretamente para uma acomodação;
- cada estadia recebe `trip_id`, se a contratação estiver relacionada à excursão;
- `trip_accommodation_id` permanece nulo;
- a disponibilidade é calculada por acomodação, período, quartos e hóspedes;
- reservas diferentes da mesma excursão podem usar hotéis diferentes.

Esse modo também atende:

- venda posterior da hospedagem;
- upgrade de hotel;
- hospedagem opcional;
- excursão em que cada cliente escolhe o próprio hotel;
- agência que vende somente transporte e passeios.

### Fluxo

```text
Trip
  └── Reservation
          └── ReservationAccommodation
                  └── Accommodation
                          └── AccommodationStay
                                  └── RoomAssignments
```

---

## Modo 2 — excursão vinculada diretamente

### Exemplo

```text
Excursão: Arraial do Cabo
trip_accommodations:
  Hotel Mar Azul — principal
  Pousada Sol — alternativa
```

Nesse modo:

- a excursão possui uma ou mais linhas em `trip_accommodations`;
- o contexto possui período, quantidade de noites, política e eventual custo contratado;
- uma reserva pode herdar a hospedagem principal;
- uma reserva pode escolher a hospedagem alternativa;
- uma reserva pode optar por não contratar hospedagem;
- uma reserva pode ter outra acomodação autorizada pela agência;
- o sistema não deve copiar apenas o `trip_id` e tentar descobrir o hotel depois.

Quando uma reserva contratar uma hospedagem da excursão:

```text
reservation_accommodations.accommodation_id
    = trip_accommodations.accommodation_id

reservation_accommodations.trip_accommodation_id
    = trip_accommodations.id
```

Quando a reserva não contratar hospedagem, nenhuma linha de
`reservation_accommodations` é criada.

### Fluxo

```text
Trip
  └── TripAccommodation
          └── Accommodation
                  └── Rooms

Reservation
  └── ReservationAccommodation
          ├── TripAccommodation
          └── AccommodationStay
                  └── RoomAssignments
```

---

## Modo misto — consequência natural dos dois modos

O sistema também deve aceitar este caso:

```text
Excursão possui Hotel X como hospedagem oficial.

Reserva A → herda Hotel X
Reserva B → não quer hospedagem
Reserva C → usa Hotel Y, autorizado pela agência
```

Esse não deve ser um terceiro modelo de dados. É apenas a combinação de:

- `trip_accommodations` preenchido;
- `reservation_accommodations` opcional por reserva;
- possibilidade de a reserva apontar para o contexto oficial ou para outra acomodação.

O campo `trip_accommodation_id` identifica se a contratação veio do contexto oficial.
O campo `accommodation_id` identifica o recurso efetivamente contratado.

---

## Regra de seleção da hospedagem

Ao criar ou editar uma reserva, usar esta precedência:

1. acomodação escolhida explicitamente na reserva;
2. `trip_accommodation` escolhido explicitamente;
3. `trip_accommodation` principal ativo da excursão, somente se a reserva aceitar
   hospedagem incluída;
4. nenhuma hospedagem.

Nunca criar automaticamente uma hospedagem apenas porque a excursão possui uma
hospedagem principal. A contratação deve ser uma decisão da reserva, do produto ou da
regra comercial.

Uma API pode retornar a sugestão sem gravá-la:

```json
{
  "tripAccommodationConfigured": true,
  "suggestedTripAccommodationId": "hotel-principal",
  "reservationMustChooseAccommodation": false,
  "reservationAccommodation": null
}
```

---

## O que fazer com `trips.accommodationId`

`trips.accommodationId` pode permanecer temporariamente para compatibilidade, mas:

- não deve ser usado como fonte oficial de disponibilidade;
- não deve ser usado para criar estadias novas;
- não deve impedir uma excursão sem hospedagem;
- não deve impedir múltiplas hospedagens;
- leituras antigas podem fazer fallback para uma linha de `trip_accommodations`;
- novas escritas devem usar `trip_accommodations`.

Migração recomendada:

1. manter a coluna nullable;
2. criar `trip_accommodations` para os registros antigos que possuem
   `trips.accommodationId`;
3. marcar o registro migrado como `is_primary = true`;
4. alterar os fluxos novos para não escrever diretamente em `trips.accommodationId`;
5. remover a dependência depois que os consumidores antigos forem migrados.

---

## Integridade e concorrência

### Validações obrigatórias

Ao salvar `reservation_accommodations` com `trip_accommodation_id`:

1. validar tenant;
2. validar reserva;
3. validar a excursão da reserva;
4. validar o `trip_accommodation`;
5. confirmar que o `trip_accommodation.trip_id` é igual ao
   `reservation.trip_id`;
6. confirmar que a acomodação é a mesma;
7. validar datas e noites;
8. congelar tarifa e valores;
9. criar ou atualizar a estadia;
10. alocar quartos dentro da mesma transação.

Uma constraint `CHECK` não consegue validar a igualdade entre tabelas. Essa
consistência deve ser protegida no serviço transacional e, se necessário, por trigger
ou procedimento no banco.

### Disponibilidade

A disponibilidade deve considerar a capacidade por data de:

- estadias diretas;
- estadias vinculadas a reservas;
- alocações legadas de reservas;
- bloqueios;
- manutenção;
- inventário diário;
- contexto de hospedagem da excursão, quando ele representar capacidade já
  contratada ou bloqueada.

Uma linha em `trip_accommodations` não deve consumir quartos sozinha. Ela somente
consome capacidade quando houver regra explícita de bloqueio/contrato ou quando uma
estadia/alocação efetiva for criada.

---

## APIs recomendadas

### Cadastro e PMS

```text
GET    /accommodations
POST   /accommodations
GET    /accommodations/:id
PATCH  /accommodations/:id

GET    /accommodations/:id/rooms
POST   /accommodations/:id/rooms
PATCH  /accommodations/:id/rooms/:roomId

GET    /accommodations/:id/availability
GET    /accommodations/:id/blocks
GET    /accommodation-rooms/:roomId/inventory
PUT    /accommodation-rooms/:roomId/inventory
```

### Contexto opcional da excursão

```text
GET    /trips/:tripId/accommodations
POST   /trips/:tripId/accommodations
PATCH  /trips/:tripId/accommodations/:tripAccommodationId
DELETE /trips/:tripId/accommodations/:tripAccommodationId
```

`GET /trips/:tripId/accommodation-context` pode retornar:

```json
{
  "mode": "NONE",
  "primary": null,
  "options": [],
  "reservationsWithAccommodation": 4,
  "reservationsWithoutAccommodation": 8
}
```

Valores derivados de `mode`:

- `NONE`: não há `trip_accommodations`;
- `LINKED`: há contexto oficial e a operação usa esse contexto;
- `MIXED`: há contexto oficial, mas as reservas possuem combinações diferentes.

`mode` não precisa ser armazenado. Deve ser calculado a partir dos dados.

### Hospedagem da reserva

```text
GET    /reservations/:reservationId/accommodations
POST   /reservations/:reservationId/accommodations
PATCH  /reservations/:reservationId/accommodations/:id
DELETE /reservations/:reservationId/accommodations/:id

GET    /reservations/:reservationId/accommodation-summary
GET    /trips/:tripId/accommodation-summary
```

O `POST` deve aceitar:

```json
{
  "accommodationId": "hotel-x",
  "tripAccommodationId": null,
  "checkIn": "2026-10-10",
  "checkOut": "2026-10-13",
  "guestsCount": 2
}
```

Ou, no modo vinculado:

```json
{
  "accommodationId": "hotel-x",
  "tripAccommodationId": "trip-hotel-x",
  "checkIn": "2026-10-10",
  "checkOut": "2026-10-13",
  "guestsCount": 2
}
```

---

## Interface

### Tela da excursão

O bloco de hospedagem deve ser opcional:

- **Sem hospedagem oficial**
  - informar que cada reserva pode contratar hospedagem separadamente;
- **Adicionar hospedagem oficial**
  - escolher uma ou mais acomodações;
  - definir principal, período, noites e política de tarifa;
- **Ver impacto operacional**
  - reservas hospedadas;
  - reservas sem hospedagem;
  - acomodações alternativas;
  - capacidade utilizada.

### Tela da reserva

Mostrar uma seção separada:

```text
Hospedagem desta reserva

[ ] Sem hospedagem
[ ] Usar hospedagem principal da excursão
[ ] Escolher outra hospedagem
```

Se a excursão não possuir hospedagem oficial, remover a opção de herança e mostrar
diretamente o seletor de acomodação.

### Cadastro de hospedagens

Continua sendo apenas cadastro de referência:

- parceiros;
- quartos;
- camas;
- contatos;
- tarifas;
- inventário;
- bloqueios.

Operação de estadias, alocações e check-in/check-out permanece no PMS.

---

## Migração segura do modelo atual

1. Manter `accommodations`, `accommodation_rooms` e o PMS atual.
2. Manter `trip_accommodations` como tabela opcional.
3. Criar `reservation_accommodations`.
4. Criar estadias com `trip_accommodation_id` nulo quando não houver contexto oficial.
5. Migrar reservas antigas que dependem de `trips.accommodationId` para o contexto
   principal da excursão.
6. Migrar alocações antigas para `accommodation_stays` e
   `accommodation_room_assignments` quando for possível identificar a acomodação.
7. Manter `reservation_room_assignments` como compatibilidade durante a transição.
8. Alterar novas escritas para o modelo operacional.
9. Comparar disponibilidade antiga e nova antes de remover o legado.
10. Só depois retirar a dependência operacional de `trips.accommodationId`.

---

## Exemplos completos

### Excursão somente transporte

```text
Trip: São Paulo → Curitiba
TripAccommodation: nenhuma

Reserva 1:
  sem hospedagem

Reserva 2:
  ReservationAccommodation → Hotel A
```

### Excursão com hospedagem incluída

```text
Trip: Foz do Iguaçu
TripAccommodation:
  Hotel B — principal

Reserva 1:
  ReservationAccommodation → Hotel B
  tripAccommodationId preenchido
```

### Excursão com hospedagem opcional

```text
Trip: Porto Seguro
TripAccommodation:
  Hotel C — principal

Reserva 1:
  usa Hotel C

Reserva 2:
  não contrata hospedagem

Reserva 3:
  usa Hotel D, autorizado pela agência
```

### Excursão sem vínculo inicial e hospedagem definida depois

```text
Trip criada sem hospedagem
Reserva criada sem hospedagem

Mais tarde:
  ReservationAccommodation → Hotel E
  AccommodationStay criada
  hóspedes e quartos alocados
```

---

## Regra de ouro revisada

> A acomodação representa o recurso físico.  
> `TripAccommodation` representa um contexto operacional opcional da excursão.  
> `ReservationAccommodation` representa a contratação efetiva da hospedagem.  
> `AccommodationStay` representa a estadia que será operada.  
> A alocação representa onde cada hóspede ficará.  
> O inventário representa a capacidade disponível por data.

Assim o VisiteCRM suporta:

```text
Excursão sem hotel
    → reserva sem hospedagem
    → ou reserva com hotel escolhido individualmente
```

e também:

```text
Excursão com hotel oficial
    → reservas que herdam o hotel
    → reservas sem hospedagem
    → reservas com acomodação alternativa
```

Sem duplicar o PMS e sem transformar a excursão em dependência obrigatória da
hospedagem.