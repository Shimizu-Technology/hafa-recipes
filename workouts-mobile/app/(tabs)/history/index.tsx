import Progress from "../../history-progress";
/**
 * History & progress, promoted to the Progress tab. The route is `history` so it never collides with the
 * legacy `/progress` redirect; the pushed `/history-progress` route stays for links and Done.
 */
export default function ProgressTab() { return <Progress />; }
