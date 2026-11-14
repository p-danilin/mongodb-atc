import { describe, expect, it } from "vitest";
import { groundReply, pilotReadback, runRadioFlow, spokenCallsign, spokenRoute, type RadioDeps, type Taxi } from "./radio";

const taxi = (o: Partial<Taxi> = {}): Taxi => ({ flight: "AC101", decision: "allow", gate: "G2", gate_name: "Gate 2", route: ["H1", "A", "D2", "Spur 2"], ...o });

describe("phraseology", () => {
  it("speaks callsigns and routes", () => {
    expect(spokenCallsign("AC101")).toBe("Air Canada one zero one");
    expect(spokenCallsign("XY9")).toBe("Xray Yankee niner");
    expect(spokenRoute(["H1", "A", "D2", "Spur 2"])).toBe("Hotel one, Alpha, Delta two");
  });
  it("clears, holds and refuses", () => {
    expect(groundReply(taxi())).toBe("Air Canada one zero one, taxi to gate two via Hotel one, Alpha, Delta two.");
    expect(groundReply(taxi({ decision: "needs_approval" }))).toContain("hold position, runway crossing requires clearance");
    expect(groundReply(taxi({ decision: "deny", reason: "closure ahead" }))).toContain("unable, closure ahead");
    expect(pilotReadback(taxi({ decision: "needs_approval" }))).toBe("Hold position, Air Canada one zero one.");
  });
});

function deps(result: Taxi, supervisor: "approve" | "deny" = "approve") {
  const heard: string[] = [];
  const d: RadioDeps = {
    say: async (who, text) => { heard.push(`${who}: ${text}`); },
    note: (t) => { heard.push(`note: ${t}`); },
    prefetch: () => {},
    tool: async (name) => JSON.stringify(name === "request_taxi" ? result : { gate_name: "Gate 2", route: ["H1", "B"] }),
    waitForSupervisor: async () => supervisor,
  };
  return { d, heard };
}

describe("runRadioFlow", () => {
  it("pilot -> tool -> ground -> readback, in order", async () => {
    const { d, heard } = deps(taxi());
    await runRadioFlow("AC101", "G2", "Gate 2", d);
    expect(heard.map((h) => h.split(":")[0])).toEqual(["Pilot", "note", "note", "Ground", "Pilot"]);
  });
  it("a held crossing waits for the supervisor, then clears", async () => {
    const { d, heard } = deps(taxi({ decision: "needs_approval", route: [] }));
    await runRadioFlow("AC101", "G2", "Gate 2", d);
    expect(heard.join("\n")).toContain("cross runway two seven");
    expect(heard[heard.length - 1]).toMatch(/^Pilot: Cross runway two seven/);
  });
  it("a denied crossing holds", async () => {
    const { d, heard } = deps(taxi({ decision: "needs_approval", route: [] }), "deny");
    await runRadioFlow("AC101", "G2", "Gate 2", d);
    expect(heard.join("\n")).toContain("unable runway crossing");
  });
});
