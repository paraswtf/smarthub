# Data Model

```mermaid
erDiagram
    User ||--o{ ApiKey : owns
    User ||--o{ Home : owns
    User ||--o{ HomeShare : "shared with"
    User ||--o{ RoomShare : "shared with"
    User ||--o{ RelayShare : "shared with"

    ApiKey ||--o{ Device : registers

    Home ||--o{ Device : contains
    Home ||--o{ Room : contains
    Home ||--o{ HomeShare : "shared via"

    Room ||--o{ Relay : contains
    Room ||--o{ RoomShare : "shared via"

    Device ||--o{ Relay : has
    Device ||--o{ Switch : has

    Relay ||--o{ RelayShare : "shared via"
    Relay ||--o{ RelaySchedule : "scheduled by"

    Switch }o--|| Relay : "linked to"
```

## Key Relationships

- **User → Home → Room → Relay**: Core organizational hierarchy. Relays physically live on devices but are logically assigned to rooms.
- **Device → Relay / Switch**: A device owns its physical GPIO outputs (relays) and inputs (switches).
- **Switch → Relay**: Cross-device link - a switch on Device A can control a relay on Device B (same owner). WS server resolves routing.
- **ApiKey → Device**: ESP32 devices register using an API key belonging to their owner.
- **Shares**: Granular access at home, room, or relay level. See [Sharing & Permissions](sharing.md).
