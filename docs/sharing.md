# Sharing & Permissions

## Access Hierarchy

```mermaid
graph TD
    HOME_SHARE[Home Share] -->|grants access to| ALL_ROOMS[All Rooms]
    ALL_ROOMS -->|grants access to| ALL_RELAYS[All Relays in Rooms]

    ROOM_SHARE[Room Share] -->|grants access to| ROOM_RELAYS[Relays in Room]

    RELAY_SHARE[Relay Share] -->|grants access to| SINGLE_RELAY[Single Relay]
```

## Access Check Chain

`getRelayAccess` resolves in this order: **Owner → RelayShare → RoomShare → HomeShare**

The first matching grant wins. This means:

- Sharing a home implicitly grants access to all its rooms and relays.
- Sharing a room implicitly grants access to all relays in that room.
- Sharing a relay grants access to only that relay.
