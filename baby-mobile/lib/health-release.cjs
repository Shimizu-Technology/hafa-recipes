/** Leon authorized agent review for private family use on 2026-11-07.
 * This is not clinician review. Public AND paid releases need both records.
 * See medical/AGENT_REVIEW_2026-11-07.md and docs/hafa-baby/ROADMAP.md.
 */
const review = Object.freeze({ agentReview: "2026-11-07", clinicianReview: "", whoChartPermission: "" });
function assertHealthRelease(audience, records = review) {
  if (audience === "private-family") return;
  if (!["public", "paid"].includes(audience) || !records.clinicianReview.trim() || !records.whoChartPermission.trim()) {
    throw new Error("Baby public/paid release blocked: record clinician review AND WHO chart permission in lib/health-release.cjs first.");
  }
}
module.exports = { review, assertHealthRelease };
