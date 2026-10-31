import { TabStack } from "@/components/tab-stack";
export default function Layout() { return <TabStack title="Journal" add={{ pathname: "/edit", params: { kind: "journal" } }} />; }
