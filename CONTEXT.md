# Ground Control

An air-traffic-style agent that moves simulated vehicles around an airport map under rules MongoDB enforces, so every move is checked before it happens and recorded after.

## Language

**Vehicle**:
Anything that moves on the airport map under the controller's authority, whatever its kind (aircraft, fuel truck, tug).
_Avoid_: Aircraft (as the general term), plane, unit

**Identity**:
The permission-bearing principal that a **Vehicle** or the controller acts as, carrying its clearances.
_Avoid_: User, account, role

## Relationships

- A **Vehicle** acts under exactly one **Identity**
- Different kinds of **Vehicle** may carry different data

## Flagged ambiguities

- "aircraft" was used both for the moving thing and for one kind of it — resolved: the moving thing is a **Vehicle**; "aircraft" is only one of its kinds.
