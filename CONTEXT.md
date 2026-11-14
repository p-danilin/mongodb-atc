# Ground Control

An air-traffic-style agent that moves simulated vehicles around an airport map under rules MongoDB enforces, so every move is checked before it happens and recorded after.

## Language

**Vehicle**:
Anything that moves on the airport map under the controller's authority, whatever its kind (aircraft, fuel truck, tug).
_Avoid_: Aircraft (as the general term), plane, unit

**Identity**:
The permission-bearing principal that a **Vehicle** or the controller acts as, carrying its clearances.
_Avoid_: User, account, role

**Gate**:
An airport stand a **Vehicle** parks at. Always a place on the map, never the checker.
_Avoid_: Stand, bay, "the gate" for the policy check

**Policy gate**:
The check every route request passes before a **Vehicle** moves, returning allow, deny or needs-approval. Always written in full.
_Avoid_: The gate, guard, filter

**Closure**:
A zone on the map that vehicles may not route through until it expires or is removed. The only kind of zone today.
_Avoid_: Zone (as the general term while closure is the only type), no-go area

**Approval**:
A human's answer (approve or deny) to an action the **Policy gate** marked needs-approval. The queue holds the pending actions; the approval is the answer.
_Avoid_: Request (for the answer), ticket

## Relationships

- A **Vehicle** acts under exactly one **Identity**
- Different kinds of **Vehicle** may carry different data
- A **Vehicle** parks at one **Gate**
- Every route request goes through the **Policy gate** before the **Vehicle** moves
- An **Approval** answers one needs-approval action
- A **Closure** makes the **Policy gate** deny any route that touches it

## Flagged ambiguities

- "gate" was used both for the airport stand and for the policy check — resolved: **Gate** is the stand; the check is the **Policy gate**, always in full.
- "aircraft" was used both for the moving thing and for one kind of it — resolved: the moving thing is a **Vehicle**; "aircraft" is only one of its kinds.
