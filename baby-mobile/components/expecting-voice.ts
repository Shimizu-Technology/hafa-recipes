import { useEffect, useState } from "react";
import { useBaby } from "@/lib/context";
import type { FamilyMember } from "../lib/family";
import { laborView, type Voice } from "../lib/labor";
import type { Child } from "../lib/models";
import { familySpaces } from "../lib/spaces";

/**
 * Whose words this phone should use for the pregnancy, from the same answer the contraction screen uses: "you" on the
 * phone of whoever's expecting, her name on her partner's, everyday words until the family has said. It reads the
 * family once, only while it's needed, and what the phone already knows (a confirmed answer) holds with no signal.
 */
export function useExpectingVoice(child: Child | null, enabled = true): Voice {
  const b = useBaby(), bootstrap = b.state.bootstrap, family = child ? familySpaces(bootstrap).find((space) => space.id === child.space_id) : undefined,
    need = enabled && !!child && !!family && !child.birth_date, [members, setMembers] = useState<FamilyMember[] | null>(null);
  useEffect(() => {
    if (!need) return;
    let alive = true;
    void Promise.resolve().then(() => b.api.familyMembers(family!.id)).then(({ items }) => { if (alive) setMembers(items); }).catch(() => undefined);
    return () => { alive = false; };
  }, [need, family?.id]);
  return laborView(child, b.owner, bootstrap?.people, { inFamily: !!family, members }).voice;
}
