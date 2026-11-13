import { respondToPlayerContact, playerPose, movementProposal, captureContactRollback, moveSupport, type Sim, type Controls, type LandingQuery, type PlayerQuery, type SupportSnapshot, type LandingContact } from "../sim";
import type { Tuning } from "../config/gameplay";

export function step(
    sim: Sim,
    tuning: Tuning,
    controls: Controls,
    findLanding: LandingQuery,
    findContact?: PlayerQuery,
    support?: SupportSnapshot,
): LandingContact | undefined {
    const previous = playerPose(sim);
    const previousPogo = findContact ? captureContactRollback(sim) : sim.pogo;
    moveSupport(sim, support);
    const proposal = movementProposal(sim, tuning, controls);
    let result = proposal.next();
    while (!result.done) result = proposal.next(findLanding(result.value));
    const accepted = result.value;
    if (!findContact) return accepted;
    let start = previous;
    let target = playerPose(sim);
    let blocked = false;
    let startFraction = 0;
    for (let iteration = 0; iteration < 6; iteration++) {
        const contact = findContact({ previous: start, current: target, startFraction,
            ...(previousPogo.state === "Compression" && previousPogo.support ? { supportPlatform: previousPogo.support.platformId } : {}) });
        if (!contact) {
            Object.assign(sim.body.pos, target.position);
            return sim.pogo.contactId !== previousPogo.contactId || accepted?.supportHandoff ? accepted : undefined;
        }
        const response = respondToPlayerContact(sim, tuning, previousPogo, accepted, { start, target, blocked, startFraction }, contact);
        let resolution = response.next();
        while (!resolution.done) resolution = response.next(findLanding(resolution.value));
        ({ start, target, blocked, startFraction } = resolution.value);
    }
}
