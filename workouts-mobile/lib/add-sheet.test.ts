import { expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("react-native", () => ({ ScrollView: "ScrollView" }));
vi.mock("expo-router", () => ({ router: { replace: f.replace } }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", ListGroup: "ListGroup", ListRow: "ListRow", useColors: () => ({ groupedBackground: "grouped" }) }));
import Add from "../app/add";
it("keeps all five add flows reachable and replaces the sheet rather than stacking it", () => {
  const rows = Add().props.children[0].props.children;
  expect(rows.map((row: { props: any }) => row.props.title)).toEqual(["Paste a link", "Record/upload", "Build a workout", "Import a plan", "Build a plan"]);
  for (const row of rows) row.props.onPress();
  expect(f.replace.mock.calls.map(call => call[0])).toEqual(["/extract", "/capture", "/add-workout", "/extract", "/build-plan"]);
});
